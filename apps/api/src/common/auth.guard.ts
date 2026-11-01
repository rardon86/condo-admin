import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { and, eq } from 'drizzle-orm';
import { env } from '../config/env';
import { DB, Db } from '../db/client';
import { complexes, memberships, users } from '../db/schema';
import { IS_PUBLIC, NO_TENANT, Role, ROLES, ROLES_KEY, SUPER_ADMIN } from './auth.decorators';

/**
 * Guard global:
 *  1) Verifica el JWT de acceso (Bearer) y la versión de token del usuario (revocación).
 *  2) Rutas de plataforma (@SuperAdmin) exigen superusuario.
 *  3) Resuelve el proyecto desde `X-Complex-Id`: el superusuario entra a cualquiera como ADMIN;
 *     el resto necesita una membresía ACTIVA.
 *  4) Control por rol con denegación por defecto para residentes.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    @Inject(DB) private readonly db: Db,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Token requerido');

    let payload: { sub: string; email: string; ver: number };
    try {
      payload = await this.jwt.verifyAsync(header.slice(7), { secret: env.JWT_ACCESS_SECRET, algorithms: ['HS256'] });
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }
    const [u] = await this.db.select({ v: users.tokenVersion, sa: users.isSuperAdmin }).from(users).where(eq(users.id, payload.sub));
    if (!u || u.v !== payload.ver) throw new UnauthorizedException('Sesión revocada');
    req.user = { id: payload.sub, email: payload.email, isSuperAdmin: u.sa };

    if (this.reflector.getAllAndOverride<boolean>(SUPER_ADMIN, targets)) {
      if (!u.sa) throw new ForbiddenException('Solo el superusuario de la plataforma');
      return true;
    }
    if (this.reflector.getAllAndOverride<boolean>(NO_TENANT, targets)) return true;

    const complexId: string | undefined = req.headers['x-complex-id'];
    if (!complexId || !/^[0-9a-f-]{36}$/i.test(complexId)) throw new ForbiddenException('Seleccione un proyecto (X-Complex-Id)');

    let role: Role;
    let unitId: string | null = null;
    if (u.sa) {
      const [c] = await this.db.select({ id: complexes.id }).from(complexes).where(eq(complexes.id, complexId));
      if (!c) throw new ForbiddenException('Proyecto no encontrado');
      role = 'ADMIN';
    } else {
      const [m] = await this.db
        .select({ role: memberships.role, status: memberships.status, unitId: memberships.unitId })
        .from(memberships)
        .where(and(eq(memberships.userId, payload.sub), eq(memberships.complexId, complexId)));
      if (!m) throw new ForbiddenException('No pertenece a este proyecto');
      if (m.status !== 'ACTIVE') throw new ForbiddenException(m.status === 'PENDING' ? 'Su solicitud está pendiente de aprobación' : 'Acceso no autorizado');
      role = m.role;
      unitId = m.unitId;
    }

    const allowed = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, targets) ?? ROLES.INTERNAL;
    if (!allowed.includes(role)) throw new ForbiddenException('Permisos insuficientes');

    req.tenant = { complexId, role, unitId };
    return true;
  }
}
