/**
 * Datos de demostración: crea "Residencial Las Palmas" con 14 meses de historia.
 * Uso: npm run build -w apps/api && npm run db:seed
 * Acceso: demo@residencial.app / Demo1234
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import { AppModule } from '../app.module';
import { addMonths, monthRange, pad } from '../common/dates';
import { AuthService } from '../modules/auth/auth.service';
import { LedgerService } from '../modules/ledger/ledger.service';
import { MovementsService } from '../modules/movements/movements.service';
import { DB, Db } from './client';
import { accounts, complexes, employees, geofences, memberships, services, units, users } from './schema';

const EMAIL = 'demo@residencial.app';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const db = app.get<Db>(DB);
  const auth = app.get(AuthService);
  const ledger = app.get(LedgerService);
  const movs = app.get(MovementsService);

  const [existing] = await db.select().from(users).where(eq(users.email, EMAIL));
  if (existing) {
    console.log('Demo ya existe');
    await app.close();
    return;
  }

  await auth.register({ fullName: 'Admin Demo', email: EMAIL, password: 'Demo1234', complexName: 'Residencial Las Palmas', complexType: 'MIXED' });
  const [u] = await db.select().from(users).where(eq(users.email, EMAIL));
  const [m] = await db.select().from(memberships).where(eq(memberships.userId, u.id));
  const cid = m.complexId;

  // 40 unidades con cuota de $75
  await db.insert(units).values(Array.from({ length: 40 }, (_, i) => ({ complexId: cid, code: `C-${pad(i + 1)}`, ownerName: `Propietario ${i + 1}`, monthlyFee: '75.00' })));
  await db.insert(geofences).values({ complexId: cid, name: 'Portería principal', latitude: 13.6929, longitude: -89.2182, radiusMeters: 150 });
  await db.insert(employees).values([
    { complexId: cid, userId: u.id, fullName: 'Admin Demo', position: 'Administrador', hourlyRate: '5.00' },
    { complexId: cid, fullName: 'José Martínez', position: 'Vigilante', hourlyRate: '2.50' },
    { complexId: cid, fullName: 'Ana López', position: 'Jardinería', hourlyRate: '2.25' },
  ]);
  await db.insert(services).values([
    { complexId: cid, name: 'Alquiler de salón social', category: 'Amenidades', unitLabel: 'evento', unitCost: '25.00', unitPrice: '80.00' },
    { complexId: cid, name: 'Limpieza de cisterna', category: 'Mantenimiento', unitLabel: 'servicio', unitCost: '40.00', unitPrice: '60.00' },
    { complexId: cid, name: 'Acceso a piscina (visitante)', category: 'Recreación', unitLabel: 'persona', unitCost: '1.00', unitPrice: '5.00' },
  ]);

  const acc = Object.fromEntries((await db.select().from(accounts).where(eq(accounts.complexId, cid))).map((a) => [a.code, a.id]));
  const start = addMonths(new Date().getFullYear(), new Date().getMonth() + 1, -13);
  await db.transaction(async (tx) => {
    const cash = await ledger.accountByCode(cid, '1100', tx);
    const eq3100 = await ledger.accountByCode(cid, '3100', tx);
    await tx.update(complexes).set({ openingBalance: '5000.00', openingBalanceDate: monthRange(start.year, start.month).from }).where(eq(complexes.id, cid));
    await ledger.post(tx, { complexId: cid, date: monthRange(start.year, start.month).from, description: 'Saldo inicial', sourceType: 'OPENING', lines: [{ accountId: cash.id, debit: 500000 }, { accountId: eq3100.id, credit: 500000 }] });
  });

  const rnd = (base: number, spread: number) => Math.round((base + (Math.random() - 0.5) * 2 * spread) * 100) / 100;
  for (let i = 0; i < 14; i++) {
    const { year, month } = addMonths(start.year, start.month, i);
    const d = (day: number) => `${year}-${pad(month)}-${pad(Math.min(day, 28))}`;
    const add = (kind: 'INCOME' | 'EXPENSE', code: string, day: number, amount: number, description: string, counterparty?: string) =>
      movs.create(cid, u.id, kind, { date: d(day), accountId: acc[code], amount, description, counterparty, method: 'TRANSFER' });

    await add('INCOME', '4100', 10, rnd(2600, 250), 'Cuotas de mantenimiento');
    await add('INCOME', '4200', 18, rnd(320, 120), 'Alquiler de amenidades');
    await add('INCOME', '4400', 25, rnd(60, 40), 'Recargos por mora');
    await add('EXPENSE', '5100', 30, 1450, 'Planilla quincenal x2');
    await add('EXPENSE', '5200', 12, rnd(380, 60), 'Recibo de energía y agua', 'Distribuidora eléctrica');
    await add('EXPENSE', '5400', 5, 650, 'Servicio de seguridad', 'Seguridad Total S.A.');
    await add('EXPENSE', '5500', 15, rnd(220, 50), 'Jardinería y limpieza', 'Jardines del Valle');
    await add('EXPENSE', '5300', 20, rnd(300, 200), 'Mantenimiento áreas comunes', 'Ferretería Central');
    await add('EXPENSE', '5600', 28, rnd(90, 20), 'Papelería y comisiones bancarias');
  }

  console.log(`✔ Demo creada. Acceso: ${EMAIL} / Demo1234`);
  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
