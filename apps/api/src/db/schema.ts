/**
 * Modelo de datos — Sistema de administración de complejos residenciales y recreativos.
 *
 * Decisiones clave:
 *  - Multi-tenant por fila: toda tabla de negocio lleva `complex_id`.
 *  - Contabilidad de partida doble (journal_entries / journal_lines). Ingresos, egresos,
 *    servicios y saldo inicial generan asientos; los estados financieros se derivan del libro.
 *  - Montos en NUMERIC(14,2) (nunca float). En código se manejan en centavos enteros.
 *  - Registros financieros no se borran: se ANULAN con asiento de reversión (pista de auditoría).
 *  - Marcación: hora del servidor = autoritativa; hora del dispositivo y GPS se guardan como evidencia.
 */
import {
  pgTable,
  uuid,
  text,
  varchar,
  timestamp,
  numeric,
  integer,
  boolean,
  pgEnum,
  date,
  doublePrecision,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

export const complexType = pgEnum('complex_type', ['RESIDENTIAL', 'RECREATIONAL', 'MIXED']);
/** OWNER se conserva por compatibilidad con datos existentes y equivale a ADMIN. */
export const memberRole = pgEnum('member_role', ['OWNER', 'ADMIN', 'ACCOUNTANT', 'STAFF', 'VIEWER', 'RESIDENT']);
export const memberStatus = pgEnum('member_status', ['ACTIVE', 'PENDING', 'REJECTED']);
export const ticketType = pgEnum('ticket_type', ['CONSULTA', 'RECLAMO', 'SUGERENCIA']);
export const ticketStatus = pgEnum('ticket_status', ['ABIERTO', 'EN_PROCESO', 'RESUELTO', 'CERRADO']);
export const accountType = pgEnum('account_type', ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE']);
export const movementKind = pgEnum('movement_kind', ['INCOME', 'EXPENSE']);
export const paymentMethod = pgEnum('payment_method', ['CASH', 'TRANSFER', 'CARD', 'CHECK', 'OTHER']);
export const clockType = pgEnum('clock_type', ['IN', 'OUT']);

const timestamps = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

const money = (name: string) => numeric(name, { precision: 14, scale: 2 });

// ───────────────────────────── Identidad y tenencia ─────────────────────────────

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull(),
  /** Alternativa al correo para iniciar sesión (p. ej. el superusuario). */
  username: varchar('username', { length: 60 }),
  /** Superusuario de la plataforma: crea proyectos y administra empleados. */
  isSuperAdmin: boolean('is_super_admin').default(false).notNull(),
  passwordHash: text('password_hash').notNull(),
  fullName: varchar('full_name', { length: 150 }).notNull(),
  phone: varchar('phone', { length: 30 }),
  tokenVersion: integer('token_version').default(0).notNull(),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  ...timestamps(),
}, (t) => [uniqueIndex('users_email_uq').on(t.email), uniqueIndex('users_username_uq').on(t.username)]);

export const complexes = pgTable('complexes', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 150 }).notNull(),
  type: complexType('type').default('RESIDENTIAL').notNull(),
  address: text('address'),
  taxId: varchar('tax_id', { length: 30 }),
  currency: varchar('currency', { length: 3 }).default('USD').notNull(),
  timezone: varchar('timezone', { length: 64 }).default('America/El_Salvador').notNull(),
  openingBalance: money('opening_balance').default('0').notNull(),
  openingBalanceDate: date('opening_balance_date'),
  requireGeofence: boolean('require_geofence').default(false).notNull(),
  active: boolean('active').default(true).notNull(),
  ...timestamps(),
});

export const memberships = pgTable('memberships', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  complexId: uuid('complex_id').notNull().references(() => complexes.id, { onDelete: 'cascade' }),
  role: memberRole('role').notNull(),
  /** Los residentes que se registran solos quedan PENDING hasta que el administrador los aprueba. */
  status: memberStatus('status').default('ACTIVE').notNull(),
  /** Unidad del residente (propietario/inquilino). */
  unitId: uuid('unit_id'),
  ...timestamps(),
}, (t) => [uniqueIndex('memberships_user_complex_uq').on(t.userId, t.complexId)]);

// ───────────────────────────── Propiedad ─────────────────────────────

export const units = pgTable('units', {
  id: uuid('id').primaryKey().defaultRandom(),
  complexId: uuid('complex_id').notNull().references(() => complexes.id, { onDelete: 'cascade' }),
  code: varchar('code', { length: 30 }).notNull(),
  type: varchar('type', { length: 30 }).default('HOUSE').notNull(),
  ownerName: varchar('owner_name', { length: 150 }),
  ownerEmail: varchar('owner_email', { length: 255 }),
  ownerPhone: varchar('owner_phone', { length: 30 }),
  areaM2: numeric('area_m2', { precision: 10, scale: 2 }),
  monthlyFee: money('monthly_fee').default('0').notNull(),
  active: boolean('active').default(true).notNull(),
  ...timestamps(),
}, (t) => [uniqueIndex('units_complex_code_uq').on(t.complexId, t.code)]);

