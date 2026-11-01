import { Controller, Get, Inject, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { sql } from 'drizzle-orm';
import { AuditModule } from './common/audit.service';
import { Public } from './common/auth.decorators';
import { AuthGuard } from './common/auth.guard';
import { DB, Db } from './db/client';
import { DbModule } from './db/db.module';
import { AuthModule } from './modules/auth/auth.module';
import { CommunityModule } from './modules/community/community.module';
import { PlatformModule } from './modules/platform/platform.module';
import { ComplexesModule } from './modules/complexes/complexes.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { MovementsModule } from './modules/movements/movements.module';
import { ReportsModule } from './modules/reports/reports.module';
import { ServicesModule } from './modules/services/services.module';
import { StaffModule } from './modules/staff/staff.module';
import { UnitsModule } from './modules/units/units.module';

@Controller('health')
class HealthController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Public()
  @Get()
  async check() {
    await this.db.execute(sql`select 1`);
    return { status: 'ok', time: new Date().toISOString() };
  }
}

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    DbModule,
    AuditModule,
    LedgerModule,
    AuthModule,
    ComplexesModule,
    UnitsModule,
    MovementsModule,
    ServicesModule,
    StaffModule,
    ReportsModule,
    CommunityModule,
    PlatformModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
