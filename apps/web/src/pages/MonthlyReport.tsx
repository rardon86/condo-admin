import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Printer } from 'lucide-react';
import { get } from '../lib/api';
import { CHART, tooltipStyle } from '../lib/theme';
import { useAuth } from '../lib/auth';
import { dateLabel, money, MONTHS_LONG, num } from '../lib/format';
import { Button, Card, ErrorText, PageHeader, Select, Spinner, Table } from '../components/ui';

interface Report {
  period: { year: number; month: number; from: string; to: string };
  total: number; income: number; expenseToIncomePct: number | null;
  previousMonth: { total: number; changePct: number | null };
  sameMonthLastYear: { total: number; changePct: number | null };
  byCategory: { code: string; name: string; amount: number; pct: number; previous: number; changePct: number | null }[];
  byVendor: { vendor: string; amount: number; count: number }[];
  largest: { id: string; date: string; amount: number; description: string | null; counterparty: string | null; category: string }[];
}

const Delta = ({ v }: { v: number | null }) =>
  v === null ? <span className="text-slate-400">—</span> : <span className={v > 0 ? 'text-red-600' : 'text-emerald-600'}>{v > 0 ? '▲' : '▼'} {num(Math.abs(v))}%</span>;

/** Informe mensual de gastos (imprimible). */
export function MonthlyReportPage() {
  const { complex } = useAuth();
  const now = new Date();
  const [ym, setYm] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const { data: r, isLoading, error } = useQuery({ queryKey: ['monthly-expenses', ym], queryFn: () => get<Report>('/reports/monthly-expenses', ym) });
  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Informe mensual de gastos"
        subtitle={`${complex?.name ?? ''} · ${MONTHS_LONG[ym.month - 1]} ${ym.year}`}
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <Select value={ym.month} onChange={(e) => setYm({ ...ym, month: Number(e.target.value) })}>
              {MONTHS_LONG.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </Select>
            <Select value={ym.year} onChange={(e) => setYm({ ...ym, year: Number(e.target.value) })}>
              {years.map((y) => <option key={y}>{y}</option>)}
            </Select>
            <Button variant="secondary" onClick={() => window.print()}><Printer className="size-4" />Imprimir / PDF</Button>
          </div>
        }
      />
      {isLoading ? <Spinner /> : error || !r ? <ErrorText error={error} /> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card><div className="text-sm text-slate-500">Total de gastos</div><div className="mt-1 text-2xl font-bold">{money(r.total)}</div></Card>
            <Card><div className="text-sm text-slate-500">vs. mes anterior</div><div className="mt-1 text-2xl font-bold"><Delta v={r.previousMonth.changePct} /></div><div className="text-xs text-slate-500">{money(r.previousMonth.total)}</div></Card>
            <Card><div className="text-sm text-slate-500">vs. mismo mes año anterior</div><div className="mt-1 text-2xl font-bold"><Delta v={r.sameMonthLastYear.changePct} /></div><div className="text-xs text-slate-500">{money(r.sameMonthLastYear.total)}</div></Card>
            <Card><div className="text-sm text-slate-500">Gasto / ingreso</div><div className="mt-1 text-2xl font-bold">{r.expenseToIncomePct === null ? '—' : `${num(r.expenseToIncomePct)}%`}</div><div className="text-xs text-slate-500">Ingresos {money(r.income)}</div></Card>
          </div>

          <Card title="Gastos por categoría">
            {r.byCategory.length > 0 && (
              <div className="mb-4 h-64">
                <ResponsiveContainer>
                  <BarChart data={r.byCategory} layout="vertical" margin={{ left: 8 }}>
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="name" width={170} fontSize={12} tickLine={false} axisLine={false} tick={{ fill: CHART.axis }} />
                    <Tooltip formatter={(v: number) => money(v)} {...tooltipStyle} />
                    <Bar dataKey="amount" name="Monto" radius={[0, 4, 4, 0]}>
                      {r.byCategory.map((_, i) => <Cell key={i} fill={i === 0 ? CHART.expense : CHART.expenseSoft} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            <Table rows={r.byCategory} rowKey={(c) => c.code} empty="Sin gastos en el periodo"
              columns={[
                { header: 'Categoría', cell: (c) => `${c.code} · ${c.name}` },
                { header: 'Monto', align: 'right', cell: (c) => money(c.amount) },
                { header: '% del total', align: 'right', cell: (c) => `${num(c.pct)}%` },
                { header: 'Mes anterior', align: 'right', cell: (c) => money(c.previous) },
                { header: 'Variación', align: 'right', cell: (c) => <Delta v={c.changePct} /> },
              ]} />
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Principales proveedores">
              <Table rows={r.byVendor} rowKey={(v) => v.vendor}
                columns={[
                  { header: 'Proveedor', cell: (v) => v.vendor },
                  { header: 'Pagos', align: 'right', cell: (v) => v.count },
                  { header: 'Monto', align: 'right', cell: (v) => money(v.amount) },
                ]} />
            </Card>
            <Card title="Gastos más altos">
              <Table rows={r.largest} rowKey={(l) => l.id}
                columns={[
                  { header: 'Fecha', cell: (l) => dateLabel(l.date) },
                  { header: 'Detalle', cell: (l) => <><div>{l.description ?? l.category}</div><div className="text-xs text-slate-500">{l.counterparty}</div></> },
                  { header: 'Monto', align: 'right', cell: (l) => money(l.amount) },
                ]} />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