// ───────────────────────────── Contabilidad ─────────────────────────────

/** Catálogo de cuentas por complejo. Las categorías de ingreso/egreso son cuentas INCOME/EXPENSE. */
export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  complexId: uuid('complex_id').notNull().references(() => complexes.id, { onDelete: 'cascade' }),
  code: varchar('code', { length: 20 }).notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  type: accountType('type').notNull(),
  parentCode: varchar('parent_code', { length: 20 }),
  isSystem: boolean('is_system').default(false).notNull(),
  active: boolean('active').default(true).notNull(),
  ...timestamps(),
}, (t) => [uniqueIndex('accounts_complex_code_uq').on(t.complexId, t.code)]);

export const journalEntries = pgTable('journal_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  complexId: uuid('complex_id').notNull().references(() => complexes.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  description: text('description').notNull(),
  sourceType: varchar('source_type', { length: 20 }).notNull(), // MOVEMENT | OPENING | REVERSAL
  sourceId: uuid('source_id'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index('je_complex_date_idx').on(t.complexId, t.date)]);

export const journalLines = pgTable('journal_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  entryId: uuid('entry_id').notNull().references(() => journalEntries.id, { onDelete: 'cascade' }),
  complexId: uuid('complex_id').notNull().references(() => complexes.id, { onDelete: 'cascade' }),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  debit: money('debit').default('0').notNull(),
  credit: money('credit').default('0').notNull(),
}, (t) => [index('jl_complex_account_idx').on(t.complexId, t.accountId), index('jl_entry_idx').on(t.entryId)]);

/** Ingresos y egresos (una tabla, diferenciados por `kind`). */
export const movements = pgTable('movements', {
  id: uuid('id').primaryKey().defaultRandom(),
  complexId: uuid('complex_id').notNull().references(() => complexes.id, { onDelete: 'cascade' }),
  kind: movementKind('kind').notNull(),
  date: date('date').notNull(),
  accountId: uuid('account_id').notNull().references(() => accounts.id), // categoría
  unitId: uuid('unit_id').references(() => units.id),
  counterparty: varchar('counterparty', { length: 150 }), // pagador o proveedor
  amount: money('amount').notNull(),
  method: paymentMethod('method').default('TRANSFER').notNull(),
  reference: varchar('reference', { length: 80 }),
  description: text('description'),
  receiptUrl: text('receipt_url'),
  serviceRecordId: uuid('service_record_id'),
  journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
  voidedAt: timestamp('voided_at', { withTimezone: true }),
  voidReason: text('void_reason'),
  createdBy: uuid('created_by').references(() => users.id),
  ...timestamps(),
}, (t) => [index('mov_complex_kind_date_idx').on(t.complexId, t.kind, t.date)]);

// ───────────────────────────── Servicios del complejo ─────────────────────────────

/** Catálogo de servicios (alquiler de salón, mantenimiento piscina, limpieza, etc.) con costo y precio. */
export const services = pgTable('services', {
  id: uuid('id').primaryKey().defaultRandom(),
  complexId: uuid('complex_id').notNull().references(() => complexes.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 120 }).notNull(),
  description: text('description'),
  category: varchar('category', { length: 60 }),
  unitLabel: varchar('unit_label', { length: 30 }).default('servicio').notNull(),
  unitCost: money('unit_cost').default('0').notNull(),
  unitPrice: money('unit_price').default('0').notNull(),
  active: boolean('active').default(true).notNull(),
  ...timestamps(),
});

/** Servicio efectivamente brindado. Congela costo/precio al momento del registro. */
export const serviceRecords = pgTable('service_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  complexId: uuid('complex_id').notNull().references(() => complexes.id, { onDelete: 'cascade' }),
  serviceId: uuid('service_id').notNull().references(() => services.id),
  date: date('date').notNull(),
  unitId: uuid('unit_id').references(() => units.id),
  employeeId: uuid('employee_id'),
  providedBy: varchar('provided_by', { length: 150 }),
  quantity: numeric('quantity', { precision: 10, scale: 2 }).default('1').notNull(),
  unitCost: money('unit_cost').notNull(),
  unitPrice: money('unit_price').notNull(),
  totalCost: money('total_cost').notNull(),
  totalPrice: money('total_price').notNull(),
  notes: text('notes'),
  incomeMovementId: uuid('income_movement_id'),
  costMovementId: uuid('cost_movement_id'),
  voidedAt: timestamp('voided_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => users.id),
  ...timestamps(),
}, (t) => [index('sr_complex_date_idx').on(t.complexId, t.date)]);

