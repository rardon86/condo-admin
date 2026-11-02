import { BadRequestException, Body, ConflictException, Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service';
import { AuthUser, CurrentUser, Roles, ROLES, Tenant, TenantCtx } from '../../common/auth.decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { DB, Db } from '../../db/client';
import { accounts } from '../../db/schema';
import { isGroupAccount } from './chart-of-accounts';

const createSchema = z.object({
  code: z.string().regex(/^[45]\d{3}$/, 'Solo categorías de ingreso (4xxx) o gasto (5xxx)'),
  name: z.string().min(2).max(120),
});
const updateSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  active: z.boolean().optional(),
});

/** Catálogo de cuentas / categorías de ingreso y gasto. */
@Controller('accounts')
export class AccountsController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@Tenant() t: TenantCtx, @Query('type') type?: string) {
    const rows = await this.db.select().from(accounts).where(eq(accounts.complexId, t.complexId)).orderBy(asc(accounts.code));
    return rows
      .filter((a) => !type || a.type === type)
      .map((a) => ({ ...a, postable: !isGroupAccount(a.code) && a.active }));
  }

  @Post()
  @Roles(...ROLES.FIN_WRITE)
  async create(@Tenant() t: TenantCtx, @Body(new ZodPipe(createSchema)) body: z.infer<typeof createSchema>) {
    const [exists] = await this.db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.complexId, t.complexId), eq(accounts.code, body.code)));
    if (exists) throw new ConflictException('El código ya existe');
    const type = body.code.startsWith('4') ? 'INCOME' : 'EXPENSE';
    const [row] = await this.db
      .insert(accounts)
      .values({ complexId: t.complexId, code: body.code, name: body.name, type, parentCode: `${body.code[0]}000` })
      .returning();
    return row;
  }

  /** Renombrar o desactivar. Las cuentas del sistema no se desactivan (las usa la contabilidad automática). */
  @Patch(':id')
  @Roles(...ROLES.FIN_WRITE)
  async update(@Tenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateSchema)) body: z.infer<typeof updateSchema>) {
    const [acc] = await this.db.select().from(accounts).where(and(eq(accounts.id, id), eq(accounts.complexId, t.complexId)));
    if (!acc) throw new NotFoundException();
    if (body.active === false && acc.isSystem) throw new BadRequestException('Las cuentas del sistema no se pueden desactivar');
    const [row] = await this.db.update(accounts).set({ ...body, updatedAt: new Date() }).where(eq(accounts.id, id)).returning();
    await this.audit.log({ complexId: t.complexId, userId: u.id, action: 'UPDATE', entity: 'account', entityId: id, data: body });
    return row;
  }
}
