import { Global, Module } from '@nestjs/common';
import { AccountsController } from './accounts.controller';
import { LedgerService } from './ledger.service';

@Global()
@Module({
  controllers: [AccountsController],
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
