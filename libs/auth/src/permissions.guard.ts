import type { Permission } from '@app/common/permission.type';
import { TokenPayload } from '@app/common/token-payload.type';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.get<Permission[]>(
      'permissions',
      context.getHandler(),
    );

    if (!required || required.length === 0) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: TokenPayload }>();
    const user = request.user;

    if (!user?.permissions) {
      throw new ForbiddenException('No permissions found');
    }

    const hasPermission = required.every((requiredPermission) => {
      const userPermission = user.permissions?.find(
        (p) => p.resource === requiredPermission.resource,
      );

      if (!userPermission) return false;
      return requiredPermission.scopes.every((scope) =>
        userPermission.scopes.includes(scope),
      );
    });

    if (!hasPermission) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
