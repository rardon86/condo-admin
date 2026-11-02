import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser, CurrentUser, Roles, ROLES, Tenant, TenantCtx } from '../../common/auth.decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { FeesModule } from '../fees/fees.module';
import { listSchema, movementSchema, MovementsService } from './movements.service';

const voidSchema = z.object({ reason: z.string().min(3).max(300) });

/** Registro de ingresos. */
@Controller('incomes')
@Roles(...ROLES.FIN_READ)
export class IncomesController {
  constructor(private readonly svc: MovementsService) {}

  @Get()
  list(@Tenant() t: TenantCtx, @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.svc.list(t.complexId, 'INCOME', q);
  }

  @Post()
  @Roles(...ROLES.FIN_WRITE)
  create(@Tenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Body(new ZodPipe(movementSchema)) body: z.infer<typeof movementSchema>) {
    return this.svc.create(t.complexId, u.id, 'INCOME', body);
  }

  @Post(':id/void')
  @Roles(...ROLES.FIN_WRITE)
  void(@Tenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(voidSchema)) b: z.infer<typeof voidSchema>) {
    return this.svc.void(t.complexId, u.id, 'INCOME', id, b.reason);
  }
}

/** Registro de egresos. */
@Controller('expenses')
@Roles(...ROLES.FIN_READ)
export class ExpensesController {
  constructor(private readonly svc: MovementsService) {}

  @Get()
  list(@Tenant() t: TenantCtx, @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.svc.list(t.complexId, 'EXPENSE', q);
  }

  @Post()
  @Roles(...ROLES.FIN_WRITE)
  create(@Tenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Body(new ZodPipe(movementSchema)) body: z.infer<typeof movementSchema>) {
    return this.svc.create(t.complexId, u.id, 'EXPENSE', body);
  }

  @Post(':id/void')
  @Roles(...ROLES.FIN_WRITE)
  void(@Tenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(voidSchema)) b: z.infer<typeof voidSchema>) {
    return this.svc.void(t.complexId, u.id, 'EXPENSE', id, b.reason);
  }
}

@Module({
  imports: [FeesModule],
  controllers: [IncomesController, ExpensesController],
  providers: [MovementsService],
  exports: [MovementsService],
})
export class MovementsModule {}
