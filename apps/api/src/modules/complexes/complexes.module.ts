import { Module } from '@nestjs/common';
import { ComplexesController } from './complexes.controller';

@Module({ controllers: [ComplexesController] })
export class ComplexesModule {}
