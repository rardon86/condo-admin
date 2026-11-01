import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { and, eq } from 'drizzle-orm';
import { env } from '../config/env';
import { DB, Db } from '../db/client';
import { memberships, users } from '../db/schema';
import { IS_PUBLIC, NO_TENANT, Role, ROLES_KEY } from './auth.decorators';

/**
 * Guard global:
 *  1) Verifica el JWT de acceso (Bearer) y la versión de token del usuario (revocación).
 *  2) Resuelve el tenant desde el header `X-Complex-Id` y valida la membresía.
 *  3) Aplica control de acceso por rol (@Roles).
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
      payload = await this.jwt.verifyAsync(header.slice(7), { secret: env.JWT_ACCESS_SECRET });
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }
    const [u] = await this.db.select({ v: users.tokenVersion }).from(users).where(eq(users.id, payload.sub));
    if (!u || u.v !== payload.ver) throw new UnauthorizedException('Sesión revocada');
    req.user = { id: payload.sub, email: payload.email };

    if (this.reflector.getAllAndOverride<boolean>(NO_TENANT, targets)) return true;

    const complexId: string | undefined = req.headers['x-complex-id'];
    if (!complexId || !/^[0-9a-f-]{36}$/i.test(complexId)) throw new ForbiddenException('Seleccione un complejo (X-Complex-Id)');
    const [m] = await this.db
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.userId, payload.sub), eq(memberships.complexId, complexId)));
    if (!m) throw new ForbiddenException('No pertenece a este complejo');

    const allowed = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, targets);
    if (allowed && !allowed.includes(m.role)) throw new ForbiddenException('Permisos insuficientes');

    req.tenant = { complexId, role: m.role };
    return true;
  }
}
