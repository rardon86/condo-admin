import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Inject, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service';
import { AuthUser, CurrentUser, Roles, ROLES, Tenant, TenantCtx } from '../../common/auth.decorators';
import { zMoney, ZodPipe, zUuid } from '../../common/zod.pipe';
import { DB, Db } from '../../db/client';
import { charges, memberships, movements, serviceRecords, tickets, units } from '../../db/schema';
import { CatalogsService } from '../catalogs/catalogs.module';
import { linkOwner, ownersOf, unlinkOwner } from './owners';

const unitSchema = z.object({
  code: z.string().trim().min(1).max(30),
  /** Código del catálogo de tipos de propiedad. */
  type: z.string().trim().min(1).max(30).default('HOUSE'),
  address: z.string().trim().max(500).nullable().optional(),
  areaM2: z.coerce.number().positive().nullable().optional(),
  monthlyFee: zMoney.default(0),
  active: z.boolean().default(true),
});
const ownerSchema = z.object({ userId: zUuid });

const toRow = (b: Partial<z.infer<typeof unitSchema>>) => ({
  ...b,
  areaM2: b.areaM2 === undefined ? undefined : b.areaM2 === null ? null : String(b.areaM2),
  monthlyFee: b.monthlyFee === undefined ? undefined : b.monthlyFee.toFixed(2),
});

/**
 * Propiedades (casas, apartamentos, lotes) y su cuota mensual — base de las cuotas. (Tabla `units`.)
 * Se crean sin dueño; los propietarios se vinculan después (una propiedad puede tener varios).
 */
@Controller('units')
export class UnitsController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly catalogs: CatalogsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@Tenant() t: TenantCtx) {
    const rows = await this.db.select().from(units).where(eq(units.complexId, t.complexId)).orderBy(asc(units.code));
    const owners = await ownersOf(this.db, rows.map((r) => r.id));
    return rows.map((r) => ({ ...r, owners: owners.filter((o) => o.unitId === r.id).map(({ unitId: _u, ...o }) => o) }));
  }

  @Post()
  @Roles(...ROLES.MANAGE)
  async create(@Tenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Body(new ZodPipe(unitSchema)) body: z.infer<typeof unitSchema>) {
    await this.catalogs.assert(t.complexId, 'PROPERTY_TYPE', body.type);
    const [dup] = await this.db.select({ id: units.id }).from(units).where(and(eq(units.complexId, t.complexId), eq(units.code, body.code)));
    if (dup) throw new ConflictException('Ya existe una propiedad con ese código');
    const [row] = await this.db.insert(units).values({ ...toRow(body), code: body.code, complexId: t.complexId }).returning();
    await this.audit.log({ complexId: t.complexId, userId: u.id, action: 'CREATE', entity: 'unit', entityId: row.id, data: body });
    return row;
  }

  @Patch(':id')
  @Roles(...ROLES.MANAGE)
  async update(@Tenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(unitSchema.partial())) body: Partial<z.infer<typeof unitSchema>>) {
    if (body.type) await this.catalogs.assert(t.complexId, 'PROPERTY_TYPE', body.type);
    if (body.code) {
      const [dup] = await this.db.select({ id: units.id }).from(units).where(and(eq(units.complexId, t.complexId), eq(units.code, body.code)));
      if (dup && dup.id !== id) throw new ConflictException('Ya existe una propiedad con ese código');
    }
    const [row] = await this.db
      .update(units)
      .set({ ...toRow(body), updatedAt: new Date() })
      .where(and(eq(units.id, id), eq(units.complexId, t.complexId)))
      .returning();
    if (!row) throw new NotFoundException();
    await this.audit.log({ complexId: t.complexId, userId: u.id, action: 'UPDATE', entity: 'unit', entityId: id, data: body });
    return row;
  }

  /**
   * Elimina una propiedad sin historia contable (cargos, pagos o servicios). Con historia solo se
   * desactiva, para conservar la pista de auditoría.
   */
  @Delete(':id')
  @Roles(...ROLES.MANAGE)
  async remove(@Tenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.transaction(async (tx) => {
      const [unit] = await tx.select().from(units).where(and(eq(units.id, id), eq(units.complexId, t.complexId)));
      if (!unit) throw new NotFoundException();
      const count = async (q: Promise<{ n: number }[]>) => (await q)[0].n;
      const n = sql<number>`count(*)::int`;
      const history =
        (await count(tx.select({ n }).from(charges).where(eq(charges.unitId, id)))) +
        (await count(tx.select({ n }).from(movements).where(eq(movements.unitId, id)))) +
        (await count(tx.select({ n }).from(serviceRecords).where(eq(serviceRecords.unitId, id))));
      if (history > 0) {
        throw new BadRequestException(`La propiedad ${unit.code} tiene cargos, pagos o servicios registrados: no se puede eliminar. Desactívela para conservar su historia.`);
      }
      // Las consultas conservan su texto; los accesos de propietarios dejan de apuntar a ella
      await tx.update(tickets).set({ unitId: null }).where(eq(tickets.unitId, id));
      await tx.update(memberships).set({ unitId: null, updatedAt: new Date() }).where(eq(memberships.unitId, id));
      await tx.delete(units).where(eq(units.id, id)); // los vínculos con propietarios se borran en cascada
      await this.audit.log({ complexId: t.complexId, userId: u.id, action: 'DELETE', entity: 'unit', entityId: id, data: { code: unit.code } }, tx);
      return { ok: true };
    });
  }

  /** Vincular un propietario del proyecto a esta propiedad. */
  @Post(':id/owners')
  @Roles(...ROLES.MANAGE)
  async addOwner(@Tenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ownerSchema)) b: z.infer<typeof ownerSchema>) {
    await this.db.transaction((tx) => linkOwner(tx, t.complexId, id, b.userId));
    await this.audit.log({ complexId: t.complexId, userId: u.id, action: 'LINK_OWNER', entity: 'unit', entityId: id, data: b });
    return { ok: true };
  }

  @Delete(':id/owners/:userId')
  @Roles(...ROLES.MANAGE)
  async removeOwner(@Tenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string) {
    await this.db.transaction((tx) => unlinkOwner(tx, t.complexId, id, userId));
    await this.audit.log({ complexId: t.complexId, userId: u.id, action: 'UNLINK_OWNER', entity: 'unit', entityId: id, data: { userId } });
    return { ok: true };
  }
}

@Module({ controllers: [UnitsController] })
export class UnitsModule {}
