import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logoColumns, parseLogo, zLogo } from '../src/common/image';
import { looksLikePhone, phoneUsername } from '../src/common/phone';

// PNG mínimo válido de 1×1
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('logo: acepta PNG real', () => {
  const r = parseLogo(`data:image/png;base64,${PNG}`);
  assert.equal(r.mime, 'image/png');
});

test('logo: rechaza SVG y tipos no permitidos', () => {
  assert.equal(zLogo.safeParse('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=').success, false);
  assert.equal(zLogo.safeParse('data:text/html;base64,PGgxPg==').success, false);
  assert.equal(zLogo.safeParse('javascript:alert(1)').success, false);
});

test('logo: rechaza contenido que no coincide con el tipo declarado', () => {
  const html = Buffer.from('<script>alert(1)</script>').toString('base64');
  assert.throws(() => parseLogo(`data:image/png;base64,${html}`));
  assert.throws(() => parseLogo(`data:image/jpeg;base64,${PNG}`)); // PNG declarado como JPEG
});

test('logo: null quita y undefined no cambia', () => {
  assert.deepEqual(logoColumns(undefined), {});
  assert.deepEqual(logoColumns(null), { logo: null, logoMime: null, logoUpdatedAt: null });
});

test('propietarios: el teléfono es el usuario (solo dígitos) y el login lo reconoce con guiones o espacios', () => {

  assert.equal(phoneUsername('7123-4567'), '71234567');
  assert.equal(phoneUsername('+503 7123 4567'), '50371234567');
  assert.throws(() => phoneUsername('123'));
  assert.equal(looksLikePhone('7123-4567'), true);
  assert.equal(looksLikePhone('(503) 7123 4567'), true);
  assert.equal(looksLikePhone('demo@residencial.app'), false);
  assert.equal(looksLikePhone('ricardo'), false);
  assert.equal(looksLikePhone('12-34'), false);
});
