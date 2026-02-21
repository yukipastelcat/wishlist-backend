import { Permission } from './permission.type';

export type TokenPayload = {
  sub: string;
  email: string;
  type: 'access' | 'refresh';
  jti?: string;
  currency?: string;
  permissions?: Permission[];
  iat?: number;
  exp?: number;
};
