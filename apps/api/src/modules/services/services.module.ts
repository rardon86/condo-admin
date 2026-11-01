import { BadRequestException, Body, Controller, Get, Inject, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { and, asc, desc, eq, gte, isNull, lte, SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AuthUser, CurrentUser, Roles, ROLES, Tenant, TenantCtx } from '../../common/auth.decorators';
import { AuditService } from '../../common/audit.service';
import { centsToDb, fromCents, toCents } from '../../common/money';
import { zDate, zMoney, ZodPipe, zRange, zUuid } from '../../common/zod.pipe';
import { DB, Db } from '../../db/client';
import { serviceRecords, services, units } from '../../db/schema';
import { SYSTEM_ACCOUNTS } from '../ledger/chart-of-accounts';
import { LedgerService } from '../ledger/ledger.service';
import { MovementsModule } from '../movements/movements.module';
import { MovementsService } from '../movements/movements.service';

const serviceSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(1000).nullable().optional(),
  category: z.string().max(60).nullable().optional(),
  unitLabel: z.string().max(30).default('servicio'),
  unitCost: zMoney.default(0),
  unitPrice: zMoney.default(0),
  active: z.boolean().default(true),
});

const recordSchema = z.object({
  serviceId: zUuid,
  date: zDate,
  quantity: z.coerce.number().positive().max(100_000).default(1),
  unitId: zUuid.nullable().optional(),
  employeeId: zUuid.nullable().optional(),
  providedBy: z.string().max(150).nullable().optional(),
  /** Si se omiten se usan los del catálogo; se congelan en el registro. */
  unitCost: zMoney.optional(),
  unitPrice: zMoney.optional(),
  notes: z.string().max(1000).nullable().optional(),
  /** Genera el ingreso por el servicio cobrado (cuenta 4300). */
  registerIncome: z.boolean().default(false),
  /** Genera el egreso por el costo del servicio (cuenta 5700). */
  registerCost: z.boolean().default(false),
  method: z.enum(['CASH', 'TRANSFER', 'CARD', 'CHECK', 'OTHER']).default('CASH'),
});

const money = (v: number | undefined) => (v === undefined ? undefined : v.toFixed(2));

@Injectable()
export class ServicesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly ledger: LedgerService,
    private readonly movements: MovementsService,
    private readonly audit: AuditService,
  ) {}

  async record(complexId: string, userId: string, b: z.infer<typeof recordSchema>) {
    return this.db.transaction(async (tx) => {
      const [svc] = await tx.select().from(services).where(and(eq(services.id, b.serviceId), eq(services.complexId, complexId)));
      if (!svc) throw new BadRequestException('Servicio inválido');
      const unitCost = b.unitCost !== undefined ? toCents(b.unitCost) : toCents(svc.unitCost);
      const unitPrice = b.unitPrice !== undefined ? toCents(b.unitPrice) : toCents(svc.unitPrice);
      const totalCost = Math.round(unitCost * b.quantity);
      const totalPrice = Math.round(unitPrice * b.quantity);

      const [rec] = await tx
        .insert(serviceRecords)
        .values({
          complexId,
          serviceId: svc.id,
          date: b.date,
          unitId: b.unitId,
          employeeId: b.employeeId,
          providedBy: b.providedBy,
          quantity: String(b.quantity),
          unitCost: centsToDb(unitCost),
          unitPrice: centsToDb(unitPrice),
          totalCost: centsToDb(totalCost),
          totalPrice: centsToDb(totalPrice),
          notes: b.notes,
          createdBy: userId,
        })
        .returning();

      const patch: { incomeMovementId?: string; costMovementId?: string } = {};
      if (b.registerIncome && totalPrice > 0) {
        const acc = await this.ledger.accountByCode(complexId, SYSTEM_ACCOUNTS.SERVICES_INCOME, tx);
        const m = await this.movements.createInTx(tx, complexId, userId, 'INCOME', {
          date: b.date, accountId: acc.id, amount: fromCents(totalPrice), unitId: b.unitId, method: b.method,
          description: `Servicio: ${svc.name} x${b.quantity}`, serviceRecordId: rec.id,
        });
        patch.incomeMovementId = m.id;
      }
      if (b.registerCost && totalCost > 0) {
        const acc = await this.ledger.accountByCode(complexId, SYSTEM_ACCOUNTS.SERVICES_COST, tx);
        const m = await this.movements.createInTx(tx, complexId, userId, 'EXPENSE', {
          date: b.date, accountId: acc.id, amount: fromCents(totalCost), method: b.method,
          counterparty: b.providedBy, description: `Costo servicio: ${svc.name} x${b.quantity}`, serviceRecordId: rec.id,
        });
        patch.costMovementId = m.id;
      }
      if (Object.keys(patch).length) await tx.update(serviceRecords).set(patch).where(eq(serviceRecords.id, rec.id));
      await this.audit.log({ complexId, userId, action: 'CREATE', entity: 'service_record', entityId: rec.id, data: b }, tx);
      return { ...rec, ...patch };
    });
  }

  async voidRecord(complexId: string, userId: string, id: string, reason: string) {
    return this.db.transaction(async (tx) => {
      const [rec] = await tx.select().from(serviceRecords).where(and(eq(serviceRecords.id, id), eq(serviceRecords.complexId, complexId)));
      if (!rec) throw new NotFoundException();
      if (rec.voidedAt) throw new BadRequestException('Ya está anulado');
      if (rec.incomeMovementId) await this.movements.void(complexId, userId, 'INCOME', rec.incomeMovementId, reason, tx);
      if (rec.costMovementId) await this.movements.void(complexId, userId, 'EXPENSE', rec.costMovementId, reason, tx);
      const [row] = await tx.update(serviceRecords).set({ voidedAt: new Date(), updatedAt: new Date() }).where(eq(serviceRecords.id, id)).returning();
      return row;
    });
  }

  /** Rentabilidad por servicio en un periodo. */
  async summary(complexId: string, from?: string, to?: string) {
    const conds: SQL[] = [eq(serviceRecords.complexId, complexId), isNull(serviceRecords.voidedAt)];
    if (from) conds.push(gte(serviceRecords.date, from));
    if (to) conds.push(lte(serviceRecords.date, to));
    const rows = await this.db
      .select({
        serviceId: services.id,
        name: services.name,
        category: services.category,
        count: sql<number>`count(*)::int`,
        quantity: sql<string>`sum(${serviceRecords.quantity})`,
        revenue: sql<string>`sum(${serviceRecords.totalPrice})`,
        cost: sql<string>`sum(${serviceRecords.totalCost})`,
      })
      .from(serviceRecords)
      .innerJoin(services, eq(services.id, serviceRecords.serviceId))
      .where(and(...conds))
      .groupBy(services.id)
      .orderBy(desc(sql`sum(${serviceRecords.totalPrice})`));
    const items = rows.map((r) => {
      const revenue = toCents(r.revenue);
      const cost = toCents(r.cost);
      return {
        ...r,
        quantity: Number(r.quantity),
        revenue: fromCents(revenue),
        cost: fromCents(cost),
        margin: fromCents(revenue - cost),
        marginPct: revenue ? Math.round(((revenue - cost) / revenue) * 1000) / 10 : null,
      };
    });
    const totals = items.reduce((a, i) => ({ revenue: a.revenue + i.revenue, cost: a.cost + i.cost }), { revenue: 0, cost: 0 });
    return { items, totals: { ...totals, margin: Math.round((totals.revenue - totals.cost) * 100) / 100 } };
  }
}

