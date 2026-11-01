import { Body, Controller, Get, Inject, Patch, Post } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { AuthUser, CurrentUser, NoTenant, Roles, ROLES, Tenant, TenantCtx } from '../../common/auth.decorators';
import { AuditService } from '../../common/audit.service';
import { toCents } from '../../common/money';
import { zDate, ZodPipe } from '../../common/zod.pipe';
import { DB, Db } from '../../db/client';
import { complexes, journalEntries, memberships, users } from '../../db/schema';
import { AuthService } from '../auth/auth.service';
import { SYSTEM_ACCOUNTS } from '../ledger/chart-of-accounts';
import { LedgerService } from '../ledger/ledger.service';

const createSchema = z.object({
  name: z.string().min(2).max(150),
  type: z.enum(['RESIDENTIAL', 'RECREATIONAL', 'MIXED']).default('RESIDENTIAL'),
});

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
});

const memberSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(2).max(150),
  role: z.enum(['ADMIN', 'ACCOUNTANT', 'STAFF', 'VIEWER']),
  temporaryPassword: z.string().min(8).max(128),
});

@Controller('complexes')
export class ComplexesController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  /** Crear un complejo adicional (el usuario queda como OWNER). */
  @NoTenant()
  @Post()
  async create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(createSchema)) body: z.infer<typeof createSchema>) {
    return this.db.transaction(async (tx) => {
      const [c] = await tx.insert(complexes).values(body).returning();
      await tx.insert(memberships).values({ userId: u.id, complexId: c.id, role: 'OWNER' });
      await this.ledger.seedChart(c.id, tx);
      return c;
    });
  }

  @Get('current')
  async current(@Tenant() t: TenantCtx) {
    const [c] = await this.db.select().from(complexes).where(eq(complexes.id, t.complexId));
    return { ...c, myRole: t.role };
  }

  @Patch('current')
  @Roles(...ROLES.MANAGE)
  async update(@Tenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Body(new ZodPipe(updateSchema)) body: z.infer<typeof updateSchema>) {
    const { openingBalance, openingBalanceDate, ...rest } = body;
    await this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(complexes).where(eq(complexes.id, t.complexId));
      const patch: Partial<typeof complexes.$inferInsert> = { ...rest, updatedAt: new Date() };

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
      await this.audit.log({ complexId: t.complexId, userId: u.id, action: 'UPDATE', entity: 'complex', entityId: t.complexId, data: body }, tx);
    });
    return this.current(t);
  }

  // ─── Usuarios del complejo ───
  @Get('current/members')
  @Roles(...ROLES.MANAGE)
  members(@Tenant() t: TenantCtx) {
    return this.db
      .select({ userId: users.id, fullName: users.fullName, email: users.email, role: memberships.role, since: memberships.createdAt })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.complexId, t.complexId));
  }

  /** Alta de usuarios (p. ej. personal que marcará asistencia). Si el correo ya existe, solo se vincula. */
  @Post('current/members')
  @Roles(...ROLES.MANAGE)
  async addMember(@Tenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Body(new ZodPipe(memberSchema)) body: z.infer<typeof memberSchema>) {
    const email = body.email.toLowerCase().trim();
    return this.db.transaction(async (tx) => {
      let [user] = await tx.select().from(users).where(eq(users.email, email));
      if (!user) {
        [user] = await tx.insert(users).values({ email, fullName: body.fullName, passwordHash: await this.auth.hash(body.temporaryPassword) }).returning();
      }
      await tx
        .insert(memberships)
        .values({ userId: user.id, complexId: t.complexId, role: body.role })
        .onConflictDoUpdate({ target: [memberships.userId, memberships.complexId], set: { role: body.role, updatedAt: new Date() } });
      await this.audit.log({ complexId: t.complexId, userId: u.id, action: 'ADD_MEMBER', entity: 'user', entityId: user.id, data: { role: body.role } }, tx);
      return { userId: user.id, email, fullName: user.fullName, role: body.role };
    });
  }
}
