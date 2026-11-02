import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Inject, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { and, asc, desc, eq, isNotNull, isNull, lte, SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service';
import { AuthUser, CurrentUser, isManager, Roles, ROLES, Tenant, TenantCtx } from '../../common/auth.decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { DB, Db } from '../../db/client';
import { accounts, announcements, complexes, movements, ticketMessages, tickets, units, users } from '../../db/schema';
import { AccountStatementService, statementQ } from '../reports/account-statement.service';
import { ReportsModule } from '../reports/reports.module';
import { CatalogsService } from '../catalogs/catalogs.module';
import { SYSTEM_ACCOUNTS } from '../ledger/chart-of-accounts';


const announcementSchema = z.object({
  title: z.string().min(3).max(160),
  body: z.string().min(3).max(10_000),
  /** Código del catálogo de categorías de avisos. */
  category: z.string().trim().min(1).max(30).default('AVISO'),
  pinned: z.boolean().default(false),
  /** true = publicar ya; false = borrador. */
  publish: z.boolean().default(true),
});

const ticketSchema = z.object({
  type: z.enum(['CONSULTA', 'RECLAMO', 'SUGERENCIA']).default('CONSULTA'),
  subject: z.string().min(3).max(160),
  description: z.string().min(5).max(5000),
});
const messageSchema = z.object({ body: z.string().min(1).max(5000) });
const ticketStatusSchema = z.object({ status: z.enum(['ABIERTO', 'EN_PROCESO', 'RESUELTO', 'CERRADO']) });
const ticketListSchema = z.object({ status: z.enum(['ABIERTO', 'EN_PROCESO', 'RESUELTO', 'CERRADO']).optional() });

/** Lectura: personal interno y residentes. */
const READERS = [...ROLES.INTERNAL, 'RESIDENT' as const];
/** Consultas/reclamos: administración, junta (consulta) y residentes. */
const TICKET_ROLES = [...ROLES.MANAGE, 'VIEWER' as const, 'RESIDENT' as const];

/** Avisos y noticias del complejo. */
@Controller('announcements')
export class AnnouncementsController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly catalogs: CatalogsService,
  ) {}

  @Get()
  @Roles(...READERS)
  list(@Tenant() t: TenantCtx) {
    const conds: (SQL | undefined)[] = [eq(announcements.complexId, t.complexId), isNull(announcements.archivedAt)];
    // Los residentes solo ven lo publicado; la administración ve también borradores.
    if (t.role === 'RESIDENT') conds.push(isNotNull(announcements.publishedAt), lte(announcements.publishedAt, sql`now()`));
    return this.db
      .select({
        id: announcements.id, title: announcements.title, body: announcements.body, category: announcements.category,
        pinned: announcements.pinned, publishedAt: announcements.publishedAt, createdAt: announcements.createdAt, author: users.fullName,
      })
      .from(announcements)
      .leftJoin(users, eq(users.id, announcements.createdBy))
      .where(and(...conds))
      .orderBy(desc(announcements.pinned), sql`${announcements.publishedAt} desc nulls first`)
      .limit(100);
  }

  @Post()
  @Roles(...ROLES.MANAGE)
  async create(@Tenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Body(new ZodPipe(announcementSchema)) b: z.infer<typeof announcementSchema>) {
    await this.catalogs.assert(t.complexId, 'NEWS_CATEGORY', b.category);
    const [row] = await this.db
      .insert(announcements)
      .values({ complexId: t.complexId, title: b.title, body: b.body, category: b.category, pinned: b.pinned, publishedAt: b.publish ? new Date() : null, createdBy: u.id })
      .returning();
    await this.audit.log({ complexId: t.complexId, userId: u.id, action: 'CREATE', entity: 'announcement', entityId: row.id });
    return row;
  }

  @Patch(':id')
  @Roles(...ROLES.MANAGE)
  async update(@Tenant() t: TenantCtx, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(announcementSchema.partial())) b: Partial<z.infer<typeof announcementSchema>>) {
    if (b.category) await this.catalogs.assert(t.complexId, 'NEWS_CATEGORY', b.category);
    const where = and(eq(announcements.id, id), eq(announcements.complexId, t.complexId));
    const [cur] = await this.db.select().from(announcements).where(where);
    if (!cur) throw new NotFoundException();
    const publishedAt = b.publish === undefined ? undefined : b.publish ? (cur.publishedAt ?? new Date()) : null;
    const [row] = await this.db
      .update(announcements)
      .set({ title: b.title, body: b.body, category: b.category, pinned: b.pinned, publishedAt, updatedAt: new Date() })
      .where(where)
      .returning();
    return row;
  }

  /** Se archiva (no se borra). */
  @Delete(':id')
  @Roles(...ROLES.MANAGE)
  async archive(@Tenant() t: TenantCtx, @Param('id', ParseUUIDPipe) id: string) {
    await this.db.update(announcements).set({ archivedAt: new Date() }).where(and(eq(announcements.id, id), eq(announcements.complexId, t.complexId)));
    return { ok: true };
  }
}

