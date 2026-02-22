import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TokenPayload } from '@app/common/token-payload.type';
import * as fs from 'fs';
import { Request } from 'express';

@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  private readonly publicKey = fs.readFileSync(
    process.env.JWT_PUBLIC_KEY_PATH ?? '/etc/wishlist/certs/public.pem',
    'utf-8',
  );

  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const authHeader = req.headers['authorization'];
    if (!authHeader) return true;

    const token = authHeader.split(' ')[1];
    if (!token) return true;

    try {
      const payload = await this.jwtService.verifyAsync<TokenPayload>(token, {
        publicKey: this.publicKey,
        algorithms: ['RS256'],
      });

      if (payload.type === 'access') {
        (req as Request & { user?: TokenPayload }).user = payload;
      }
    } catch {
      // Keep endpoint public for guests/invalid tokens.
    }

    return true;
  }
}
