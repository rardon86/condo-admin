import { Controller, Get, Module, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { z } from 'zod';
import { Roles, ROLES, Tenant, TenantCtx } from '../../common/auth.decorators';
import { zDate, ZodPipe } from '../../common/zod.pipe';
import { AccountStatementService, statementQ } from './account-statement.service';
import { ReportsService } from './reports.service';

const monthQ = z.object({ year: z.coerce.number().int().min(2000).max(2100), month: z.coerce.number().int().min(1).max(12) });
const rangeQ = z.object({ from: zDate, to: zDate });
const asOfQ = z.object({ asOf: zDate });
const yearQ = z.object({ year: z.coerce.number().int().min(2000).max(2100) });
const horizonQ = z.object({ horizon: z.coerce.number().int().min(1).max(24).default(6) });

@Controller('reports')
@Roles(...ROLES.FIN_READ)
export class ReportsController {
  constructor(
    private readonly svc: ReportsService,
    private readonly statements: AccountStatementService,
  ) {}

  @Get('dashboard')
  dashboard(@Tenant() t: TenantCtx) {
    return this.svc.dashboard(t.complexId);
  }

  /** Informe mensual de gastos. */
  @Get('monthly-expenses')
  monthlyExpenses(@Tenant() t: TenantCtx, @Query(new ZodPipe(monthQ)) q: z.infer<typeof monthQ>) {
    return this.svc.monthlyExpenses(t.complexId, q.year, q.month);
  }

  @Get('income-statement')
  incomeStatement(@Tenant() t: TenantCtx, @Query(new ZodPipe(rangeQ)) q: z.infer<typeof rangeQ>) {
    return this.svc.incomeStatement(t.complexId, q.from, q.to);
  }

  @Get('balance-sheet')
  balanceSheet(@Tenant() t: TenantCtx, @Query(new ZodPipe(asOfQ)) q: z.infer<typeof asOfQ>) {
    return this.svc.balanceSheet(t.complexId, q.asOf);
  }

  @Get('cash-flow')
  cashFlow(@Tenant() t: TenantCtx, @Query(new ZodPipe(rangeQ)) q: z.infer<typeof rangeQ>) {
    return this.svc.cashFlow(t.complexId, q.from, q.to);
  }

  /** Estado de cuenta: resumen de todas las propiedades (saldo y mora). */
  @Get('unit-statements')
  unitStatements(@Tenant() t: TenantCtx, @Query(new ZodPipe(statementQ)) q: z.infer<typeof statementQ>) {
    return this.statements.summary(t.complexId, q);
  }

  /** Estado de cuenta detallado de una propiedad/propietario. */
  @Get('unit-statements/:unitId')
  unitStatement(@Tenant() t: TenantCtx, @Param('unitId', ParseUUIDPipe) unitId: string, @Query(new ZodPipe(statementQ)) q: z.infer<typeof statementQ>) {
    return this.statements.unit(t.complexId, unitId, q);
  }
}

@Controller('analytics')
@Roles(...ROLES.FIN_READ)
export class AnalyticsController {
  constructor(private readonly svc: ReportsService) {}

  @Get('projections')
  projections(@Tenant() t: TenantCtx, @Query(new ZodPipe(horizonQ)) q: z.infer<typeof horizonQ>) {
    return this.svc.projections(t.complexId, q.horizon);
  }

  @Get('annual')
  annual(@Tenant() t: TenantCtx, @Query(new ZodPipe(yearQ)) q: z.infer<typeof yearQ>) {
    return this.svc.annual(t.complexId, q.year);
  }
}

@Module({ controllers: [ReportsController, AnalyticsController], providers: [ReportsService, AccountStatementService], exports: [AccountStatementService] })
export class ReportsModule {}
