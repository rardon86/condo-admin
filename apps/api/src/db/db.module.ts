import { Global, Module } from '@nestjs/common';
import { createDb, DB } from './client';

@Global()
@Module({
  providers: [{ provide: DB, useFactory: () => createDb() }],
  exports: [DB],
})
export class DbModule {}
