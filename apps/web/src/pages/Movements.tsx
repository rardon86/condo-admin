import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Plus } from 'lucide-react';
import { get, post } from '../lib/api';
import { can, useAuth } from '../lib/auth';
import { dateLabel, firstOfMonth, METHODS, money, today } from '../lib/format';
import { Badge, Button, Card, ErrorText, Field, formData, Input, Modal, PageHeader, Select, Spinner, Table } from '../components/ui';

export interface Account { id: string; code: string; name: string; type: string; postable: boolean }
export interface Unit { id: string; code: string; ownerName: string | null; monthlyFee: string; active: boolean }
interface Movement {
  id: string; date: string; amount: string; method: string; reference: string | null; description: string | null;
  counterparty: string | null; voidedAt: string | null; voidReason: string | null; accountName: string; accountCode: string; unitCode: string | null; serviceRecordId: string | null;
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
    create.mutate({ ...f, amount: Number(f.amount), unitId: f.unitId || null, counterparty: f.counterparty || null, reference: f.reference || null });
  }

  const postable = accounts.data?.filter((a) => a.postable) ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={isIncome ? 'Ingresos' : 'Egresos'}
        subtitle={isIncome ? 'Cuotas, alquileres, multas y otros ingresos del complejo' : 'Pagos a proveedores, planilla, servicios y mantenimiento'}
        actions={canWrite && <Button onClick={() => setCreating(true)}><Plus className="size-4" />Registrar {isIncome ? 'ingreso' : 'egreso'}</Button>}
      />

      <Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Desde"><Input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></Field>
          <Field label="Hasta"><Input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></Field>
          <Field label="Categoría">
            <Select value={filters.accountId} onChange={(e) => setFilters({ ...filters, accountId: e.target.value })}>
              <option value="">Todas</option>
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
              { header: 'Categoría', cell: (r) => r.accountName },
              { header: isIncome ? 'Unidad / pagador' : 'Proveedor', cell: (r) => [r.unitCode, r.counterparty].filter(Boolean).join(' · ') || '—' },
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

      <Modal open={creating} onClose={() => setCreating(false)} title={`Registrar ${isIncome ? 'ingreso' : 'egreso'}`}>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Fecha"><Input name="date" type="date" defaultValue={today()} required /></Field>
            <Field label="Monto (USD)"><Input name="amount" type="number" step="0.01" min="0.01" required inputMode="decimal" /></Field>
          </div>
          <Field label="Categoría">
            <Select name="accountId" required>
              {postable.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </Select>
          </Field>
          {isIncome && (
            <Field label="Unidad (opcional)">
              <Select name="unitId" defaultValue="">
                <option value="">— Sin unidad —</option>
                {unitsQ.data?.map((u) => <option key={u.id} value={u.id}>{u.code}{u.ownerName ? ` · ${u.ownerName}` : ''}</option>)}
              </Select>
            </Field>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={isIncome ? 'Pagador' : 'Proveedor'}><Input name="counterparty" maxLength={150} /></Field>
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