@Controller('services')
export class ServicesController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  list(@Tenant() t: TenantCtx) {
    return this.db.select().from(services).where(eq(services.complexId, t.complexId)).orderBy(asc(services.name));
  }

  @Post()
  @Roles(...ROLES.FIN_WRITE)
  async create(@Tenant() t: TenantCtx, @Body(new ZodPipe(serviceSchema)) b: z.infer<typeof serviceSchema>) {
    const [row] = await this.db
      .insert(services)
      .values({ ...b, complexId: t.complexId, unitCost: b.unitCost.toFixed(2), unitPrice: b.unitPrice.toFixed(2) })
      .returning();
    return row;
  }

  @Patch(':id')
  @Roles(...ROLES.FIN_WRITE)
  async update(@Tenant() t: TenantCtx, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(serviceSchema.partial())) b: Partial<z.infer<typeof serviceSchema>>) {
    const [row] = await this.db
      .update(services)
      .set({ ...b, unitCost: money(b.unitCost), unitPrice: money(b.unitPrice), updatedAt: new Date() })
      .where(and(eq(services.id, id), eq(services.complexId, t.complexId)))
      .returning();
    if (!row) throw new NotFoundException();
    return row;
  }
}

@Controller('service-records')
@Roles(...ROLES.FIN_READ)
export class ServiceRecordsController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly svc: ServicesService,
  ) {}

  @Get()
  list(@Tenant() t: TenantCtx, @Query(new ZodPipe(zRange)) q: z.infer<typeof zRange>) {
    const conds: SQL[] = [eq(serviceRecords.complexId, t.complexId)];
    if (q.from) conds.push(gte(serviceRecords.date, q.from));
    if (q.to) conds.push(lte(serviceRecords.date, q.to));
    return this.db
      .select({
        id: serviceRecords.id,
        date: serviceRecords.date,
        serviceName: services.name,
        unitCode: units.code,
        providedBy: serviceRecords.providedBy,
        quantity: serviceRecords.quantity,
        totalCost: serviceRecords.totalCost,
        totalPrice: serviceRecords.totalPrice,
        incomeMovementId: serviceRecords.incomeMovementId,
        costMovementId: serviceRecords.costMovementId,
        voidedAt: serviceRecords.voidedAt,
        notes: serviceRecords.notes,
      })
      .from(serviceRecords)
      .innerJoin(services, eq(services.id, serviceRecords.serviceId))
      .leftJoin(units, eq(units.id, serviceRecords.unitId))
      .where(and(...conds))
      .orderBy(desc(serviceRecords.date), desc(serviceRecords.createdAt))
      .limit(500);
  }

  @Get('summary')
  summary(@Tenant() t: TenantCtx, @Query(new ZodPipe(zRange)) q: z.infer<typeof zRange>) {
    return this.svc.summary(t.complexId, q.from, q.to);
  }

  @Post()
  @Roles(...ROLES.FIN_WRITE)
  create(@Tenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Body(new ZodPipe(recordSchema)) b: z.infer<typeof recordSchema>) {
    return this.svc.record(t.complexId, u.id, b);
  }

  @Post(':id/void')
  @Roles(...ROLES.FIN_WRITE)
  void(@Tenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(z.object({ reason: z.string().min(3) }))) b: { reason: string }) {
    return this.svc.voidRecord(t.complexId, u.id, id, b.reason);
  }
}

@Module({
  imports: [MovementsModule],
  controllers: [ServicesController, ServiceRecordsController],
  providers: [ServicesService],
})
export class ServicesModule {}
