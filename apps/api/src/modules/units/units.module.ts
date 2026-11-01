import { Body, Controller, Get, Inject, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { Roles, ROLES, Tenant, TenantCtx } from '../../common/auth.decorators';
import { zMoney, ZodPipe } from '../../common/zod.pipe';
import { DB, Db } from '../../db/client';
import { units } from '../../db/schema';

const unitSchema = z.object({
  code: z.string().min(1).max(30),
  type: z.enum(['HOUSE', 'APARTMENT', 'LOT', 'COMMERCIAL', 'OTHER']).default('HOUSE'),
  ownerName: z.string().max(150).nullable().optional(),
  ownerEmail: z.string().email().nullable().optional(),
  ownerPhone: z.string().max(30).nullable().optional(),
  areaM2: z.coerce.number().positive().nullable().optional(),
  monthlyFee: zMoney.default(0),
  active: z.boolean().default(true),
});

const toRow = (b: Partial<z.infer<typeof unitSchema>>) => ({
  ...b,
  areaM2: b.areaM2 === undefined ? undefined : b.areaM2 === null ? null : String(b.areaM2),
  monthlyFee: b.monthlyFee === undefined ? undefined : b.monthlyFee.toFixed(2),
});

/** Unidades (casas, apartamentos, lotes) y su cuota mensual — base para la tasa de cobranza. */
@Controller('units')
export class UnitsController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  list(@Tenant() t: TenantCtx) {
    return this.db.select().from(units).where(eq(units.complexId, t.complexId)).orderBy(asc(units.code));
  }

  @Post()
  @Roles(...ROLES.MANAGE)
  async create(@Tenant() t: TenantCtx, @Body(new ZodPipe(unitSchema)) body: z.infer<typeof unitSchema>) {
    const [row] = await this.db.insert(units).values({ ...toRow(body), code: body.code, complexId: t.complexId }).returning();
    return row;
  }

  @Patch(':id')
  @Roles(...ROLES.MANAGE)
  async update(@Tenant() t: TenantCtx, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(unitSchema.partial())) body: Partial<z.infer<typeof unitSchema>>) {
    const [row] = await this.db
      .update(units)
      .set({ ...toRow(body), updatedAt: new Date() })
      .where(and(eq(units.id, id), eq(units.complexId, t.complexId)))
      .returning();
    if (!row) throw new NotFoundException();
    return row;
  }
}

@Module({ controllers: [UnitsController] })
export class UnitsModule {}
