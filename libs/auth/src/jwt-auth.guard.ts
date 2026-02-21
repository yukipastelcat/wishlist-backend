import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TokenPayload } from '@app/common/token-payload.type';
import * as fs from 'fs';
import { Request } from 'express';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly publicKey = fs.readFileSync(
    process.env.JWT_PUBLIC_KEY_PATH ?? './keys/public_rsa.pem',
    'utf-8',
  );

  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const authHeader = req.headers['authorization'] as string | undefined;

    if (!authHeader) throw new UnauthorizedException('No authorization header');

    const token = authHeader.split(' ')[1];
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