/** Consultas, reclamos y sugerencias. El residente ve solo los suyos; la administración, todos. */
@Controller('tickets')
@Roles(...TICKET_ROLES)
export class TicketsController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@Tenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Query(new ZodPipe(ticketListSchema)) q: z.infer<typeof ticketListSchema>) {
    const conds: (SQL | undefined)[] = [eq(tickets.complexId, t.complexId)];
    if (t.role === 'RESIDENT') conds.push(eq(tickets.createdBy, u.id));
    if (q.status) conds.push(eq(tickets.status, q.status));
    return this.db
      .select({
        id: tickets.id, type: tickets.type, subject: tickets.subject, status: tickets.status, createdAt: tickets.createdAt,
        updatedAt: tickets.updatedAt, author: users.fullName, unitCode: units.code,
        messages: sql<number>`(select count(*)::int from ${ticketMessages} where ${ticketMessages.ticketId} = ${tickets.id})`,
      })
      .from(tickets)
      .innerJoin(users, eq(users.id, tickets.createdBy))
      .leftJoin(units, eq(units.id, tickets.unitId))
      .where(and(...conds))
      .orderBy(sql`case ${tickets.status} when 'ABIERTO' then 0 when 'EN_PROCESO' then 1 else 2 end`, desc(tickets.updatedAt))
      .limit(300);
  }

  @Get(':id')
  async get(@Tenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const ticket = await this.find(t, u, id);
    const messages = await this.db
      .select({ id: ticketMessages.id, body: ticketMessages.body, createdAt: ticketMessages.createdAt, authorId: ticketMessages.authorId, author: users.fullName })
      .from(ticketMessages)
      .innerJoin(users, eq(users.id, ticketMessages.authorId))
      .where(eq(ticketMessages.ticketId, id))
      .orderBy(asc(ticketMessages.createdAt));
    const [creator] = await this.db.select({ fullName: users.fullName, email: users.email, phone: users.phone }).from(users).where(eq(users.id, ticket.createdBy));
    const [unit] = ticket.unitId ? await this.db.select({ code: units.code }).from(units).where(eq(units.id, ticket.unitId)) : [];
    return { ...ticket, creator, unitCode: unit?.code ?? null, messages };
  }

  @Post()
  async create(@Tenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Body(new ZodPipe(ticketSchema)) b: z.infer<typeof ticketSchema>) {
    if (t.role === 'VIEWER') throw new ForbiddenException();
    const [row] = await this.db.insert(tickets).values({ ...b, complexId: t.complexId, createdBy: u.id, unitId: t.unitId }).returning();
    await this.audit.log({ complexId: t.complexId, userId: u.id, action: 'CREATE', entity: 'ticket', entityId: row.id });
    return row;
  }

  @Post(':id/messages')
  async reply(@Tenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(messageSchema)) b: z.infer<typeof messageSchema>) {
    if (t.role === 'VIEWER') throw new ForbiddenException();
    const ticket = await this.find(t, u, id);
    if (ticket.status === 'CERRADO') throw new BadRequestException('La consulta está cerrada');
    const [msg] = await this.db.insert(ticketMessages).values({ ticketId: id, authorId: u.id, body: b.body }).returning();
    // Si responde la administración y estaba abierto, pasa a "en proceso"; si responde el residente a algo resuelto, se reabre.
    const status = isManager(t.role) ? (ticket.status === 'ABIERTO' ? 'EN_PROCESO' : ticket.status) : ticket.status === 'RESUELTO' ? 'ABIERTO' : ticket.status;
    await this.db.update(tickets).set({ status, updatedAt: new Date() }).where(eq(tickets.id, id));
    return msg;
  }

  @Patch(':id')
  @Roles(...ROLES.MANAGE)
  async setStatus(@Tenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ticketStatusSchema)) b: z.infer<typeof ticketStatusSchema>) {
    await this.find(t, u, id);
    const [row] = await this.db
      .update(tickets)
      .set({ status: b.status, closedAt: b.status === 'CERRADO' || b.status === 'RESUELTO' ? new Date() : null, updatedAt: new Date() })
      .where(eq(tickets.id, id))
      .returning();
    await this.audit.log({ complexId: t.complexId, userId: u.id, action: 'STATUS', entity: 'ticket', entityId: id, data: b });
    return row;
  }

  private async find(t: TenantCtx, u: AuthUser, id: string) {
    const [ticket] = await this.db.select().from(tickets).where(and(eq(tickets.id, id), eq(tickets.complexId, t.complexId)));
    if (!ticket || (t.role === 'RESIDENT' && ticket.createdBy !== u.id)) throw new NotFoundException();
    return ticket;
  }
}

