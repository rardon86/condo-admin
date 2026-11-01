import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

export type Role = 'OWNER' | 'ADMIN' | 'ACCOUNTANT' | 'STAFF' | 'VIEWER';

export const ROLES = {
  MANAGE: ['OWNER', 'ADMIN'] as Role[],
  FIN_WRITE: ['OWNER', 'ADMIN', 'ACCOUNTANT'] as Role[],
  FIN_READ: ['OWNER', 'ADMIN', 'ACCOUNTANT', 'VIEWER'] as Role[],
  ANY: ['OWNER', 'ADMIN', 'ACCOUNTANT', 'STAFF', 'VIEWER'] as Role[],
};

export const IS_PUBLIC = 'isPublic';
export const NO_TENANT = 'noTenant';
export const ROLES_KEY = 'roles';

/** Ruta sin autenticación. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Ruta autenticada pero sin complejo seleccionado (perfil, crear complejo). */
export const NoTenant = () => SetMetadata(NO_TENANT, true);
/** Roles permitidos dentro del complejo (por defecto: cualquiera que sea miembro). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export interface AuthUser {
  id: string;
  email: string;
}
export interface TenantCtx {
  complexId: string;
  role: Role;
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user);
export const Tenant = createParamDecorator((_: unknown, ctx: ExecutionContext): TenantCtx => ctx.switchToHttp().getRequest().tenant);
