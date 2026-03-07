import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TokenPayload } from '@app/common/token-payload.type';
import { extractBearerToken } from './bearer-token.util';
import * as fs from 'fs';
import { Request } from 'express';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly publicKey = fs.readFileSync(
    process.env.JWT_PUBLIC_KEY_PATH ?? '/etc/wishlist/certs/public.pem',
    'utf-8',
  );

  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(req.headers['authorization']);
    if (!token) throw new UnauthorizedException('Invalid authorization header');

    try {
      const payload = await this.jwtService.verifyAsync<TokenPayload>(token, {
        publicKey: this.publicKey,
        algorithms: ['RS256'],
      });

      if (payload.type !== 'access') {
        throw new UnauthorizedException('Invalid token type');
      }

      (req as Request & { user?: TokenPayload }).user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }
}
