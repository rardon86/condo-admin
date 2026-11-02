import { Body, ConflictException, Controller, Get, Header, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AuthUser, CurrentUser, NoTenant, Public } from '../../common/auth.decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { DB, Db } from '../../db/client';
import { complexes, memberships, units, users } from '../../db/schema';
import { AuthService } from './auth.service';
import { phoneUsername } from '../units/owners';

const password = z
  .string()
  .min(8, 'Mínimo 8 caracteres')
  .max(128)
  .regex(/[A-Za-z]/, 'Debe incluir letras')
  .regex(/\d/, 'Debe incluir números');

const registerSchema = z.object({
  fullName: z.string().min(2).max(150),
  email: z.preprocess((v) => (v === '' ? null : v), z.string().email('Correo inválido').nullable().optional()),
  password,
  /** Será su usuario de ingreso. */
  phone: z.string({ required_error: 'Indique su teléfono: será su usuario de ingreso' }).trim().min(7, 'Indique su teléfono: será su usuario de ingreso').max(30),
  complexId: z.string().uuid('Seleccione su proyecto'),
  unitCode: z.string().min(1, 'Indique el código de su propiedad').max(30),
});
const loginSchema = z.object({ email: z.string().min(1), password: z.string().min(1) });
const refreshSchema = z.object({ refreshToken: z.string().min(10) });
const updateMeSchema = z.object({
  fullName: z.string().min(2).max(150).optional(),
  phone: z.string().max(30).nullable().optional(),
  email: z.string().email().optional(),
});
const passwordSchema = z.object({ currentPassword: z.string().min(1), newPassword: password });

@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(DB) private readonly db: Db,
  ) {}

  /** Proyectos activos disponibles para que un propietario se registre (solo nombre). */
  @Public()
  @Get('public/projects')
  projects() {
    return this.db.select({ id: complexes.id, name: complexes.name }).from(complexes).where(eq(complexes.active, true)).orderBy(asc(complexes.name));
  }

  /**
   * Logo del proyecto como imagen (no es información sensible). Caché larga: el cliente
   * agrega ?v=<fecha de actualización> para invalidarla cuando cambia.
   */
  @Public()
  @Get('public/projects/:id/logo')
  @Header('Cache-Control', 'public, max-age=604800, immutable')
  @Header('X-Content-Type-Options', 'nosniff')
  async logo(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const [c] = await this.db.select({ logo: complexes.logo, mime: complexes.logoMime }).from(complexes).where(eq(complexes.id, id));
    if (!c?.logo || !c.mime) throw new NotFoundException();
    res.setHeader('Content-Type', c.mime);
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'");
    return new StreamableFile(Buffer.from(c.logo, 'base64'));
  }

  // ─── Crear cuenta (propietario/residente) / sesión ───
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('auth/register')
  register(@Body(new ZodPipe(registerSchema)) body: z.infer<typeof registerSchema>) {
    return this.auth.registerResident(body);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('auth/login')
  login(@Body(new ZodPipe(loginSchema)) body: z.infer<typeof loginSchema>) {
    return this.auth.login(body.email, body.password);
  }

  @Public()
  @HttpCode(200)
  @Post('auth/refresh')
  refresh(@Body(new ZodPipe(refreshSchema)) body: z.infer<typeof refreshSchema>) {
    return this.auth.refresh(body.refreshToken);
  }

  @NoTenant()
  @HttpCode(204)
  @Post('auth/logout-all')
  async logoutAll(@CurrentUser() u: AuthUser) {
    await this.auth.logoutAll(u.id);
  }

  // ─── Gestión de cuenta ───
  @NoTenant()
  @Get('me')
  async me(@CurrentUser() u: AuthUser) {
    const [user] = await this.db
      .select({
        id: users.id, email: users.email, username: users.username, fullName: users.fullName, phone: users.phone,
        isSuperAdmin: users.isSuperAdmin, emailVerifiedAt: users.emailVerifiedAt, createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, u.id));

    // El superusuario ve todos los proyectos como administrador.
    const complexList = user.isSuperAdmin
      ? (await this.db.select({ id: complexes.id, name: complexes.name, type: complexes.type, logoUpdatedAt: complexes.logoUpdatedAt }).from(complexes).orderBy(asc(complexes.name))).map((c) => ({
          ...c, role: 'ADMIN', status: 'ACTIVE', unitCode: null as string | null,
        }))
      : await this.db
          .select({ id: complexes.id, name: complexes.name, type: complexes.type, logoUpdatedAt: complexes.logoUpdatedAt, role: memberships.role, status: memberships.status,
            // Todas sus propiedades en ese proyecto (texto constante: subconsulta correlacionada con tablas explícitas)
            unitCode: sql<string | null>`coalesce((select string_agg(u.code, ', ' order by u.code) from unit_owners o join units u on u.id = o.unit_id where o.user_id = "memberships"."user_id" and o.complex_id = "memberships"."complex_id"), ${units.code})` })
          .from(memberships)
          .innerJoin(complexes, eq(complexes.id, memberships.complexId))
          .leftJoin(units, eq(units.id, memberships.unitId))
          .where(eq(memberships.userId, u.id));
    return {
      ...user,
      complexes: complexList.map(({ logoUpdatedAt, ...c }) => ({ ...c, logoVersion: logoUpdatedAt ? logoUpdatedAt.toISOString() : null })),
    };
  }

  @NoTenant()
  @Patch('me')
  async updateMe(@CurrentUser() u: AuthUser, @Body(new ZodPipe(updateMeSchema)) body: z.infer<typeof updateMeSchema>) {
    const patch: Partial<typeof users.$inferInsert> = { ...body, email: body.email?.toLowerCase().trim() };
    if (patch.email) {
      const [taken] = await this.db.select({ id: users.id }).from(users).where(and(eq(users.email, patch.email), ne(users.id, u.id)));
      if (taken) throw new ConflictException('Ese correo ya está en uso');
    }
    // Quien ingresa con su teléfono (usuario = sus dígitos) cambia también su usuario al cambiar el teléfono
    if (body.phone) {
      const [cur] = await this.db.select({ username: users.username, phone: users.phone }).from(users).where(eq(users.id, u.id));
      if (cur.username && cur.phone && cur.username === cur.phone.replace(/\D/g, '')) {
        const username = phoneUsername(body.phone);
        const [taken] = await this.db.select({ id: users.id }).from(users).where(and(eq(users.username, username), ne(users.id, u.id)));
        if (taken) throw new ConflictException('Ese teléfono ya pertenece a otra cuenta');
        patch.username = username;
      }
    }
    await this.db.update(users).set({ ...patch, updatedAt: new Date() }).where(eq(users.id, u.id));
    return this.me(u);
  }

  @NoTenant()
  @HttpCode(200)
  @Post('me/password')
  changePassword(@CurrentUser() u: AuthUser, @Body(new ZodPipe(passwordSchema)) body: z.infer<typeof passwordSchema>) {
    return this.auth.changePassword(u.id, body.currentPassword, body.newPassword);
  }
}
