import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, gte, lte, sql, SQL } from 'drizzle-orm';
import { DB, Db, Tx } from '../../db/client';
import { accounts, journalEntries, journalLines } from '../../db/schema';
import { centsToDb, toCents } from '../../common/money';
import { DEFAULT_CHART, SYSTEM_ACCOUNTS } from './chart-of-accounts';

export interface PostLine {
  accountId: string;
  debit?: number; // centavos
  credit?: number; // centavos
}

export interface AccountBalance {
  accountId: string;
  code: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
  debit: number; // centavos
  credit: number; // centavos
  /** Saldo en su naturaleza: deudora para ASSET/EXPENSE, acreedora para el resto. */
  balance: number;
}

/** Libro mayor de partida doble. Única puerta de entrada para afectar saldos. */
@Injectable()
export class LedgerService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async seedChart(complexId: string, tx: Tx = this.db) {
    await tx
      .insert(accounts)
      .values(DEFAULT_CHART.map((a) => ({ ...a, complexId, isSystem: true })))
      .onConflictDoNothing();
  }

  async accountByCode(complexId: string, code: string, tx: Tx = this.db) {
    const [a] = await tx.select().from(accounts).where(and(eq(accounts.complexId, complexId), eq(accounts.code, code)));
    if (!a) throw new NotFoundException(`Cuenta ${code} no existe`);
    return a;
  }

  async post(
    tx: Tx,
    e: { complexId: string; date: string; description: string; sourceType: string; sourceId?: string; createdBy?: string; lines: PostLine[] },
  ): Promise<string> {
    const lines = e.lines.filter((l) => (l.debit ?? 0) > 0 || (l.credit ?? 0) > 0);
    const dr = lines.reduce((s, l) => s + (l.debit ?? 0), 0);
    const cr = lines.reduce((s, l) => s + (l.credit ?? 0), 0);
    if (lines.length < 2 || dr !== cr || dr <= 0) throw new BadRequestException('Asiento descuadrado');

    const [entry] = await tx
      .insert(journalEntries)
      .values({
        complexId: e.complexId,
        date: e.date,
        description: e.description,
        sourceType: e.sourceType,
        sourceId: e.sourceId,
        createdBy: e.createdBy,
      })
      .returning({ id: journalEntries.id });

    await tx.insert(journalLines).values(
      lines.map((l) => ({
        entryId: entry.id,
        complexId: e.complexId,
        accountId: l.accountId,
        debit: centsToDb(l.debit ?? 0),
        credit: centsToDb(l.credit ?? 0),
      })),
    );
    return entry.id;
  }

  /** Asiento inverso (para anulaciones): intercambia debe y haber. */
  async reverse(tx: Tx, entryId: string, e: { date: string; description: string; createdBy?: string }) {
    const [orig] = await tx.select().from(journalEntries).where(eq(journalEntries.id, entryId));
    if (!orig) throw new NotFoundException('Asiento no encontrado');
    const lines = await tx.select().from(journalLines).where(eq(journalLines.entryId, entryId));
    return this.post(tx, {
      complexId: orig.complexId,
      date: e.date,
      description: e.description,
      sourceType: 'REVERSAL',
      sourceId: orig.id,
      createdBy: e.createdBy,
      lines: lines.map((l) => ({ accountId: l.accountId, debit: toCents(l.credit), credit: toCents(l.debit) })),
    });
  }

  /** Saldos por cuenta en un rango de fechas (ambos extremos opcionales). */
  async balances(complexId: string, range: { from?: string; to?: string } = {}): Promise<AccountBalance[]> {
    const conds: SQL[] = [eq(journalLines.complexId, complexId)];
    if (range.from) conds.push(gte(journalEntries.date, range.from));
    if (range.to) conds.push(lte(journalEntries.date, range.to));

    const rows = await this.db
      .select({
        accountId: accounts.id,
        code: accounts.code,
        name: accounts.name,
        type: accounts.type,
        debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)`,
        credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)`,
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
      .where(and(...conds))
      .groupBy(accounts.id)
      .orderBy(accounts.code);

    return rows.map((r) => {
      const debit = toCents(r.debit);
      const credit = toCents(r.credit);
      const debitNature = r.type === 'ASSET' || r.type === 'EXPENSE';
      return { ...r, debit, credit, balance: debitNature ? debit - credit : credit - debit };
    });
  }

  /** Saldo de caja y bancos a una fecha. */
  async cashBalance(complexId: string, asOf?: string): Promise<number> {
    const rows = await this.balances(complexId, { to: asOf });
    return rows.find((r) => r.code === SYSTEM_ACCOUNTS.CASH)?.balance ?? 0;
  }

  /** Totales de ingreso/gasto por mes (YYYY-MM) en un rango. */
  async monthlyTotals(complexId: string, from: string, to: string) {
    const month = sql<string>`to_char(${journalEntries.date}, 'YYYY-MM')`;
    const rows = await this.db
      .select({
        month,
        type: accounts.type,
        debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)`,
        credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)`,
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
      .where(
        and(
          eq(journalLines.complexId, complexId),
          gte(journalEntries.date, from),
          lte(journalEntries.date, to),
          sql`${accounts.type} in ('INCOME','EXPENSE')`,
        ),
      )
      .groupBy(month, accounts.type);

    const map = new Map<string, { income: number; expense: number }>();
    for (const r of rows) {
      const m = map.get(r.month) ?? { income: 0, expense: 0 };
      if (r.type === 'INCOME') m.income += toCents(r.credit) - toCents(r.debit);
      else m.expense += toCents(r.debit) - toCents(r.credit);
      map.set(r.month, m);
    }
    return map;
  }
}
