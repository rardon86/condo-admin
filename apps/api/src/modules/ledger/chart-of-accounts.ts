/** Catálogo de cuentas por defecto para un complejo residencial/recreativo. */
export type AccountSeed = { code: string; name: string; type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE'; parentCode?: string };

export const SYSTEM_ACCOUNTS = {
  CASH: '1100',
  RECEIVABLE: '1200',
  PAYABLE: '2100',
  /** Saldo a favor de propietarios (pagos por adelantado o en exceso). */
  ADVANCES: '2200',
  OPENING_EQUITY: '3100',
  RETAINED_EARNINGS: '3200',
  MAINTENANCE_FEES: '4100',
  SERVICES_INCOME: '4300',
  LATE_FEES: '4400',
  SERVICES_COST: '5700',
  PAYROLL: '5100',
} as const;

export const DEFAULT_CHART: AccountSeed[] = [
  { code: '1000', name: 'Activo', type: 'ASSET' },
  { code: '1100', name: 'Caja y bancos', type: 'ASSET', parentCode: '1000' },
  { code: '1200', name: 'Cuotas por cobrar', type: 'ASSET', parentCode: '1000' },
  { code: '2000', name: 'Pasivo', type: 'LIABILITY' },
  { code: '2100', name: 'Cuentas por pagar', type: 'LIABILITY', parentCode: '2000' },
  { code: '2200', name: 'Depósitos y anticipos de residentes', type: 'LIABILITY', parentCode: '2000' },
  { code: '3000', name: 'Patrimonio', type: 'EQUITY' },
  { code: '3100', name: 'Fondo inicial', type: 'EQUITY', parentCode: '3000' },
  { code: '3200', name: 'Resultados acumulados', type: 'EQUITY', parentCode: '3000' },
  { code: '3300', name: 'Fondo de reserva', type: 'EQUITY', parentCode: '3000' },
  { code: '4000', name: 'Ingresos', type: 'INCOME' },
  { code: '4100', name: 'Cuotas de mantenimiento', type: 'INCOME', parentCode: '4000' },
  { code: '4200', name: 'Alquiler de amenidades', type: 'INCOME', parentCode: '4000' },
  { code: '4300', name: 'Servicios brindados', type: 'INCOME', parentCode: '4000' },
  { code: '4400', name: 'Multas y recargos', type: 'INCOME', parentCode: '4000' },
  { code: '4500', name: 'Membresías y entradas', type: 'INCOME', parentCode: '4000' },
  { code: '4900', name: 'Otros ingresos', type: 'INCOME', parentCode: '4000' },
  { code: '5000', name: 'Gastos', type: 'EXPENSE' },
  { code: '5100', name: 'Planilla y prestaciones', type: 'EXPENSE', parentCode: '5000' },
  { code: '5200', name: 'Servicios públicos (agua, energía)', type: 'EXPENSE', parentCode: '5000' },
  { code: '5300', name: 'Mantenimiento y reparaciones', type: 'EXPENSE', parentCode: '5000' },
  { code: '5400', name: 'Seguridad y vigilancia', type: 'EXPENSE', parentCode: '5000' },
  { code: '5500', name: 'Limpieza y jardinería', type: 'EXPENSE', parentCode: '5000' },
  { code: '5600', name: 'Gastos administrativos', type: 'EXPENSE', parentCode: '5000' },
  { code: '5700', name: 'Costo de servicios brindados', type: 'EXPENSE', parentCode: '5000' },
  { code: '5800', name: 'Seguros e impuestos', type: 'EXPENSE', parentCode: '5000' },
  { code: '5900', name: 'Otros gastos', type: 'EXPENSE', parentCode: '5000' },
];

/** Las cuentas "título" (x000) agrupan; no reciben movimientos. */
export const isGroupAccount = (code: string) => /^\d000$/.test(code);
