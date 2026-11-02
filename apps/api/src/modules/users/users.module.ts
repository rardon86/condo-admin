import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Inject, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service';
import { AuthUser, CurrentUser, SuperAdmin } from '../../common/auth.decorators';
import { ZodPipe, zUuid } from '../../common/zod.pipe';
import { DB, Db, Tx } from '../../db/client';
import { complexes, memberships, units, users } from '../../db/schema';
import { AuthService } from '../auth/auth.service';
import { setPropertyOwner } from '../units/units.module';

const zUsername = z.string().trim().toLowerCase().min(3).max(60).regex(/^[a-z0-9._-]+$/, 'Usuario: solo letras, números, punto, guion y guion bajo');
const zRole = z.enum(['ADMIN', 'ACCOUNTANT', 'STAFF', 'VIEWER', 'RESIDENT']);

const membershipSchema = z.object({
  role: zRole,
  status: z.enum(['ACTIVE', 'PENDING', 'REJECTED']).default('ACTIVE'),
  /** Propiedad (solo propietarios). */
  unitId: zUuid.nullable().optional(),
});

const createSchema = z.object({
  fullName: z.string().trim().min(2).max(150),
  email: z.string().trim().toLowerCase().email(),
  username: zUsername.nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  password: z.string().min(8).max(128),
  isSuperAdmin: z.boolean().default(false),
  /** Acceso inicial a un proyecto (opcional). */
  complexId: zUuid.optional(),
  membership: membershipSchema.optional(),
});

const updateSchema = z.object({
  fullName: z.string().trim().min(2).max(150).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  username: zUsername.nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  isSuperAdmin: z.boolean().optional(),
  active: z.boolean().optional(),
  /** Restablecer contraseña (cierra sus sesiones). */
  password: z.string().min(8).max(128).optional(),
});

