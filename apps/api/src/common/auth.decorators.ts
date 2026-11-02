import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

/** OWNER es un valor heredado y se trata igual que ADMIN. */
export type Role = 'OWNER' | 'ADMIN' | 'ACCOUNTANT' | 'STAFF' | 'VIEWER' | 'RESIDENT';

export const ROLES = {
  /** Administrador del proyecto. */
  MANAGE: ['OWNER', 'ADMIN'] as Role[],
  FIN_WRITE: ['OWNER', 'ADMIN', 'ACCOUNTANT'] as Role[],
  FIN_READ: ['OWNER', 'ADMIN', 'ACCOUNTANT', 'VIEWER'] as Role[],
  /** Todo el personal interno (nunca residentes). Es el valor por defecto de las rutas. */
  INTERNAL: ['OWNER', 'ADMIN', 'ACCOUNTANT', 'STAFF', 'VIEWER'] as Role[],
  RESIDENT: ['RESIDENT'] as Role[],
};

export const IS_PUBLIC = 'isPublic';
export const NO_TENANT = 'noTenant';
export const SUPER_ADMIN = 'superAdmin';
export const ROLES_KEY = 'roles';

/** Ruta sin autenticación. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Ruta autenticada pero sin proyecto seleccionado (perfil, etc.). */
export const NoTenant = () => SetMetadata(NO_TENANT, true);
/** Solo el superusuario de la plataforma (no requiere proyecto). */
export const SuperAdmin = () => SetMetadata(SUPER_ADMIN, true);
/**
 * Roles permitidos dentro del proyecto. Si una ruta no lo declara, solo entra personal interno:
 * los residentes únicamente acceden a rutas que los incluyan de forma explícita (deny by default).
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export interface AuthUser {
  id: string;
  email: string | null;
  isSuperAdmin: boolean;
}
export interface TenantCtx {
  complexId: string;
  role: Role;
  /** Propiedad asociada (propietarios; tabla `units`). */
  unitId: string | null;
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user);
export const Tenant = createParamDecorator((_: unknown, ctx: ExecutionContext): TenantCtx => ctx.switchToHttp().getRequest().tenant);

export const isManager = (role: Role) => role === 'OWNER' || role === 'ADMIN';
