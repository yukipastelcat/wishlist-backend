import { SetMetadata } from '@nestjs/common';
import { Permission } from '@app/common/permission.type';

export const Permissions = (...permissions: Permission[]) =>
  SetMetadata('permissions', permissions);
