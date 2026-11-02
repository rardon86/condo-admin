import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { and, asc, desc, eq, getTableColumns, ne, or, sql } from 'drizzle-orm';
import { logoColumns, zLogo } from '../../common/image';
import { z } from 'zod';
import { AuthUser, CurrentUser, Roles, ROLES, Tenant, TenantCtx } from '../../common/auth.decorators';
import { AuditService } from '../../common/audit.service';
import { toCents } from '../../common/money';
import { zDate, ZodPipe, zUuid } from '../../common/zod.pipe';
import { DB, Db } from '../../db/client';
import { complexes, employees, journalEntries, memberships, unitOwners, units, users } from '../../db/schema';
import { AuthService } from '../auth/auth.service';
import { SYSTEM_ACCOUNTS } from '../ledger/chart-of-accounts';
import { LedgerService } from '../ledger/ledger.service';
import { linkOwner, ownedUnitIds, phoneUsername, refreshOwnerSnapshot, setOwnedUnits, unlinkOwner } from '../units/owners';

const updateSchema = z.object({
  name: z.string().min(2).max(150).optional(),
  type: z.enum(['RESIDENTIAL', 'RECREATIONAL', 'MIXED']).optional(),
  address: z.string().max(500).nullable().optional(),
  taxId: z.string().max(30).nullable().optional(),
  currency: z.string().length(3).optional(),
  timezone: z.string().max(64).optional(),
  requireGeofence: z.boolean().optional(),
  /** Saldo inicial de caja (puede ser negativo si arranca sobregirado). */
  openingBalance: z.coerce.number().min(-999_999_999).max(999_999_999).optional(),
  openingBalanceDate: zDate.optional(),
  logo: zLogo,
  // Cuotas
  feeDueDay: z.coerce.number().int().min(1).max(28).optional(),
  autoGenerateFees: z.boolean().optional(),
  lateFeeType: z.enum(['NONE', 'FIXED', 'PERCENT']).optional(),
  lateFeeValue: z.coerce.number().min(0).max(100_000).optional(),
  lateFeeGraceDays: z.coerce.number().int().min(0).max(90).optional(),
}).refine((b) => b.lateFeeType !== 'PERCENT' || b.lateFeeValue === undefined || b.lateFeeValue <= 100, { message: 'El porcentaje de recargo no puede superar 100', path: ['lateFeeValue'] });

/** Usuarios internos (los propietarios tienen su propio alta en /current/residents). */
const memberSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  fullName: z.string().trim().min(2).max(150),
  role: z.enum(['ADMIN', 'ACCOUNTANT', 'STAFF', 'VIEWER']),
  temporaryPassword: z.string().min(8).max(128),
  phone: z.string().max(30).nullable().optional(),
});

const memberRoleSchema = z.object({ role: z.enum(['ADMIN', 'ACCOUNTANT', 'VIEWER', 'STAFF']) });

/** Alta de propietario: el teléfono es su usuario de ingreso; el correo es opcional. */
const residentCreateSchema = z.object({
  fullName: z.string().trim().min(2).max(150),
  phone: z.string({ required_error: 'Indique el teléfono: será su usuario de ingreso' }).trim().min(7, 'Indique el teléfono: será su usuario de ingreso').max(30),
  email: z.preprocess((v) => (v === '' ? null : v), z.string().trim().toLowerCase().email('Correo inválido').nullable().optional()),
  temporaryPassword: z.string().min(8).max(128),
  /** Propiedades (opcional; se pueden asignar después). */
  unitIds: z.array(zUuid).max(500).default([]),
});

const residentUpdateSchema = z.object({
  status: z.enum(['ACTIVE', 'PENDING', 'REJECTED']).optional(),
  fullName: z.string().trim().min(2).max(150).optional(),
  phone: z.string().trim().min(7).max(30).optional(),
  email: z.preprocess((v) => (v === '' ? null : v), z.string().trim().toLowerCase().email('Correo inválido').nullable().optional()),
});

const residentUnitsSchema = z.object({ unitIds: z.array(zUuid).max(500) });

