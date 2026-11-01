import { BadRequestException, PipeTransform } from '@nestjs/common';
import { ZodTypeAny, z } from 'zod';

/** Valida y transforma body/query con un esquema Zod. */
export class ZodPipe<T extends ZodTypeAny> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}
  transform(value: unknown): z.infer<T> {
    const r = this.schema.safeParse(value);
    if (!r.success) {
      throw new BadRequestException({ message: 'Datos inválidos', errors: r.error.flatten().fieldErrors });
    }
    return r.data;
  }
}

// Esquemas reutilizables
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD');
export const zMoney = z.coerce.number().nonnegative().max(999_999_999).multipleOf(0.01);
export const zUuid = z.string().uuid();
export const zRange = z.object({ from: zDate.optional(), to: zDate.optional() });
