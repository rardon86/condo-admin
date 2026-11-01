import { Body, ConflictException, Controller, Get, Inject, Post, Query } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { Roles, ROLES, Tenant, TenantCtx } from '../../common/auth.decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { DB, Db } from '../../db/client';
import { accounts } from '../../db/schema';
import { isGroupAccount } from './chart-of-accounts';

const createSchema = z.object({
  code: z.string().regex(/^[45]\d{3}$/, 'Solo categorías de ingreso (4xxx) o gasto (5xxx)'),
  name: z.string().min(2).max(120),
});

/** Catálogo de cuentas / categorías de ingreso y gasto. */
@Controller('accounts')
export class AccountsController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  async list(@Tenant() t: TenantCtx, @Query('type') type?: string) {
    const rows = await this.db.select().from(accounts).where(eq(accounts.complexId, t.complexId)).orderBy(asc(accounts.code));
    return rows
      .filter((a) => !type || a.type === type)
      .map((a) => ({ ...a, postable: !isGroupAccount(a.code) }));
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
}
