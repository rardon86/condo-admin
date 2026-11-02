/**
 * Datos de demostración: crea "Residencial Las Palmas" con 14 meses de historia.
 * Uso: npm run build -w apps/api && npm run db:seed
 * Accesos (todos con contraseña Demo1234):
 *   demo@residencial.app       Administrador del proyecto (también es empleado y puede marcar)
 *   residente@residencial.app  Propietario de la casa C-01 (portal)
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import { AppModule } from '../app.module';
import { addMonths, monthRange, pad, todayIn } from '../common/dates';
import { AuthService } from '../modules/auth/auth.service';
import { LedgerService } from '../modules/ledger/ledger.service';
import { MovementsService } from '../modules/movements/movements.service';
import { CatalogsService } from '../modules/catalogs/catalogs.module';
import { FeesService } from '../modules/fees/fees.service';
import { DB, Db } from './client';
import { accounts, announcements, complexes, employeeAssignments, employees, geofences, memberships, services, tickets, units, users } from './schema';

const EMAIL = 'demo@residencial.app';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const db = app.get<Db>(DB);
  const auth = app.get(AuthService);
  const ledger = app.get(LedgerService);
  const movs = app.get(MovementsService);
  const fees = app.get(FeesService);

  const [existing] = await db.select().from(users).where(eq(users.email, EMAIL));
  if (existing) {
    console.log('Demo ya existe');
    await app.close();
    return;
  }

  const passwordHash = await auth.hash('Demo1234');
  const [u] = await db.insert(users).values({ email: EMAIL, fullName: 'Admin Demo', passwordHash }).returning();
  const [c] = await db
    .insert(complexes)
    .values({ name: 'Residencial Las Palmas', type: 'MIXED', address: 'Santa Tecla, La Libertad', feeDueDay: 10, autoGenerateFees: true, lateFeeType: 'FIXED', lateFeeValue: '5.00', lateFeeGraceDays: 5 })
    .returning();
  const cid = c.id;
  await db.insert(memberships).values({ userId: u.id, complexId: cid, role: 'ADMIN', status: 'ACTIVE' });
  await ledger.seedChart(cid);
  await app.get(CatalogsService).seed(cid);

  // 40 propiedades con cuota de $75 (10 por pasaje)
  await db.insert(units).values(
    Array.from({ length: 40 }, (_, i) => ({
      complexId: cid, code: `C-${pad(i + 1)}`, monthlyFee: '75.00',
      address: `Pasaje ${'ABCD'[Math.floor(i / 10)]}, casa #${(i % 10) + 1}, Residencial Las Palmas, Santa Tecla, La Libertad`,
    })),
  );
  await db.insert(geofences).values({ complexId: cid, name: 'Portería principal', latitude: 13.6929, longitude: -89.2182, radiusMeters: 150 });
  const emps = await db
    .insert(employees)
    .values([
      { userId: u.id, fullName: 'Admin Demo', position: 'Administrador', hourlyRate: '5.00' },
      { fullName: 'José Martínez', position: 'Vigilante', hourlyRate: '2.50' },
      { fullName: 'Ana López', position: 'Jardinería', hourlyRate: '2.25' },
    ])
    .returning();
  await db.insert(employeeAssignments).values(emps.map((e) => ({ employeeId: e.id, complexId: cid })));

  // Propietario de la casa C-01 con acceso al portal
  const [c01] = await db.select().from(units).where(eq(units.code, 'C-01'));
  const [res] = await db.insert(users).values({ email: 'residente@residencial.app', fullName: 'María Hernández', passwordHash }).returning();
  await db.insert(memberships).values({ userId: res.id, complexId: cid, role: 'RESIDENT', status: 'ACTIVE', unitId: c01.id });
  await db.update(units).set({ ownerUserId: res.id, ownerName: res.fullName, ownerEmail: res.email }).where(eq(units.id, c01.id));
  // C-02 a C-30 con propietario registrado; C-31 a C-40 sin propietario
  const NAMES = ['Ana', 'Luis', 'Carmen', 'Jorge', 'Rosa', 'Mario', 'Elena', 'Pedro', 'Sofía', 'Raúl'];
  const LAST = ['López', 'Martínez', 'Rivera', 'Flores', 'Guzmán', 'Castro'];
  const all = await db.select().from(units).where(eq(units.complexId, cid)).orderBy(units.code);
  for (const [n, p] of all.entries()) {
    if (n === 0 || n >= 30) continue;
    const fullName = `${NAMES[n % NAMES.length]} ${LAST[n % LAST.length]}`;
    const [o] = await db.insert(users).values({ email: `propietario${pad(n + 1)}@residencial.app`, fullName, passwordHash }).returning();
    await db.insert(memberships).values({ userId: o.id, complexId: cid, role: 'RESIDENT', status: 'ACTIVE', unitId: p.id });
    await db.update(units).set({ ownerUserId: o.id, ownerName: fullName, ownerEmail: o.email }).where(eq(units.id, p.id));
  }
  await db.insert(announcements).values([
    { complexId: cid, title: 'Bienvenidos al nuevo portal', body: 'Desde aquí podrán ver avisos, sus pagos y enviar consultas o reclamos a la administración.', category: 'AVISO', pinned: true, publishedAt: new Date(), createdBy: u.id },
    { complexId: cid, title: 'Mantenimiento de piscina', body: 'La piscina estará cerrada el próximo lunes de 7:00 a 12:00 por limpieza profunda.', category: 'MANTENIMIENTO', publishedAt: new Date(), createdBy: u.id },
    { complexId: cid, title: 'Asamblea general', body: 'Se convoca a asamblea general el último sábado del mes a las 4:00 p. m. en el salón social.', category: 'ASAMBLEA', publishedAt: new Date(), createdBy: u.id },
  ]);
  await db.insert(tickets).values({ complexId: cid, unitId: c01.id, createdBy: res.id, type: 'RECLAMO', subject: 'Lámpara dañada en pasaje 2', description: 'La lámpara frente a la casa C-01 no enciende desde hace una semana.' });
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

    await add('INCOME', '4200', 18, rnd(320, 120), 'Alquiler de amenidades');
    await add('EXPENSE', '5100', 30, 1450, 'Planilla quincenal x2');
    await add('EXPENSE', '5200', 12, rnd(380, 60), 'Recibo de energía y agua', 'Distribuidora eléctrica');
    await add('EXPENSE', '5400', 5, 650, 'Servicio de seguridad', 'Seguridad Total S.A.');
    await add('EXPENSE', '5500', 15, rnd(220, 50), 'Jardinería y limpieza', 'Jardines del Valle');
    await add('EXPENSE', '5300', 20, rnd(300, 200), 'Mantenimiento áreas comunes', 'Ferretería Central');
    await add('EXPENSE', '5600', 28, rnd(90, 20), 'Papelería y comisiones bancarias');
  }

  // Cuotas: 14 meses emitidos y pagos con recibo. Perfiles: al día, atrasados intermitentes y morosos.
  const today = todayIn(c.timezone);
  const props = await db.select().from(units).where(eq(units.complexId, cid)).orderBy(units.code);
  let receipt = 1000;
  for (let i = 0; i < 14; i++) {
    const { year, month } = addMonths(start.year, start.month, i);
    const period = `${year}-${pad(month)}`;
    await fees.generateMonthly(cid, period, u.id);
    for (const [n, p] of props.entries()) {
      const date = `${period}-${pad(3 + (n % 12))}`;
      if (date > today) continue;
      const late = n >= 28 && n < 34; // pagan cada dos meses
      const moroso = n >= 34 && i >= 8; // dejaron de pagar
      if (moroso || (late && i % 2 === 0)) continue;
      const amount = late ? 150 : n === 1 && i === 13 ? 225 : 75; // C-02 adelanta dos meses
      await fees.registerPayment(cid, u.id, {
        unitId: p.id, date, amount, method: n % 3 ? 'TRANSFER' : 'CASH', receiptNumber: String(++receipt),
        description: n === 0 ? 'Cuota de mantenimiento' : null,
      });
    }
  }
  await fees.generateLateFees(cid, u.id);

  console.log(`✔ Demo creada. Admin: ${EMAIL} · Residente: residente@residencial.app · Contraseña: Demo1234`);
  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