/** Gestión de usuarios de la plataforma (solo superusuario). */
@Injectable()
export class UsersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const rows = await this.db
      .select({
        id: users.id, fullName: users.fullName, email: users.email, username: users.username, phone: users.phone,
        isSuperAdmin: users.isSuperAdmin, active: users.active, lastLoginAt: users.lastLoginAt, createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(asc(users.fullName));
    const ms = await this.db
      .select({ userId: memberships.userId, complexId: complexes.id, complexName: complexes.name, role: memberships.role, status: memberships.status, unitId: memberships.unitId, unitCode: units.code })
      .from(memberships)
      .innerJoin(complexes, eq(complexes.id, memberships.complexId))
      .leftJoin(units, eq(units.id, memberships.unitId))
      .orderBy(asc(complexes.name));
    return rows.map((u) => ({ ...u, memberships: ms.filter((m) => m.userId === u.id).map(({ userId: _u, ...m }) => m) }));
  }

  units(complexId: string) {
    return this.db.select({ id: units.id, code: units.code, ownerName: units.ownerName }).from(units).where(and(eq(units.complexId, complexId), eq(units.active, true))).orderBy(asc(units.code));
  }

  private async assertUnique(tx: Tx, b: { email?: string; username?: string | null }, exceptId?: string) {
    if (b.email) {
      const [x] = await tx.select({ id: users.id }).from(users).where(and(eq(users.email, b.email), exceptId ? ne(users.id, exceptId) : undefined));
      if (x) throw new ConflictException('Ya existe un usuario con ese correo');
    }
    if (b.username) {
      const [x] = await tx.select({ id: users.id }).from(users).where(and(eq(users.username, b.username), exceptId ? ne(users.id, exceptId) : undefined));
      if (x) throw new ConflictException('Ese nombre de usuario ya está en uso');
    }
  }

  async create(actor: string, b: z.infer<typeof createSchema>) {
    return this.db.transaction(async (tx) => {
      await this.assertUnique(tx, b);
      const [u] = await tx
        .insert(users)
        .values({ fullName: b.fullName, email: b.email, username: b.username ?? null, phone: b.phone ?? null, isSuperAdmin: b.isSuperAdmin, passwordHash: await this.auth.hash(b.password) })
        .returning({ id: users.id });
      if (b.complexId && b.membership) await this.upsertMembership(tx, u.id, b.complexId, b.membership);
      await this.audit.log({ userId: actor, action: 'CREATE_USER', entity: 'user', entityId: u.id, data: { email: b.email, isSuperAdmin: b.isSuperAdmin } }, tx);
      return u;
    });
  }

  /** Debe quedar al menos un superusuario activo en la plataforma. */
  private async assertOtherSuperAdmin(tx: Tx, userId: string) {
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(users).where(and(eq(users.isSuperAdmin, true), eq(users.active, true), ne(users.id, userId)));
    if (!n) throw new BadRequestException('Debe quedar al menos un superusuario activo');
  }

  async update(actor: string, id: string, b: z.infer<typeof updateSchema>) {
    return this.db.transaction(async (tx) => {
      const [cur] = await tx.select().from(users).where(eq(users.id, id));
      if (!cur) throw new NotFoundException();
      if (id === actor && (b.active === false || b.isSuperAdmin === false)) throw new BadRequestException('No puede desactivarse ni quitarse el superusuario a sí mismo');
      if (cur.isSuperAdmin && (b.active === false || b.isSuperAdmin === false)) await this.assertOtherSuperAdmin(tx, id);
      await this.assertUnique(tx, b, id);
      const { password, ...rest } = b;
      // Cambiar contraseña, desactivar o quitar superusuario cierra las sesiones abiertas
      const revoke = !!password || b.active === false || (cur.isSuperAdmin && b.isSuperAdmin === false);
      await tx
        .update(users)
        .set({
          ...rest,
          ...(password ? { passwordHash: await this.auth.hash(password), failedLogins: 0, lockedUntil: null } : {}),
          ...(revoke ? { tokenVersion: cur.tokenVersion + 1 } : {}),
          updatedAt: new Date(),
        })
        .where(eq(users.id, id));
      await this.audit.log({ userId: actor, action: 'UPDATE_USER', entity: 'user', entityId: id, data: { ...rest, passwordReset: !!password } }, tx);
      return { ok: true };
    });
  }

  private async upsertMembership(tx: Tx, userId: string, complexId: string, b: z.infer<typeof membershipSchema>) {
    const [c] = await tx.select({ id: complexes.id }).from(complexes).where(eq(complexes.id, complexId));
    if (!c) throw new BadRequestException('Proyecto inválido');
    const unitId = b.role === 'RESIDENT' ? (b.unitId ?? null) : null;
    if (unitId) {
      const [x] = await tx.select({ id: units.id }).from(units).where(and(eq(units.id, unitId), eq(units.complexId, complexId)));
      if (!x) throw new BadRequestException('Propiedad inválida para ese proyecto');
    }
    if (b.role === 'RESIDENT' && b.status === 'ACTIVE' && !unitId) throw new BadRequestException('Asigne una propiedad al propietario');
    await tx
      .insert(memberships)
      .values({ userId, complexId, role: b.role, status: b.status, unitId })
      .onConflictDoUpdate({ target: [memberships.userId, memberships.complexId], set: { role: b.role, status: b.status, unitId, updatedAt: new Date() } });
    // La propiedad queda a nombre de este propietario si no tenía uno registrado
    if (unitId && b.status === 'ACTIVE') {
      const [u] = await tx.select({ ownerUserId: units.ownerUserId }).from(units).where(eq(units.id, unitId));
      if (!u.ownerUserId) await setPropertyOwner(tx, complexId, unitId, userId);
    }
  }

  async setMembership(actor: string, userId: string, complexId: string, b: z.infer<typeof membershipSchema>) {
    return this.db.transaction(async (tx) => {
      const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId));
      if (!u) throw new NotFoundException();
      await this.upsertMembership(tx, userId, complexId, b);
      await this.audit.log({ complexId, userId: actor, action: 'SET_MEMBERSHIP', entity: 'user', entityId: userId, data: b }, tx);
      return { ok: true };
    });
  }

  async removeMembership(actor: string, userId: string, complexId: string) {
    const res = await this.db.delete(memberships).where(and(eq(memberships.userId, userId), eq(memberships.complexId, complexId))).returning({ id: memberships.id });
    if (!res.length) throw new NotFoundException();
    await this.audit.log({ complexId, userId: actor, action: 'REMOVE_MEMBERSHIP', entity: 'user', entityId: userId });
    return { ok: true };
  }
}

@Controller('admin/users')
@SuperAdmin()
export class UsersController {
  constructor(private readonly svc: UsersService) {}

  @Get()
  list() {
    return this.svc.list();
  }

  /** Propiedades de un proyecto (para asignar la de un propietario). */
  @Get('projects/:complexId/units')
  units(@Param('complexId', ParseUUIDPipe) complexId: string) {
    return this.svc.units(complexId);
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(createSchema)) b: z.infer<typeof createSchema>) {
    return this.svc.create(u.id, b);
  }

  @Patch(':id')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateSchema)) b: z.infer<typeof updateSchema>) {
    return this.svc.update(u.id, id, b);
  }

  /** Alta o cambio de rol/estado/propiedad del usuario en un proyecto. */
  @Put(':id/memberships/:complexId')
  setMembership(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('complexId', ParseUUIDPipe) complexId: string,
    @Body(new ZodPipe(membershipSchema)) b: z.infer<typeof membershipSchema>,
  ) {
    return this.svc.setMembership(u.id, id, complexId, b);
  }

  @Delete(':id/memberships/:complexId')
  removeMembership(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('complexId', ParseUUIDPipe) complexId: string) {
    return this.svc.removeMembership(u.id, id, complexId);
  }
}

@Module({ controllers: [UsersController], providers: [UsersService] })
export class UsersModule {}
