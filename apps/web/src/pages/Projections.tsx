import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { get } from '../lib/api';
import { money, monthLabel, num } from '../lib/format';
import { Alert, Card, ErrorText, PageHeader, Select, Spinner, Table } from '../components/ui';

interface Point { month: string; income: number; expense: number; net: number }
interface Projections {
  method: string; monthsOfHistory: number; history: Point[]; forecast: Point[];
  cashPath: { month: string; cash: number }[]; cashDepletionMonth: string | null; trend: string;
  annual: { year: number; actual: { income: number; expense: number; net: number }; projected: { income: number; expense: number; net: number } };
}
interface Annual {
  year: number; months: (Point & { prevIncome: number; prevExpense: number })[];
  totals: { income: number; expense: number; net: number }; previousYear: { income: number; expense: number; net: number };
  growth: { income: number | null; expense: number | null };
}

const Growth = ({ v }: { v: number | null }) => (v === null ? <>—</> : <>{v > 0 ? '+' : ''}{num(v)}%</>);

/** Análisis y proyecciones de ingresos y gastos, mensual y anual. */
export function ProjectionsPage() {
  const [horizon, setHorizon] = useState(6);
  const year = new Date().getFullYear();
  const [annualYear, setAnnualYear] = useState(year);
  const p = useQuery({ queryKey: ['projections', horizon], queryFn: () => get<Projections>('/analytics/projections', { horizon }) });
  const a = useQuery({ queryKey: ['annual', annualYear], queryFn: () => get<Annual>('/analytics/annual', { year: annualYear }) });

  if (p.isLoading) return <Spinner />;
  if (p.error || !p.data) return <ErrorText error={p.error} />;
  const d = p.data;
  const chart = [
    ...d.history.slice(-12).map((h) => ({ ...h, label: monthLabel(h.month), tipo: 'real' })),
    ...d.forecast.map((f) => ({ label: monthLabel(f.month), incomeF: f.income, expenseF: f.expense, cash: d.cashPath.find((c) => c.month === f.month)?.cash })),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Análisis y proyecciones"
        subtitle={`Modelo: ${d.method === 'holt' ? 'suavizado exponencial (Holt)' : 'Holt con estacionalidad'} · ${d.monthsOfHistory} meses de historia`}
        actions={
          <Select value={horizon} onChange={(e) => setHorizon(Number(e.target.value))}>
            {[3, 6, 12].map((h) => <option key={h} value={h}>Proyectar {h} meses</option>)}
          </Select>
        }
      />

      {d.monthsOfHistory < 6 && <Alert tone="amber">Con menos de 6 meses de historia la proyección es orientativa. Mejora conforme registres más meses.</Alert>}
      {d.cashDepletionMonth && <Alert tone="red">Al ritmo actual, la caja quedaría en negativo en <strong>{monthLabel(d.cashDepletionMonth)}</strong>.</Alert>}

      <Card title="Real (12 meses) y proyectado">
        <div className="h-80">
          <ResponsiveContainer>
            <ComposedChart data={chart}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="label" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `$${num(v / 1000)}k`} width={52} />
              <Tooltip formatter={(v: number) => money(v)} />
              <Legend />
              <Bar dataKey="income" name="Ingresos" fill="#2563eb" radius={[3, 3, 0, 0]} />
              <Bar dataKey="expense" name="Egresos" fill="#f87171" radius={[3, 3, 0, 0]} />
              <Bar dataKey="incomeF" name="Ingresos proyectados" fill="#93c5fd" radius={[3, 3, 0, 0]} />
              <Bar dataKey="expenseF" name="Egresos proyectados" fill="#fecaca" radius={[3, 3, 0, 0]} />
              <Line dataKey="cash" name="Caja proyectada" stroke="#7c3aed" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Proyección anual ${d.annual.year}`}>
          <Table rows={[
            { k: 'Ingresos', a: d.annual.actual.income, p: d.annual.projected.income },
            { k: 'Egresos', a: d.annual.actual.expense, p: d.annual.projected.expense },
            { k: 'Resultado', a: d.annual.actual.net, p: d.annual.projected.net },
          ]} rowKey={(r) => r.k} columns={[
            { header: 'Concepto', cell: (r) => <strong>{r.k}</strong> },
            { header: 'Real a la fecha', align: 'right', cell: (r) => money(r.a) },
            { header: 'Proyectado al cierre', align: 'right', cell: (r) => money(r.p) },
          ]} />
        </Card>
        <Card title="Detalle de la proyección">
          <Table rows={d.forecast} rowKey={(r) => r.month} columns={[
            { header: 'Mes', cell: (r) => monthLabel(r.month) },
            { header: 'Ingresos', align: 'right', cell: (r) => money(r.income) },
            { header: 'Egresos', align: 'right', cell: (r) => money(r.expense) },
            { header: 'Neto', align: 'right', cell: (r) => <span className={r.net < 0 ? 'text-red-700' : ''}>{money(r.net)}</span> },
          ]} />
        </Card>
      </div>

      <Card title="Comparativo anual" actions={
        <Select value={annualYear} onChange={(e) => setAnnualYear(Number(e.target.value))}>
          {[year, year - 1, year - 2].map((y) => <option key={y}>{y}</option>)}
        </Select>
      }>
        {a.data && (
          <>
            <div className="mb-4 grid gap-3 sm:grid-cols-3 text-sm">
              <div className="rounded-lg bg-slate-50 p-3">Ingresos {money(a.data.totals.income)} <span className="text-slate-500">(<Growth v={a.data.growth.income} /> vs {a.data.year - 1})</span></div>
              <div className="rounded-lg bg-slate-50 p-3">Egresos {money(a.data.totals.expense)} <span className="text-slate-500">(<Growth v={a.data.growth.expense} />)</span></div>
              <div className="rounded-lg bg-slate-50 p-3">Resultado {money(a.data.totals.net)}</div>
            </div>
            <Table rows={a.data.months} rowKey={(m) => m.month} columns={[
              { header: 'Mes', cell: (m) => monthLabel(m.month) },
              { header: 'Ingresos', align: 'right', cell: (m) => money(m.income) },
              { header: `Ingresos ${a.data!.year - 1}`, align: 'right', cell: (m) => <span className="text-slate-500">{money(m.prevIncome)}</span> },
              { header: 'Egresos', align: 'right', cell: (m) => money(m.expense) },
              { header: `Egresos ${a.data!.year - 1}`, align: 'right', cell: (m) => <span className="text-slate-500">{money(m.prevExpense)}</span> },
              { header: 'Neto', align: 'right', cell: (m) => money(m.net) },
            ]} />
          </>
        )}
      </Card>
    </div>
  );
}
