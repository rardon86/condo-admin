import { ConflictException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { Tx } from '../db/client';
import { movements } from '../db/schema';

/** El N.º de recibo físico no se repite entre ingresos vigentes del proyecto (también lo garantiza un índice único). */
export async function assertReceiptFree(tx: Tx, complexId: string, receiptNumber: string | null | undefined) {
  if (!receiptNumber) return;
  const [x] = await tx
    .select({ id: movements.id })
    .from(movements)
    .where(and(eq(movements.complexId, complexId), eq(movements.kind, 'INCOME'), eq(movements.receiptNumber, receiptNumber), isNull(movements.voidedAt)));
  if (x) throw new ConflictException(`Ya existe un ingreso con el recibo N.º ${receiptNumber}`);
}
