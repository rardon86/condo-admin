import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalendarClock, Info, ShieldAlert, ShieldCheck, Target, Timer, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { get } from '../lib/api';
import { CHART, tooltipStyle } from '../lib/theme';
import { dateLabel, money, monthLabel, num } from '../lib/format';
import { Alert, Badge, Button, Card, ErrorText, Kpi, PageHeader, Spinner, Tone } from '../components/ui';

interface Dashboard {
  asOf: string;
  openingBalanceConfigured: boolean;
  cashBalance: number;
  month: { income: number; expense: number; net: number };
  collection: { rate: number | null; collected: number; expected: number; goal: number; receivable: number };
  runwayMonths: number | null;
  avgMonthlyExpense: number;
  health: { level: 'BUENA' | 'ATENCION' | 'CRITICA'; issues: string[] };
  trend: 'MEJORANDO' | 'ESTABLE' | 'DETERIORANDO';
  series: { month: string; income: number; expense: number; net: number }[];
  counts: { units: number; employees: number };
}

const HEALTH: Record<Dashboard['health']['level'], { label: string; tone: Tone }> = {
  BUENA: { label: 'Buena', tone: 'green' },
  ATENCION: { label: 'Atención', tone: 'amber' },
  CRITICA: { label: 'Crítica', tone: 'red' },
};
const TREND = { MEJORANDO: 'Mejorando', ESTABLE: 'Estable', DETERIORANDO: 'Deteriorando' };

export function DashboardPage() {
  const { data: d, isLoading, error } = useQuery({ queryKey: ['dashboard'], queryFn: () => get<Dashboard>('/reports/dashboard') });
  if (isLoading) return <Spinner />;
  if (error || !d) return <ErrorText error={error} />;

  const h = HEALTH[d.health.level];
  const runwayTone: Tone = d.runwayMonths === null ? 'slate' : d.runwayMonths < 1 ? 'red' : d.runwayMonths < 3 ? 'amber' : 'green';
  const rate = d.collection.rate;

  return (
    <div className="space-y-6">
      <PageHeader title="Panel principal" subtitle={`Datos al ${dateLabel(d.asOf)}`} />

      {!d.openingBalanceConfigured && (
        <Alert icon={<Info />} action={<Link to="/ajustes"><Button variant="secondary">Ir a Ajustes</Button></Link>}>
          <strong className="block">Configura tu saldo inicial</strong>
          Ingresa el saldo actual de tu complejo en Ajustes para obtener KPIs financieros precisos.
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Saldo actual" tone={d.cashBalance < 0 ? 'red' : 'blue'} icon={<Wallet />} value={money(d.cashBalance)} sub={`Al ${dateLabel(d.asOf)}`} help="Saldo de caja y bancos según el libro contable" />
        <Kpi label="Balance mensual" tone={d.month.net < 0 ? 'red' : 'green'} icon={d.month.net < 0 ? <TrendingDown /> : <TrendingUp />} value={money(d.month.net)}
          sub={`Ingresos ${money(d.month.income)} · Egresos ${money(d.month.expense)}`} help="Ingresos menos egresos del mes en curso" />
        <Kpi label="Tasa de cobranza" tone="amber" icon={<Target />} value={rate === null ? '—' : `${num(rate)}%`}
          sub={rate === null ? 'Genera las cuotas del mes en Cuotas · Meta 80%' : <>{money(d.collection.collected)} de {money(d.collection.expected)} · Meta {d.collection.goal}%<br /><Link to="/informes/estado-cuenta" className="underline">Por cobrar {money(d.collection.receivable)}</Link></>}
          help="Cuotas del mes pagadas vs. emitidas. “Por cobrar” es el saldo total pendiente de todas las propiedades (cuenta 1200)." />
        <Kpi label="Salud financiera" tone={h.tone} icon={d.health.level === 'BUENA' ? <ShieldCheck /> : <ShieldAlert />} value={<Badge tone={h.tone}>{h.label}</Badge>}
          sub={d.health.issues[0] ?? 'Sin alertas'} help={d.health.issues.join(' · ') || 'Sin alertas'} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Kpi label="Autonomía" tone={runwayTone} icon={<Timer />} value={d.runwayMonths === null ? '—' : `${num(d.runwayMonths)} meses`}
          sub={`Gasto promedio mensual ${money(d.avgMonthlyExpense)}`} help="Meses que el saldo actual cubre el gasto promedio de los últimos 3 meses" />
        <Kpi label="Proyección" tone="violet" icon={<CalendarClock />} value={TREND[d.trend]}
          sub={<Link to="/informes/proyecciones" className="underline">Ver proyección de 6 meses</Link>} help="Tendencia del resultado neto de los últimos meses" />
      </div>

      <Card title="Ingresos vs. egresos (últimos 6 meses)">
        <div className="h-72">
          <ResponsiveContainer>
            <BarChart data={d.series.map((s) => ({ ...s, label: monthLabel(s.month) }))}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART.grid} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} tick={{ fill: CHART.axis }} />
              <YAxis tickLine={false} axisLine={false} fontSize={12} tick={{ fill: CHART.axis }} tickFormatter={(v) => `$${num(v / 1000)}k`} width={48} />
              <Tooltip formatter={(v: number) => money(v)} {...tooltipStyle} />
              <Legend />
              <Bar dataKey="income" name="Ingresos" fill={CHART.income} radius={[4, 4, 0, 0]} />
              <Bar dataKey="expense" name="Egresos" fill={CHART.expense} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card><div className="text-sm text-slate-500">Propiedades activas</div><div className="mt-1 text-2xl font-bold">{d.counts.units}</div></Card>
        <Card><div className="text-sm text-slate-500">Empleados activos</div><div className="mt-1 text-2xl font-bold">{d.counts.employees}</div></Card>
      </div>
    </div>
  );
}
