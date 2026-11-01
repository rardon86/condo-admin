import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { and, asc, desc, eq, getTableColumns } from 'drizzle-orm';
import { logoColumns, zLogo } from '../../common/image';
import { z } from 'zod';
import { AuthUser, CurrentUser, Roles, ROLES, Tenant, TenantCtx } from '../../common/auth.decorators';
import { AuditService } from '../../common/audit.service';
import { toCents } from '../../common/money';
import { zDate, ZodPipe, zUuid } from '../../common/zod.pipe';
import { DB, Db } from '../../db/client';
import { complexes, journalEntries, memberships, units, users } from '../../db/schema';
import { AuthService } from '../auth/auth.service';
import { SYSTEM_ACCOUNTS } from '../ledger/chart-of-accounts';
import { LedgerService } from '../ledger/ledger.service';

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
});

const memberSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(2).max(150),
  role: z.enum(['ADMIN', 'ACCOUNTANT', 'STAFF', 'VIEWER', 'RESIDENT']),
  temporaryPassword: z.string().min(8).max(128),
  /** Para residentes: unidad a la que pertenece. */
  unitId: zUuid.nullable().optional(),
});

const residentUpdateSchema = z.object({
  status: z.enum(['ACTIVE', 'PENDING', 'REJECTED']).optional(),
  unitId: zUuid.nullable().optional(),
});

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
    const { openingBalance, openingBalanceDate, logo, ...rest } = body;
    await this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(complexes).where(eq(complexes.id, t.complexId));
      const patch: Partial<typeof complexes.$inferInsert> = { ...rest, ...logoColumns(logo), updatedAt: new Date() };

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

  /** Alta de usuarios del proyecto. Si el correo ya existe, solo se vincula. */
  @Post('current/members')
  @Roles(...ROLES.MANAGE)
  async addMember(@Tenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Body(new ZodPipe(memberSchema)) body: z.infer<typeof memberSchema>) {
    const email = body.email.toLowerCase().trim();
    if (body.unitId) await this.assertUnit(t.complexId, body.unitId);
    return this.db.transaction(async (tx) => {
      let [user] = await tx.select().from(users).where(eq(users.email, email));
      if (!user) {
        [user] = await tx.insert(users).values({ email, fullName: body.fullName, passwordHash: await this.auth.hash(body.temporaryPassword) }).returning();
      }
      const unitId = body.role === 'RESIDENT' ? (body.unitId ?? null) : null;
      await tx
        .insert(memberships)
        .values({ userId: user.id, complexId: t.complexId, role: body.role, status: 'ACTIVE', unitId })
        .onConflictDoUpdate({ target: [memberships.userId, memberships.complexId], set: { role: body.role, status: 'ACTIVE', unitId, updatedAt: new Date() } });
      await this.audit.log({ complexId: t.complexId, userId: u.id, action: 'ADD_MEMBER', entity: 'user', entityId: user.id, data: { role: body.role } }, tx);
      return { userId: user.id, email, fullName: user.fullName, role: body.role };
    });
  }

  // ─── Propietarios / residentes ───

  /** Residentes del proyecto, con su unidad y estado (pendientes primero). */
  @Get('current/residents')
  @Roles(...ROLES.MANAGE)
  residents(@Tenant() t: TenantCtx) {
    return this.db
      .select({
        userId: users.id, fullName: users.fullName, email: users.email, phone: users.phone,
        status: memberships.status, unitId: units.id, unitCode: units.code, since: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .leftJoin(units, eq(units.id, memberships.unitId))
      .where(and(eq(memberships.complexId, t.complexId), eq(memberships.role, 'RESIDENT')))
      .orderBy(desc(memberships.status), asc(users.fullName));
  }

  /** Aprobar / rechazar una solicitud o cambiar la unidad del residente. */
  @Patch('current/residents/:userId')
  @Roles(...ROLES.MANAGE)
  async updateResident(
    @Tenant() t: TenantCtx,
    @CurrentUser() u: AuthUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(new ZodPipe(residentUpdateSchema)) body: z.infer<typeof residentUpdateSchema>,
  ) {
    if (body.unitId) await this.assertUnit(t.complexId, body.unitId);
    if (body.status === 'ACTIVE' && body.unitId === null) throw new BadRequestException('Asigne una unidad antes de aprobar');
    const where = and(eq(memberships.userId, userId), eq(memberships.complexId, t.complexId), eq(memberships.role, 'RESIDENT'));
    const [current] = await this.db.select().from(memberships).where(where);
    if (!current) throw new NotFoundException();
    if (body.status === 'ACTIVE' && !current.unitId && !body.unitId) throw new BadRequestException('Asigne una unidad antes de aprobar');
    const [row] = await this.db.update(memberships).set({ ...body, updatedAt: new Date() }).where(where).returning();
    await this.audit.log({ complexId: t.complexId, userId: u.id, action: 'UPDATE_RESIDENT', entity: 'user', entityId: userId, data: body });
    return row;
  }

  private async assertUnit(complexId: string, unitId: string) {
    const [x] = await this.db.select({ id: units.id }).from(units).where(and(eq(units.id, unitId), eq(units.complexId, complexId)));
    if (!x) throw new BadRequestException('Unidad inválida');
  }
}
