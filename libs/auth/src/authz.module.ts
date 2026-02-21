import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';
import { PermissionsGuard } from './permissions.guard';

@Module({
  imports: [JwtModule.register({})],
  providers: [JwtAuthGuard, OptionalJwtAuthGuard, PermissionsGuard],
  exports: [JwtModule, JwtAuthGuard, OptionalJwtAuthGuard, PermissionsGuard],
})
export class AuthzModule {}
