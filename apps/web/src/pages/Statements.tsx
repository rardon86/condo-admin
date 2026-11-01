import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Printer, XCircle } from 'lucide-react';
import { get } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateLabel, money, num, today } from '../lib/format';
import { Button, Card, cx, ErrorText, Field, Input, PageHeader, Spinner } from '../components/ui';

type Line = { code: string; name: string; amount: number };
interface IncomeStatement { income: { lines: Line[]; total: number }; expenses: { lines: Line[]; total: number }; netResult: number; marginPct: number | null }
interface BalanceSheet { assets: { lines: Line[]; total: number }; liabilities: { lines: Line[]; total: number }; equity: { lines: Line[]; total: number }; balanced: boolean }
interface CashFlow { openingCash: number; operating: { inflows: Line[]; outflows: Line[]; totalIn: number; totalOut: number; net: number }; otherMovements: number; closingCash: number }

const TABS = [
  { id: 'er', label: 'Estado de resultados' },
  { id: 'bg', label: 'Balance general' },
  { id: 'fe', label: 'Flujo de efectivo' },
] as const;

function Section({ title, lines, total, totalLabel }: { title: string; lines: Line[]; total: number; totalLabel: string }) {
  return (
    <div className="mb-5">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</div>
      {lines.length === 0 && <div className="py-1 text-sm text-slate-400">Sin movimientos</div>}
      {lines.map((l) => (
        <div key={l.code} className="flex justify-between gap-4 border-b border-dashed border-slate-100 py-1.5 text-sm">
          <span className="text-slate-700">{l.code} · {l.name}</span>
          <span className="tabular-nums">{money(l.amount)}</span>
        </div>
      ))}
      <div className="flex justify-between py-2 text-sm font-semibold"><span>{totalLabel}</span><span className="tabular-nums">{money(total)}</span></div>
    </div>
  );
}

const Total = ({ label, value, strong }: { label: string; value: number; strong?: boolean }) => (
  <div className={cx('flex justify-between rounded-lg px-3 py-2.5', strong ? 'bg-ink text-white ring-1 ring-brand-500/30' : 'bg-slate-50')}>
    <span className="font-semibold">{label}</span>
    <span className={cx('font-bold tabular-nums', !strong && value < 0 && 'text-red-700')}>{money(value)}</span>
  </div>
);

/** Estados financieros derivados del libro contable de partida doble. */
export function StatementsPage() {
  const { complex } = useAuth();
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('er');
  const [range, setRange] = useState({ from: `${today().slice(0, 4)}-01-01`, to: today() });

  const er = useQuery({ queryKey: ['er', range], queryFn: () => get<IncomeStatement>('/reports/income-statement', range), enabled: tab === 'er' });
  const bg = useQuery({ queryKey: ['bg', range.to], queryFn: () => get<BalanceSheet>('/reports/balance-sheet', { asOf: range.to }), enabled: tab === 'bg' });
  const fe = useQuery({ queryKey: ['fe', range], queryFn: () => get<CashFlow>('/reports/cash-flow', range), enabled: tab === 'fe' });
  const active = { er, bg, fe }[tab];

  return (
    <div className="space-y-6">
      <PageHeader title="Estados financieros" subtitle={complex?.name} actions={<Button variant="secondary" className="print:hidden" onClick={() => window.print()}><Printer className="size-4" />Imprimir / PDF</Button>} />

      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <div className="flex rounded-lg bg-slate-100 p-1">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} className={cx('rounded-md px-3 py-1.5 text-sm', tab === t.id ? 'bg-surface font-medium shadow-sm' : 'text-slate-600')}>{t.label}</button>
          ))}
        </div>
        {tab !== 'bg' && <Field label="Desde"><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>}
        <Field label={tab === 'bg' ? 'Al' : 'Hasta'}><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
      </div>

      <Card className="mx-auto max-w-3xl">
        <div className="mb-5 text-center">
          <div className="font-bold">{complex?.name}</div>
          <div className="text-sm font-semibold">{TABS.find((t) => t.id === tab)?.label}</div>
          <div className="text-xs text-slate-500">{tab === 'bg' ? `Al ${dateLabel(range.to)}` : `Del ${dateLabel(range.from)} al ${dateLabel(range.to)}`} · Cifras en USD</div>
        </div>
        {active.isLoading ? <Spinner /> : active.error ? <ErrorText error={active.error} /> : (
          <>
            {tab === 'er' && er.data && (
              <>
                <Section title="Ingresos" lines={er.data.income.lines} total={er.data.income.total} totalLabel="Total ingresos" />
                <Section title="Gastos" lines={er.data.expenses.lines} total={er.data.expenses.total} totalLabel="Total gastos" />
                <Total strong label={er.data.netResult >= 0 ? 'Excedente del periodo' : 'Déficit del periodo'} value={er.data.netResult} />
                {er.data.marginPct !== null && <p className="mt-2 text-right text-xs text-slate-500">Margen: {num(er.data.marginPct)}%</p>}
              </>
            )}
            {tab === 'bg' && bg.data && (
              <>
                <Section title="Activo" lines={bg.data.assets.lines} total={bg.data.assets.total} totalLabel="Total activo" />
                <Section title="Pasivo" lines={bg.data.liabilities.lines} total={bg.data.liabilities.total} totalLabel="Total pasivo" />
                <Section title="Patrimonio" lines={bg.data.equity.lines} total={bg.data.equity.total} totalLabel="Total patrimonio" />
                <Total strong label="Pasivo + Patrimonio" value={bg.data.liabilities.total + bg.data.equity.total} />
                <p className={cx('mt-3 flex items-center justify-end gap-1.5 text-xs', bg.data.balanced ? 'text-emerald-700' : 'text-red-700')}>
                  {bg.data.balanced ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
                  {bg.data.balanced ? 'Cuadrado: Activo = Pasivo + Patrimonio' : 'Descuadre detectado — revisar asientos'}
                </p>
              </>
            )}
            {tab === 'fe' && fe.data && (
              <div className="space-y-3">
                <Total label="Saldo inicial de efectivo" value={fe.data.openingCash} />
                <Section title="Entradas de efectivo (operación)" lines={fe.data.operating.inflows} total={fe.data.operating.totalIn} totalLabel="Total entradas" />
                <Section title="Salidas de efectivo (operación)" lines={fe.data.operating.outflows} total={fe.data.operating.totalOut} totalLabel="Total salidas" />
                <Total label="Flujo neto de operación" value={fe.data.operating.net} />
                {fe.data.otherMovements !== 0 && <Total label="Otros movimientos (aportes / saldo inicial)" value={fe.data.otherMovements} />}
                <Total strong label="Saldo final de efectivo" value={fe.data.closingCash} />
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
