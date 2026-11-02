import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Ban, HandCoins, Plus } from 'lucide-react';
import { get, post } from '../lib/api';
import { can, useAuth } from '../lib/auth';
import { dateLabel, firstOfMonth, METHODS, money, today } from '../lib/format';
import { Badge, Button, Card, ErrorText, Field, formData, Input, Modal, PageHeader, Select, Spinner, Table } from '../components/ui';
import { ExcelButton } from '../components/ExcelButton';
import { downloadXlsx } from '../lib/xlsx';

export interface Account { id: string; code: string; name: string; type: string; postable: boolean }
/** Propiedad (tabla `units`). */
export interface Unit { id: string; code: string; ownerName: string | null; monthlyFee: string; active: boolean; address?: string | null }
interface Movement {
  id: string; date: string; amount: string; method: string; reference: string | null; description: string | null;
  counterparty: string | null; receiptNumber: string | null; voidedAt: string | null; voidReason: string | null; accountName: string; accountCode: string; unitCode: string | null; serviceRecordId: string | null;
}

/** Registro de ingresos o egresos (misma pantalla, diferente tipo). */
export function MovementsPage({ kind }: { kind: 'INCOME' | 'EXPENSE' }) {
  const isIncome = kind === 'INCOME';
  const path = isIncome ? '/incomes' : '/expenses';
  const { complex } = useAuth();
  const canWrite = can(complex?.role, 'finWrite');
  const qc = useQueryClient();
  const [filters, setFilters] = useState({ from: firstOfMonth(), to: today(), accountId: '', includeVoided: 'false' });
  const [creating, setCreating] = useState(false);
  const [voiding, setVoiding] = useState<Movement | null>(null);

  const accounts = useQuery({ queryKey: ['accounts', kind], queryFn: () => get<Account[]>('/accounts', { type: kind }) });
  // Los pagos de cuotas se registran contra 1200 (Cuotas por cobrar): se agregan al filtro de ingresos
  const receivable = useQuery({ queryKey: ['accounts', 'ASSET'], queryFn: () => get<Account[]>('/accounts', { type: 'ASSET' }), enabled: isIncome });
  const feeAccount = receivable.data?.find((a) => a.code === '1200');
  const unitsQ = useQuery({ queryKey: ['units'], queryFn: () => get<Unit[]>('/units'), enabled: isIncome });
  const list = useQuery({ queryKey: [path, filters], queryFn: () => get<{ items: Movement[]; total: number; count: number }>(path, filters) });

  const create = useMutation({
    mutationFn: (body: unknown) => post(path, body),
    onSuccess: () => { qc.invalidateQueries(); setCreating(false); },
  });
  const voidM = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => post(`${path}/${id}/void`, { reason }),
    onSuccess: () => { qc.invalidateQueries(); setVoiding(null); },
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = formData(e);
    create.mutate({ ...f, amount: Number(f.amount), unitId: f.unitId || null, counterparty: f.counterparty || null, receiptNumber: f.receiptNumber || null, reference: f.reference || null });
  }

  const postable = accounts.data?.filter((a) => a.postable) ?? [];
  // Las cuotas (4100) se cobran desde Cuotas para que se apliquen al estado de cuenta
  const formAccounts = isIncome ? postable.filter((a) => a.code !== '4100') : postable;

  return (
    <div className="space-y-6">
      <PageHeader
        title={isIncome ? 'Ingresos' : 'Egresos'}
        subtitle={isIncome ? 'Cuotas, alquileres, multas y otros ingresos del complejo' : 'Pagos a proveedores, planilla, servicios y mantenimiento'}
        actions={canWrite && (
          <>
            {isIncome && <Link to="/cuotas?pagar="><Button><HandCoins className="size-4" />Pago de cuotas</Button></Link>}
            <Button variant={isIncome ? 'secondary' : 'primary'} onClick={() => setCreating(true)}><Plus className="size-4" />{isIncome ? 'Otro ingreso' : 'Registrar egreso'}</Button>
            <ExcelButton disabled={!list.data} onClick={() => list.data && downloadXlsx(`${isIncome ? 'Ingresos' : 'Egresos'} ${filters.from} a ${filters.to}`, [{
              name: isIncome ? 'Ingresos' : 'Egresos',
              title: [`${complex?.name ?? ''} — ${isIncome ? 'Ingresos' : 'Egresos'} del ${filters.from} al ${filters.to}`],
              header: isIncome
                ? ['Fecha', 'Categoría', 'Recibo', 'Propiedad', 'Descripción', 'Método', 'Referencia', 'Monto', 'Estado']
                : ['Fecha', 'Categoría', 'Proveedor', 'Descripción', 'Método', 'Referencia', 'Monto', 'Estado'],
              rows: list.data.items.map((r) => {
                const cat = r.accountCode === '1200' ? 'Pago de cuotas' : `${r.accountCode} · ${r.accountName}`;
                const state = r.voidedAt ? `Anulado: ${r.voidReason ?? ''}` : 'Vigente';
                return isIncome
                  ? [r.date, cat, r.receiptNumber, r.unitCode, r.description, METHODS[r.method], r.reference, Number(r.amount), state]
                  : [r.date, cat, r.counterparty, r.description, METHODS[r.method], r.reference, Number(r.amount), state];
              }),
              money: [isIncome ? 7 : 6],
              totals: isIncome ? ['Total vigente', null, null, null, null, null, null, list.data.total, null] : ['Total vigente', null, null, null, null, null, list.data.total, null],
            }])} />
          </>
        )}
      />

      <Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Desde"><Input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></Field>
          <Field label="Hasta"><Input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></Field>
          <Field label="Categoría">
            <Select value={filters.accountId} onChange={(e) => setFilters({ ...filters, accountId: e.target.value })}>
              <option value="">Todas</option>
              {isIncome && feeAccount && <option value={feeAccount.id}>Pagos de cuotas</option>}
              {postable.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </Select>
          </Field>
          <Field label="Anulados">
            <Select value={filters.includeVoided} onChange={(e) => setFilters({ ...filters, includeVoided: e.target.value })}>
              <option value="false">Ocultar</option>
              <option value="true">Mostrar</option>
            </Select>
          </Field>
        </div>
      </Card>

      <Card title={list.data ? `${list.data.count} registros · Total ${money(list.data.total)}` : 'Registros'}>
        {list.isLoading ? <Spinner /> : (
          <Table
            rows={list.data?.items ?? []}
            rowKey={(r) => r.id}
            columns={[
              { header: 'Fecha', cell: (r) => <span className="whitespace-nowrap">{dateLabel(r.date)}</span> },
              { header: 'Categoría', cell: (r) => (r.accountCode === '1200' ? 'Pago de cuotas' : r.accountName) },
              ...(isIncome ? [{ header: 'Recibo', cell: (r: Movement) => r.receiptNumber ?? '—' }] : []),
              { header: isIncome ? 'Propiedad' : 'Proveedor', cell: (r) => (isIncome ? r.unitCode : r.counterparty) || '—' },
              { header: 'Descripción', cell: (r) => (
                <span className={r.voidedAt ? 'text-slate-400 line-through' : ''}>
                  {r.description || '—'} {r.serviceRecordId && <Badge tone="violet">Servicio</Badge>}
                  {r.voidedAt && <span className="ml-1 no-underline"><Badge tone="red">Anulado</Badge></span>}
                </span>
              ) },
              { header: 'Método', cell: (r) => METHODS[r.method] },
              { header: 'Monto', align: 'right', cell: (r) => <span className={isIncome ? 'text-emerald-700' : 'text-red-700'}>{money(r.amount)}</span> },
              { header: '', cell: (r) => canWrite && !r.voidedAt && (
                <button title="Anular" onClick={() => setVoiding(r)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"><Ban className="size-4" /></button>
              ) },
            ]}
          />
        )}
      </Card>

      <Modal open={creating} onClose={() => setCreating(false)} title={isIncome ? 'Registrar otro ingreso' : 'Registrar egreso'}>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Fecha"><Input name="date" type="date" defaultValue={today()} required /></Field>
            <Field label="Monto (USD)"><Input name="amount" type="number" step="0.01" min="0.01" required inputMode="decimal" /></Field>
          </div>
          <Field label="Categoría" hint={isIncome ? 'Las cuotas de mantenimiento se cobran con “Pago de cuotas”' : undefined}>
            <Select name="accountId" required>
              {formAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </Select>
          </Field>
          {isIncome && (
            <Field label="Propiedad (opcional)">
              <Select name="unitId" defaultValue="">
                <option value="">— Sin propiedad —</option>
                {unitsQ.data?.map((u) => <option key={u.id} value={u.id}>{u.code}{u.ownerName ? ` · ${u.ownerName}` : ''}</option>)}
              </Select>
            </Field>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {isIncome
              ? <Field label="N.º de recibo"><Input name="receiptNumber" maxLength={40} placeholder="Recibo físico" /></Field>
              : <Field label="Proveedor"><Input name="counterparty" maxLength={150} /></Field>}
            <Field label="Método de pago">
              <Select name="method" defaultValue="TRANSFER">
                {Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Referencia / N.º de documento"><Input name="reference" maxLength={80} /></Field>
          <Field label="Descripción"><Input name="description" maxLength={1000} /></Field>
          <ErrorText error={create.error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setCreating(false)}>Cancelar</Button>
            <Button loading={create.isPending}>Guardar</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!voiding} onClose={() => setVoiding(null)} title="Anular registro">
        <form
          onSubmit={(e) => { e.preventDefault(); voidM.mutate({ id: voiding!.id, reason: formData(e).reason }); }}
          className="space-y-4"
        >
          <p className="text-sm text-slate-600">
            Los registros contables no se eliminan: se genera un asiento de reversión por {money(voiding?.amount)} y queda en la bitácora de auditoría.
          </p>
          <Field label="Motivo"><Input name="reason" required minLength={3} /></Field>
          <ErrorText error={voidM.error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setVoiding(null)}>Cancelar</Button>
            <Button variant="danger" loading={voidM.isPending}>Anular</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
