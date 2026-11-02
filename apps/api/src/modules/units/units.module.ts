import { BadRequestException, Body, ConflictException, Controller, Get, Inject, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { Roles, ROLES, Tenant, TenantCtx } from '../../common/auth.decorators';
import { zMoney, ZodPipe, zUuid } from '../../common/zod.pipe';
import { DB, Db, Tx } from '../../db/client';
import { memberships, units, users } from '../../db/schema';
import { CatalogsService } from '../catalogs/catalogs.module';

const unitSchema = z.object({
  code: z.string().min(1).max(30),
  /** Código del catálogo de tipos de propiedad. */
  type: z.string().trim().min(1).max(30).default('HOUSE'),
  address: z.string().trim().max(500).nullable().optional(),
  /** Propietario registrado en el proyecto; null = sin propietario. */
  ownerUserId: zUuid.nullable().optional(),
  areaM2: z.coerce.number().positive().nullable().optional(),
  monthlyFee: zMoney.default(0),
  active: z.boolean().default(true),
});

const toRow = ({ ownerUserId: _o, ...b }: Partial<z.infer<typeof unitSchema>>) => ({
  ...b,
  areaM2: b.areaM2 === undefined ? undefined : b.areaM2 === null ? null : String(b.areaM2),
  monthlyFee: b.monthlyFee === undefined ? undefined : b.monthlyFee.toFixed(2),
});

/**
 * Asigna (o quita, con null) el propietario de una propiedad. Debe ser un propietario del proyecto.
 * Copia nombre, correo y teléfono para reportes y, si el propietario aún no tenía propiedad en su
 * acceso al portal, le asigna esta.
 */
export async function setPropertyOwner(tx: Tx, complexId: string, unitId: string, userId: string | null) {
  if (!userId) {
    await tx.update(units).set({ ownerUserId: null, ownerName: null, ownerEmail: null, ownerPhone: null, updatedAt: new Date() }).where(eq(units.id, unitId));
    return;
  }
  const [m] = await tx
    .select({ fullName: users.fullName, email: users.email, phone: users.phone, unitId: memberships.unitId })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.userId, userId), eq(memberships.complexId, complexId), eq(memberships.role, 'RESIDENT'), inArray(memberships.status, ['ACTIVE', 'PENDING'])));
  if (!m) throw new BadRequestException('El propietario no está registrado en este proyecto');
  await tx.update(units).set({ ownerUserId: userId, ownerName: m.fullName, ownerEmail: m.email, ownerPhone: m.phone, updatedAt: new Date() }).where(eq(units.id, unitId));
  if (!m.unitId) {
    await tx.update(memberships).set({ unitId, updatedAt: new Date() }).where(and(eq(memberships.userId, userId), eq(memberships.complexId, complexId), isNull(memberships.unitId)));
  }
}

/** Propiedades (casas, apartamentos, lotes) y su cuota mensual — base de las cuotas. (Tabla `units`.) */
@Controller('units')
export class UnitsController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly catalogs: CatalogsService,
  ) {}

  @Get()
  list(@Tenant() t: TenantCtx) {
    return this.db.select().from(units).where(eq(units.complexId, t.complexId)).orderBy(asc(units.code));
  }

  @Post()
  @Roles(...ROLES.MANAGE)
  async create(@Tenant() t: TenantCtx, @Body(new ZodPipe(unitSchema)) body: z.infer<typeof unitSchema>) {
    await this.catalogs.assert(t.complexId, 'PROPERTY_TYPE', body.type);
    const [dup] = await this.db.select({ id: units.id }).from(units).where(and(eq(units.complexId, t.complexId), eq(units.code, body.code)));
    if (dup) throw new ConflictException('Ya existe una propiedad con ese código');
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(units).values({ ...toRow(body), code: body.code, complexId: t.complexId }).returning();
      if (body.ownerUserId) await setPropertyOwner(tx, t.complexId, row.id, body.ownerUserId);
      return row;
    });
  }

  @Patch(':id')
  @Roles(...ROLES.MANAGE)
  async update(@Tenant() t: TenantCtx, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(unitSchema.partial())) body: Partial<z.infer<typeof unitSchema>>) {
    if (body.type) await this.catalogs.assert(t.complexId, 'PROPERTY_TYPE', body.type);
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(units)
        .set({ ...toRow(body), updatedAt: new Date() })
        .where(and(eq(units.id, id), eq(units.complexId, t.complexId)))
        .returning();
      if (!row) throw new NotFoundException();
      // undefined = no cambia; null = sin propietario
      if (body.ownerUserId !== undefined) await setPropertyOwner(tx, t.complexId, id, body.ownerUserId);
      return row;
    });
  }
}

@Module({ controllers: [UnitsController] })
export class UnitsModule {}