/** Portal del propietario: solo lectura de su información y de las noticias del complejo. */
@Controller('portal')
@Roles('RESIDENT')
export class PortalController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly statements: AccountStatementService,
  ) {}

  /** Estado de cuenta de SU propiedad (nunca de otra: la propiedad sale de la membresía). */
  @Get('statement')
  statement(@Tenant() t: TenantCtx, @Query(new ZodPipe(statementQ)) q: z.infer<typeof statementQ>) {
    if (!t.unitId) throw new NotFoundException('Su cuenta no tiene una propiedad asignada');
    return this.statements.unit(t.complexId, t.unitId, q);
  }

  @Get()
  async home(@Tenant() t: TenantCtx, @CurrentUser() u: AuthUser) {
    const [complex] = await this.db.select({ name: complexes.name, address: complexes.address }).from(complexes).where(eq(complexes.id, t.complexId));
    const [unit] = t.unitId
      ? await this.db.select({ code: units.code, type: units.type, address: units.address, monthlyFee: units.monthlyFee }).from(units).where(eq(units.id, t.unitId))
      : [];

    // Pagos registrados a nombre de su propiedad (ingresos no anulados)
    const payments = t.unitId
      ? await this.db
          .select({ id: movements.id, date: movements.date, amount: movements.amount, concept: accounts.name, accountCode: accounts.code, description: movements.description, reference: movements.reference, receiptNumber: movements.receiptNumber })
          .from(movements)
          .innerJoin(accounts, eq(accounts.id, movements.accountId))
          .where(and(eq(movements.complexId, t.complexId), eq(movements.kind, 'INCOME'), eq(movements.unitId, t.unitId), isNull(movements.voidedAt)))
          .orderBy(desc(movements.date))
          .limit(24)
      : [];

    const news = await this.db
      .select({ id: announcements.id, title: announcements.title, body: announcements.body, category: announcements.category, pinned: announcements.pinned, publishedAt: announcements.publishedAt })
      .from(announcements)
      .where(and(eq(announcements.complexId, t.complexId), isNull(announcements.archivedAt), isNotNull(announcements.publishedAt), lte(announcements.publishedAt, sql`now()`)))
      .orderBy(desc(announcements.pinned), desc(announcements.publishedAt))
      .limit(20);

    const ticketCounts = await this.db
      .select({ status: tickets.status, n: sql<number>`count(*)::int` })
      .from(tickets)
      .where(and(eq(tickets.complexId, t.complexId), eq(tickets.createdBy, u.id)))
      .groupBy(tickets.status);
    const open = ticketCounts.filter((c) => c.status === 'ABIERTO' || c.status === 'EN_PROCESO').reduce((s, c) => s + c.n, 0);

    return {
      complex,
      unit: unit ?? null,
      news,
      payments: payments.map(({ accountCode, ...p }) => ({ ...p, concept: accountCode === SYSTEM_ACCOUNTS.RECEIVABLE ? 'Pago de cuotas' : p.concept, amount: Number(p.amount) })),
      balance: t.unitId ? await this.statements.balance(t.complexId, t.unitId) : null,
      tickets: { open, total: ticketCounts.reduce((s, c) => s + c.n, 0) },
    };
  }
}

@Module({ imports: [ReportsModule], controllers: [AnnouncementsController, TicketsController, PortalController] })
export class CommunityModule {}

