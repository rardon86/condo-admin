import { BadRequestException } from '@nestjs/common';

/** El teléfono es el usuario de ingreso del propietario: se guardan solo los dígitos ("7123-4567" → "71234567"). */
export function phoneUsername(phone: string) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) throw new BadRequestException('Teléfono inválido: use entre 7 y 15 dígitos');
  return digits;
}

/** Un identificador de ingreso con forma de teléfono se compara por sus dígitos. */
export const looksLikePhone = (s: string) => /^[+\d\s().-]+$/.test(s) && s.replace(/\D/g, '').length >= 7;
