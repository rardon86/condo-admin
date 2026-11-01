import { Global, Inject, Injectable, Module } from '@nestjs/common';
import { DB, Db, Tx } from '../db/client';
import { auditLogs } from '../db/schema';

@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async log(
    e: { complexId?: string; userId?: string; action: string; entity: string; entityId?: string; data?: unknown },
    tx: Tx = this.db,
  ) {
    await tx.insert(auditLogs).values({ ...e, data: e.data ?? null });
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
