import { Injectable, UnauthorizedException, Logger, NotFoundException, HttpException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { RefreshToken } from './refresh-token.entity';
import * as fs from 'fs';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { TokenPayload } from '@app/common/token-payload.type';
import { Permission } from '@app/common/permission.type';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly ownerEmail = (process.env.OWNER_EMAIL ?? '').trim().toLowerCase();
  private readonly privateKey = fs.readFileSync(
    process.env.JWT_PRIVATE_KEY_PATH ?? './keys/private.pem',
    'utf-8',
  );
  private readonly publicKey = fs.readFileSync(
    process.env.JWT_PUBLIC_KEY_PATH ?? './keys/public.pem',
    'utf-8',
  );

  private readonly accessExpiry = parseInt(
    process.env.JWT_ACCESS_EXPIRY ?? '900000',
    10,
  );
  private readonly refreshExpiry = parseInt(
    process.env.JWT_REFRESH_EXPIRY ?? '604800000',
    10,
  );

  private readonly codes = new Map<string, { code: string; expiresAt: Date }>();
  private readonly CODE_EXPIRATION_MS = 10 * 60 * 1000;

  constructor(
    private readonly jwtService: JwtService,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepo: Repository<RefreshToken>,
  ) { }

  generateCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  requestCode(email: string) {
    const code = this.generateCode();
    const expiresAt = new Date(Date.now() + this.CODE_EXPIRATION_MS);
    this.codes.set(email, { code, expiresAt });

    this.logger.log(`Code for ${email}: ${code}`);
  }

  verifyCode(email: string, code: string) {
    const entry = this.codes.get(email);
    if (!entry || entry.code !== code) {
      this.logger.warn('Verification code rejected: invalid code');
      throw new UnauthorizedException('Invalid code');
    }

    if (entry.expiresAt.getTime() < Date.now()) {
      this.logger.warn('User code expired, removing');
      this.codes.delete(email);
      throw new UnauthorizedException('Expired code');
    }

    this.codes.delete(email);
  }

  async issueTokens(email: string) {
    this.logger.log('Issuing new access and refresh tokens');
    const jti = uuidv4();

    const accessPayload: TokenPayload = {
      sub: email,
      email,
      type: 'access',
      permissions: this.getPermissionsForEmail(email),
    };
    const refreshPayload: TokenPayload = {
      sub: email,
      email,
      type: 'refresh',
      jti,
    };

    const accessToken = await this.jwtService.signAsync(accessPayload, {
      algorithm: 'RS256',
      privateKey: this.privateKey,
      expiresIn: this.accessExpiry,
    });

    const refreshToken = await this.jwtService.signAsync(refreshPayload, {
      algorithm: 'RS256',
      privateKey: this.privateKey,
      expiresIn: this.refreshExpiry,
    });

    this.logger.log('Tokens signed, expiring in' + this.accessExpiry + 's (access) and ' + this.refreshExpiry + 's (refresh)');

    const hashed = await bcrypt.hash(refreshToken, 10);
    await this.refreshTokenRepo.save({
      email,
      token: hashed,
      jti,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    this.logger.log('Token pair issued and refresh token persisted');
    return { accessToken, refreshToken };
  }

  async refreshToken(refreshToken: string) {
    try {
      const payload = await this.jwtService.verifyAsync<TokenPayload>(
        refreshToken,
        {
          publicKey: this.publicKey,
          algorithms: ['RS256'],
        },
      );

      if (payload.type !== 'refresh' || !payload.jti)
        throw new UnauthorizedException();

      const entry = await this.refreshTokenRepo.findOneBy({ jti: payload.jti });
      if (!entry) {
        this.logger.warn('Refresh token rejected: token record not found');
        throw new NotFoundException();
      }

      const isValid = await bcrypt.compare(refreshToken, entry.token);

      if (!isValid) {
        this.logger.warn('Refresh token rejected: hash mismatch');
        await this.deleteToken(payload.jti, {
          message: 'Invalid or malformed refresh token',
          exception: new UnauthorizedException(),
        });
      }

      if (entry.expiresAt.getTime() < Date.now()) {
        this.logger.warn('Refresh token rejected: token expired');
        await this.deleteToken(payload.jti, {
          message: 'Refresh token has expired',
          exception: new UnauthorizedException(),
        });
      }

      await this.deleteToken(payload.jti);

      return this.issueTokens(payload.sub);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown';
      this.logger.warn('Refresh token exchange failed, reason: ' + message);
      throw new UnauthorizedException();
    }
  }

  async logout(refreshToken: string) {
    try {
      const payload = await this.jwtService.verifyAsync<TokenPayload>(
        refreshToken,
        {
          publicKey: this.publicKey,
          algorithms: ['RS256'],
        },
      );

      if (payload.type !== 'refresh' || !payload.jti) return;

      const entry = await this.refreshTokenRepo.findOneBy({ jti: payload.jti });
      if (!entry) return;

      const isValid = await bcrypt.compare(refreshToken, entry.token);
      if (!isValid) return;

      await this.refreshTokenRepo.delete({ jti: payload.jti });
      this.logger.log('Logout succeeded: refresh token invalidated');
    } catch {
      // idempotent
      this.logger.debug('Logout completed idempotently');
    }
  }

  async getUser(token: string) {
    try {
      const payload = await this.jwtService.verifyAsync<TokenPayload>(token, {
        publicKey: this.publicKey,
        algorithms: ['RS256'],
      });

      return {
        email: payload.sub,
        permissions: payload.permissions ?? [],
      };
    } catch {
      this.logger.warn('User profile lookup failed: invalid access token');
      throw new UnauthorizedException();
    }
  }

  private async deleteToken(
    jti: string,
    reason?: {
      message: string;
      exception: HttpException;
    },
  ) {
    this.logger.log('Deleting refresh token entry');
    if (reason) {
      this.logger.error(reason.message);
    }
    await this.refreshTokenRepo.delete({ jti });
    if (reason) {
      throw reason.exception;
    }
  }

  private getPermissionsForEmail(email: string): Permission[] | undefined {
    if (email.trim().toLowerCase() === this.ownerEmail) {
      return [
        { resource: 'gift', scopes: ['view', 'create', 'edit', 'delete'] },
        { resource: 'tag', scopes: ['create', 'edit', 'delete'] },
      ];
    }

    return [
      { resource: 'gift', scopes: ['view'] },
      { resource: 'tag', scopes: ['view'] },
      { resource: 'gift-reservation', scopes: ['create', 'view', 'delete'] },
    ];
  }
}
