import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const MAX_BYTES = 300 * 1024;
export const ALLOWED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;
type ImageMime = (typeof ALLOWED_IMAGE_MIME)[number];

/** Data URL de imagen (nunca SVG: puede contener scripts). null = quitar. */
export const zLogo = z
  .string()
  .max(Math.ceil((MAX_BYTES * 4) / 3) + 64, 'El logo supera 300 KB')
  .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/, 'Formato de imagen no permitido')
  .nullable()
  .optional();

/** Verifica que los bytes correspondan realmente al tipo declarado (firma del archivo). */
function sniff(buf: Buffer): ImageMime | null {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** Convierte el data URL validado en { mime, base64 } listo para guardar. */
export function parseLogo(dataUrl: string): { mime: ImageMime; base64: string } {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(dataUrl);
  if (!m) throw new BadRequestException('Formato de imagen no permitido');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_BYTES) throw new BadRequestException('El logo supera 300 KB');
  const real = sniff(buf);
  if (!real || real !== m[1]) throw new BadRequestException('El archivo no es una imagen válida');
  return { mime: real, base64: buf.toString('base64') };
}

/** Campos a guardar en `complexes` según el valor recibido (undefined = sin cambio). */
export function logoColumns(logo: string | null | undefined) {
  if (logo === undefined) return {};
  if (logo === null) return { logo: null, logoMime: null, logoUpdatedAt: null };
  const { mime, base64 } = parseLogo(logo);
  return { logo: base64, logoMime: mime, logoUpdatedAt: new Date() };
}
