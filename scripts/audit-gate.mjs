// Puerta de seguridad de dependencias: falla si hay vulnerabilidades altas o críticas en
// dependencias de producción, salvo excepciones documentadas y vigentes en .audit-allowlist.json.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

let raw;
try {
  raw = execSync('npm audit --omit=dev --json', { encoding: 'utf8' });
} catch (e) {
  raw = e.stdout;
}
const report = JSON.parse(raw);
const today = new Date().toISOString().slice(0, 10);
const allow = JSON.parse(readFileSync('.audit-allowlist.json', 'utf8'));
const active = allow.filter((a) => a.expires >= today);
const expired = allow.filter((a) => a.expires < today);

const blocking = [];
const accepted = [];
for (const [name, v] of Object.entries(report.vulnerabilities ?? {})) {
  if (!['high', 'critical'].includes(v.severity)) continue;
  const advisories = v.via.filter((x) => typeof x === 'object');
  if (!advisories.length) continue; // transitiva: se reporta en el paquete de origen
  for (const adv of advisories) {
    const exc = active.find((a) => adv.url?.includes(a.advisory));
    (exc ? accepted : blocking).push(`${name} [${v.severity}] ${adv.title} — ${adv.url}${exc ? `\n    Excepción hasta ${exc.expires}: ${exc.reason}` : ''}`);
  }
}

if (accepted.length) console.log('Riesgos aceptados (documentados):\n  ' + accepted.join('\n  '));
if (expired.length) console.log('\nExcepciones vencidas (ya no aplican): ' + expired.map((e) => e.advisory).join(', '));
if (blocking.length) {
  console.error('\nVulnerabilidades altas/críticas sin resolver:\n  ' + blocking.join('\n  '));
  process.exit(1);
}
console.log('\n✔ Sin vulnerabilidades altas o críticas pendientes.');
