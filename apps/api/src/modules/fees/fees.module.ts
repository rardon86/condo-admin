import { Body, Controller, Get, Injectable, Logger, Module, OnApplicationBootstrap, OnModuleDestroy, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser, CurrentUser, Roles, ROLES, Tenant, TenantCtx } from '../../common/auth.decorators';
import { todayIn } from '../../common/dates';
import { ZodPipe } from '../../common/zod.pipe';
import { chargeListSchema, chargeSchema, FeesService, generateSchema, paymentListSchema, paymentSchema } from './fees.service';

const voidSchema = z.object({ reason: z.string().min(3).max(300) });

/** Cuotas: cargos a propiedades, pagos con recibo y recargos por mora. */
@Controller('fees')
@Roles(...ROLES.FIN_READ)
export class FeesController {
  constructor(private readonly svc: FeesService) {}

  @Get('charges')
  charges(@Tenant() t: TenantCtx, @Query(new ZodPipe(chargeListSchema)) q: z.infer<typeof chargeListSchema>) {
    return this.svc.listCharges(t.complexId, q);
  }

  /** Genera las cuotas mensuales de un mes (no duplica las ya emitidas). */
  @Post('charges/generate')
  @Roles(...ROLES.FIN_WRITE)
  generate(@Tenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Body(new ZodPipe(generateSchema)) b: z.infer<typeof generateSchema>) {
    return this.svc.generateMonthly(t.complexId, b.period, u.id);
  }

  @Post('charges')
  @Roles(...ROLES.FIN_WRITE)
  create(@Tenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Body(new ZodPipe(chargeSchema)) b: z.infer<typeof chargeSchema>) {
    return this.svc.createCharges(t.complexId, u.id, b);
  }

  @Post('charges/:id/void')
  @Roles(...ROLES.FIN_WRITE)
  voidCharge(@Tenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(voidSchema)) b: z.infer<typeof voidSchema>) {
    return this.svc.voidCharge(t.complexId, u.id, id, b.reason);
  }

  /** Calcula ya los recargos por mora pendientes (normalmente lo hace el proceso automático). */
  @Post('late-fees/run')
  @Roles(...ROLES.FIN_WRITE)
  lateFees(@Tenant() t: TenantCtx, @CurrentUser() u: AuthUser) {
    return this.svc.generateLateFees(t.complexId, u.id);
  }

  @Get('pending/:unitId')
  pending(@Tenant() t: TenantCtx, @Param('unitId', ParseUUIDPipe) unitId: string) {
    return this.svc.unitPending(t.complexId, unitId);
  }

  @Get('payments')
  payments(@Tenant() t: TenantCtx, @Query(new ZodPipe(paymentListSchema)) q: z.infer<typeof paymentListSchema>) {
    return this.svc.listPayments(t.complexId, q);
  }

  /** Los pagos se anulan desde Ingresos (POST /incomes/:id/void), que libera su aplicación. */
  @Post('payments')
  @Roles(...ROLES.FIN_WRITE)
  pay(@Tenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Body(new ZodPipe(paymentSchema)) b: z.infer<typeof paymentSchema>) {
    return this.svc.registerPayment(t.complexId, u.id, b);
  }
}

const HOUR = 60 * 60_000;

/**
 * Automatización: cada hora, en los proyectos con "generación automática", emite las cuotas del mes
 * en curso (zona horaria del proyecto) y los recargos por mora. Es idempotente y seguro con varias
 * instancias (índices únicos + candado por proyecto).
 */
@Injectable()
export class FeesScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Cuotas');
  private timers: NodeJS.Timeout[] = [];

  constructor(private readonly svc: FeesService) {}

  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test' || process.env.FEES_SCHEDULER === 'false') return;
    const first = setTimeout(() => void this.run(), 20_000);
    const every = setInterval(() => void this.run(), HOUR);
    first.unref();
    every.unref();
    this.timers.push(first, every);
  }

  onModuleDestroy() {
    this.timers.forEach((t) => clearTimeout(t));
  }

  async run() {
    for (const c of await this.svc.autoComplexes()) {
      try {
        const period = todayIn(c.timezone).slice(0, 7);
        const g = await this.svc.generateMonthly(c.id, period, null);
        const l = await this.svc.generateLateFees(c.id, null);
        if (g.created || l.created) this.logger.log(`Proyecto ${c.id}: ${g.created} cuotas de ${period}, ${l.created} recargos`);
      } catch (e) {
        this.logger.error(`Proyecto ${c.id}: ${(e as Error).message}`);
      }
    }
  }
}

@Module({ controllers: [FeesController], providers: [FeesService, FeesScheduler], exports: [FeesService] })
export class FeesModule {}