@Controller('complexes')
export class ComplexesController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  @Get('current')
  async current(@Tenant() t: TenantCtx) {
    // El logo (base64) no viaja aquí: se sirve aparte con caché en /public/projects/:id/logo
    const { logo: _logo, ...cols } = getTableColumns(complexes);
    const [c] = await this.db.select(cols).from(complexes).where(eq(complexes.id, t.complexId));
    return { ...c, myRole: t.role };
  }

  @Patch('current')
  @Roles(...ROLES.MANAGE)
  async update(@Tenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Body(new ZodPipe(updateSchema)) body: z.infer<typeof updateSchema>) {
    const { openingBalance, openingBalanceDate, logo, lateFeeValue, ...rest } = body;
    await this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(complexes).where(eq(complexes.id, t.complexId));
      const patch: Partial<typeof complexes.$inferInsert> = {
        ...rest, ...logoColumns(logo), updatedAt: new Date(),
        ...(lateFeeValue !== undefined ? { lateFeeValue: lateFeeValue.toFixed(2) } : {}),
      };

      if (openingBalance !== undefined || openingBalanceDate !== undefined) {
        const amount = openingBalance !== undefined ? toCents(openingBalance) : toCents(before.openingBalance);
        const date = openingBalanceDate ?? before.openingBalanceDate ?? new Date().toISOString().slice(0, 10);
        // Se reemplaza el asiento de apertura: Caja contra Fondo inicial.
        await tx.delete(journalEntries).where(and(eq(journalEntries.complexId, t.complexId), eq(journalEntries.sourceType, 'OPENING')));
        if (amount !== 0) {
          const cash = await this.ledger.accountByCode(t.complexId, SYSTEM_ACCOUNTS.CASH, tx);
          const equity = await this.ledger.accountByCode(t.complexId, SYSTEM_ACCOUNTS.OPENING_EQUITY, tx);
          const abs = Math.abs(amount);
          await this.ledger.post(tx, {
            complexId: t.complexId,
            date,
            description: 'Saldo inicial',
            sourceType: 'OPENING',
            createdBy: u.id,
            lines:
              amount > 0
                ? [{ accountId: cash.id, debit: abs }, { accountId: equity.id, credit: abs }]
                : [{ accountId: equity.id, debit: abs }, { accountId: cash.id, credit: abs }],
          });
        }
        patch.openingBalance = (amount / 100).toFixed(2);
        patch.openingBalanceDate = date;
      }
      await tx.update(complexes).set(patch).where(eq(complexes.id, t.complexId));
      await this.audit.log({ complexId: t.complexId, userId: u.id, action: 'UPDATE', entity: 'complex', entityId: t.complexId, data: { ...body, logo: logo === undefined ? undefined : logo ? '[nuevo logo]' : null } }, tx);
    });
    return this.current(t);
  }

  // ─── Usuarios del proyecto (personal interno) ───
  @Get('current/members')
  @Roles(...ROLES.MANAGE)
  members(@Tenant() t: TenantCtx) {
    return this.db
      .select({ userId: users.id, fullName: users.fullName, email: users.email, role: memberships.role, status: memberships.status, since: memberships.createdAt })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.complexId, t.complexId))
      .orderBy(asc(users.fullName));
  }

  /**
   * Alta de usuarios internos. Si el correo ya tiene cuenta, se le da acceso al proyecto, pero nunca se
   * reutiliza en silencio a alguien que ya pertenece al proyecto (el rol se cambia en su fila).
   */
  @Post('current/members')
  @Roles(...ROLES.MANAGE)
  async addMember(@Tenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Body(new ZodPipe(memberSchema)) body: z.infer<typeof memberSchema>) {
    return this.db.transaction(async (tx) => {
      let [user] = await tx.select().from(users).where(eq(users.email, body.email));
      if (user) {
        const [m] = await tx.select({ role: memberships.role }).from(memberships).where(and(eq(memberships.userId, user.id), eq(memberships.complexId, t.complexId)));
        if (m) throw new ConflictException(`${user.fullName} ya pertenece al proyecto como ${ROLE_NAMES[m.role]}; cambie su rol en la lista.`);
      } else {
        [user] = await tx.insert(users).values({ email: body.email, fullName: body.fullName, phone: body.phone ?? null, passwordHash: await this.auth.hash(body.temporaryPassword) }).returning();
      }
      await tx.insert(memberships).values({ userId: user.id, complexId: t.complexId, role: body.role, status: 'ACTIVE' });
      await this.audit.log({ complexId: t.complexId, userId: u.id, action: 'ADD_MEMBER', entity: 'user', entityId: user.id, data: { role: body.role } }, tx);
      return { userId: user.id, email: body.email, fullName: user.fullName, role: body.role };
    });
  }

  /** Cambiar el rol de un usuario interno del proyecto. */
  @Patch('current/members/:userId')
  @Roles(...ROLES.MANAGE)
  async setMemberRole(@Tenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Param('userId', ParseUUIDPipe) userId: string, @Body(new ZodPipe(memberRoleSchema)) b: z.infer<typeof memberRoleSchema>) {
    if (userId === u.id) throw new BadRequestException('No puede cambiar su propio rol');
    const where = and(eq(memberships.userId, userId), eq(memberships.complexId, t.complexId));
    const [cur] = await this.db.select({ role: memberships.role }).from(memberships).where(where);
    if (!cur) throw new NotFoundException();
    if (cur.role === 'RESIDENT') throw new BadRequestException('Use Propietarios para gestionar propietarios');
    const [row] = await this.db.update(memberships).set({ role: b.role, updatedAt: new Date() }).where(where).returning();
    await this.audit.log({ complexId: t.complexId, userId: u.id, action: 'SET_ROLE', entity: 'user', entityId: userId, data: b });
    return row;
  }

  /** Quitar el acceso de un usuario a este proyecto (la cuenta sigue existiendo). */
  @Delete('current/members/:userId')
  @Roles(...ROLES.MANAGE)
  async removeMember(@Tenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Param('userId', ParseUUIDPipe) userId: string) {
    if (userId === u.id) throw new BadRequestException('No puede quitarse el acceso a sí mismo');
    const res = await this.db.delete(memberships).where(and(eq(memberships.userId, userId), eq(memberships.complexId, t.complexId))).returning({ id: memberships.id });
    if (!res.length) throw new NotFoundException();
    await this.audit.log({ complexId: t.complexId, userId: u.id, action: 'REMOVE_MEMBER', entity: 'user', entityId: userId });
    return { ok: true };
  }


  // ─── Propietarios ───

  /** Propietarios del proyecto con sus propiedades (pendientes primero). */
  @Get('current/residents')
  @Roles(...ROLES.MANAGE)
  async residents(@Tenant() t: TenantCtx) {
    const rows = await this.db
      .select({
        userId: users.id, fullName: users.fullName, email: users.email, phone: users.phone, username: users.username,
        status: memberships.status, since: memberships.createdAt, requestedUnitId: memberships.unitId,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.complexId, t.complexId), eq(memberships.role, 'RESIDENT')))
      .orderBy(desc(memberships.status), asc(users.fullName));
    const links = await this.db
      .select({ userId: unitOwners.userId, id: units.id, code: units.code, address: units.address })
      .from(unitOwners)
      .innerJoin(units, eq(units.id, unitOwners.unitId))
      .where(eq(unitOwners.complexId, t.complexId))
      .orderBy(asc(units.code));
    const codes = await this.db.select({ id: units.id, code: units.code }).from(units).where(eq(units.complexId, t.complexId));
    return rows.map(({ requestedUnitId, ...r }) => ({
      ...r,
      properties: links.filter((l) => l.userId === r.userId).map(({ userId: _u, ...l }) => l),
      // Lo que indicó al registrarse (solo informa mientras está pendiente)
      requestedUnit: r.status === 'PENDING' ? (codes.find((x) => x.id === requestedUnitId)?.code ?? null) : null,
    }));
  }

  /**
   * Alta de propietario por la administración. Su teléfono es el usuario de ingreso. Si esa persona ya
   * tiene cuenta (p. ej. es propietario en otro proyecto), se le da acceso aquí sin cambiar su contraseña;
   * si ya pertenece a este proyecto, se rechaza para no reutilizarla por error.
   */
  @Post('current/residents')
  @Roles(...ROLES.MANAGE)
  async createResident(@Tenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Body(new ZodPipe(residentCreateSchema)) b: z.infer<typeof residentCreateSchema>) {
    const username = phoneUsername(b.phone);
    return this.db.transaction(async (tx) => {
      const found = await tx
        .select()
        .from(users)
        .where(b.email ? or(eq(users.username, username), eq(users.email, b.email)) : eq(users.username, username));
      if (found.length > 1) throw new ConflictException('El teléfono y el correo pertenecen a personas distintas; revise los datos.');
      let [user] = found;
      let existing = false;
      if (user) {
        const [m] = await tx.select({ role: memberships.role }).from(memberships).where(and(eq(memberships.userId, user.id), eq(memberships.complexId, t.complexId)));
        if (m) {
          throw new ConflictException(
            m.role === 'RESIDENT'
              ? `${user.fullName} ya está registrado como propietario. Asígnele más propiedades desde su fila en Propietarios.`
              : `Ese teléfono o correo pertenece a ${user.fullName}, que es ${ROLE_NAMES[m.role]} del proyecto.`,
          );
        }
        if (user.isSuperAdmin) throw new ConflictException('Ese teléfono o correo pertenece a un superusuario de la plataforma.');
        existing = true;
      } else {
        [user] = await tx
          .insert(users)
          .values({ fullName: b.fullName, phone: b.phone, username, email: b.email ?? null, passwordHash: await this.auth.hash(b.temporaryPassword) })
          .returning();
      }
      await tx.insert(memberships).values({ userId: user.id, complexId: t.complexId, role: 'RESIDENT', status: 'ACTIVE' });
      for (const unitId of [...new Set(b.unitIds)]) await linkOwner(tx, t.complexId, unitId, user.id);
      await this.audit.log({ complexId: t.complexId, userId: u.id, action: 'CREATE_RESIDENT', entity: 'user', entityId: user.id, data: { username, unitIds: b.unitIds, existing } }, tx);
      return { userId: user.id, username: user.username, fullName: user.fullName, existing };
    });
  }

  /** Aprobar, desactivar (REJECTED) o reactivar un propietario, y corregir sus datos de contacto. */
  @Patch('current/residents/:userId')
  @Roles(...ROLES.MANAGE)
  async updateResident(
    @Tenant() t: TenantCtx,
    @CurrentUser() u: AuthUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(new ZodPipe(residentUpdateSchema)) body: z.infer<typeof residentUpdateSchema>,
  ) {
    const where = and(eq(memberships.userId, userId), eq(memberships.complexId, t.complexId), eq(memberships.role, 'RESIDENT'));
    return this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(memberships).where(where);
      if (!current) throw new NotFoundException();
      const { status, ...contact } = body;
      if (Object.values(contact).some((v) => v !== undefined)) {
        const patch: Partial<typeof users.$inferInsert> = { fullName: contact.fullName, email: contact.email, updatedAt: new Date() };
        if (contact.phone) Object.assign(patch, { phone: contact.phone, username: phoneUsername(contact.phone) });
        const checks = [patch.username ? eq(users.username, patch.username) : undefined, contact.email ? eq(users.email, contact.email) : undefined].filter((c) => c !== undefined);
        if (checks.length) {
          const [clash] = await tx.select({ id: users.id }).from(users).where(and(ne(users.id, userId), or(...checks)));
          if (clash) throw new ConflictException('Ese teléfono o correo ya pertenece a otra cuenta.');
        }
        await tx.update(users).set(patch).where(eq(users.id, userId));
        for (const unitId of await ownedUnitIds(tx, t.complexId, userId)) await refreshOwnerSnapshot(tx, unitId);
      }
      if (status) {
        await tx.update(memberships).set({ status, updatedAt: new Date() }).where(where);
        // Al aprobar una solicitud, se vincula la propiedad que indicó al registrarse
        if (status === 'ACTIVE' && current.unitId && !(await ownedUnitIds(tx, t.complexId, userId)).length) {
          await linkOwner(tx, t.complexId, current.unitId, userId);
        }
      }
      await this.audit.log({ complexId: t.complexId, userId: u.id, action: 'UPDATE_RESIDENT', entity: 'user', entityId: userId, data: body }, tx);
      return { ok: true };
    });
  }

  /** Deja al propietario con exactamente estas propiedades. */
  @Put('current/residents/:userId/units')
  @Roles(...ROLES.MANAGE)
  async setResidentUnits(@Tenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Param('userId', ParseUUIDPipe) userId: string, @Body(new ZodPipe(residentUnitsSchema)) b: z.infer<typeof residentUnitsSchema>) {
    await this.db.transaction((tx) => setOwnedUnits(tx, t.complexId, userId, b.unitIds));
    await this.audit.log({ complexId: t.complexId, userId: u.id, action: 'SET_RESIDENT_UNITS', entity: 'user', entityId: userId, data: b });
    return { ok: true };
  }

  /**
   * Elimina al propietario del proyecto: se desvincula de sus propiedades y pierde el acceso. Su historia
   * (pagos, consultas) se conserva. Si no le queda acceso a ningún proyecto, su cuenta se desactiva.
   */
  @Delete('current/residents/:userId')
  @Roles(...ROLES.MANAGE)
  async removeResident(@Tenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.db.transaction(async (tx) => {
      const where = and(eq(memberships.userId, userId), eq(memberships.complexId, t.complexId), eq(memberships.role, 'RESIDENT'));
      const [m] = await tx.select({ id: memberships.id }).from(memberships).where(where);
      if (!m) throw new NotFoundException();
      for (const unitId of await ownedUnitIds(tx, t.complexId, userId)) await unlinkOwner(tx, t.complexId, unitId, userId);
      await tx.delete(memberships).where(where);
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(memberships).where(eq(memberships.userId, userId));
      const [usr] = await tx.select({ sa: users.isSuperAdmin, v: users.tokenVersion }).from(users).where(eq(users.id, userId));
      const [emp] = await tx.select({ id: employees.id }).from(employees).where(eq(employees.userId, userId));
      const deactivated = !n && !usr.sa && !emp;
      if (deactivated) await tx.update(users).set({ active: false, tokenVersion: usr.v + 1, updatedAt: new Date() }).where(eq(users.id, userId));
      await this.audit.log({ complexId: t.complexId, userId: u.id, action: 'REMOVE_RESIDENT', entity: 'user', entityId: userId, data: { deactivated } }, tx);
      return { ok: true, deactivated };
    });
  }
}

const ROLE_NAMES: Record<string, string> = { OWNER: 'administrador', ADMIN: 'administrador', ACCOUNTANT: 'contador', STAFF: 'personal', VIEWER: 'junta / consulta', RESIDENT: 'propietario' };