// ───────────────────────────── Personal y marcación ─────────────────────────────

/** Registro único de empleados de la plataforma; se asocian a uno o varios proyectos. */
export const employees = pgTable('employees', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id),
  fullName: varchar('full_name', { length: 150 }).notNull(),
  documentId: varchar('document_id', { length: 30 }),
  position: varchar('position', { length: 80 }),
  phone: varchar('phone', { length: 30 }),
  hourlyRate: money('hourly_rate').default('0').notNull(),
  active: boolean('active').default(true).notNull(),
  ...timestamps(),
});

/** Asociación empleado ↔ proyecto (un empleado puede trabajar en varios complejos). */
export const employeeAssignments = pgTable('employee_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  employeeId: uuid('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  complexId: uuid('complex_id').notNull().references(() => complexes.id, { onDelete: 'cascade' }),
  active: boolean('active').default(true).notNull(),
  ...timestamps(),
}, (t) => [uniqueIndex('emp_assign_uq').on(t.employeeId, t.complexId), index('emp_assign_complex_idx').on(t.complexId)]);

/** Zonas válidas de marcación (portería, área social, etc.). */
export const geofences = pgTable('geofences', {
  id: uuid('id').primaryKey().defaultRandom(),
  complexId: uuid('complex_id').notNull().references(() => complexes.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  latitude: doublePrecision('latitude').notNull(),
  longitude: doublePrecision('longitude').notNull(),
  radiusMeters: integer('radius_meters').default(100).notNull(),
  active: boolean('active').default(true).notNull(),
  ...timestamps(),
});

export const timeEntries = pgTable('time_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  complexId: uuid('complex_id').notNull().references(() => complexes.id, { onDelete: 'cascade' }),
  employeeId: uuid('employee_id').notNull().references(() => employees.id),
  type: clockType('type').notNull(),
  serverTime: timestamp('server_time', { withTimezone: true }).defaultNow().notNull(),
  deviceTime: timestamp('device_time', { withTimezone: true }),
  latitude: doublePrecision('latitude'),
  longitude: doublePrecision('longitude'),
  accuracyMeters: doublePrecision('accuracy_meters'),
  geofenceId: uuid('geofence_id').references(() => geofences.id),
  distanceMeters: doublePrecision('distance_meters'),
  withinGeofence: boolean('within_geofence'),
  manual: boolean('manual').default(false).notNull(),
  recordedBy: uuid('recorded_by').references(() => users.id),
  ip: varchar('ip', { length: 64 }),
  userAgent: text('user_agent'),
  notes: text('notes'),
}, (t) => [index('te_employee_time_idx').on(t.employeeId, t.serverTime), index('te_complex_time_idx').on(t.complexId, t.serverTime)]);

// ───────────────────────────── Comunicación con residentes ─────────────────────────────

/** Avisos y noticias del complejo (lo que ven los propietarios en su portal). */
export const announcements = pgTable('announcements', {
  id: uuid('id').primaryKey().defaultRandom(),
  complexId: uuid('complex_id').notNull().references(() => complexes.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 160 }).notNull(),
  body: text('body').notNull(),
  category: varchar('category', { length: 30 }).default('AVISO').notNull(),
  pinned: boolean('pinned').default(false).notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => users.id),
  ...timestamps(),
}, (t) => [index('ann_complex_idx').on(t.complexId, t.publishedAt)]);

/** Consultas, reclamos y sugerencias de los residentes. */
export const tickets = pgTable('tickets', {
  id: uuid('id').primaryKey().defaultRandom(),
  complexId: uuid('complex_id').notNull().references(() => complexes.id, { onDelete: 'cascade' }),
  unitId: uuid('unit_id').references(() => units.id),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  type: ticketType('type').default('CONSULTA').notNull(),
  subject: varchar('subject', { length: 160 }).notNull(),
  description: text('description').notNull(),
  status: ticketStatus('status').default('ABIERTO').notNull(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  ...timestamps(),
}, (t) => [index('tickets_complex_idx').on(t.complexId, t.status), index('tickets_creator_idx').on(t.createdBy)]);

export const ticketMessages = pgTable('ticket_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  ticketId: uuid('ticket_id').notNull().references(() => tickets.id, { onDelete: 'cascade' }),
  authorId: uuid('author_id').notNull().references(() => users.id),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index('ticket_msg_idx').on(t.ticketId, t.createdAt)]);

// ───────────────────────────── Auditoría ─────────────────────────────

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  complexId: uuid('complex_id').references(() => complexes.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id),
  action: varchar('action', { length: 40 }).notNull(),
  entity: varchar('entity', { length: 40 }).notNull(),
  entityId: uuid('entity_id'),
  data: jsonb('data'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index('audit_complex_idx').on(t.complexId, t.createdAt)]);
