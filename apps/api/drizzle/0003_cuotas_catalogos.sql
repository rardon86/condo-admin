CREATE TYPE "public"."charge_kind" AS ENUM('CUOTA', 'EXTRAORDINARIA', 'RECARGO', 'OTRO');--> statement-breakpoint
CREATE TYPE "public"."late_fee_type" AS ENUM('NONE', 'FIXED', 'PERCENT');--> statement-breakpoint
CREATE TABLE "catalog_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"complex_id" uuid NOT NULL,
	"catalog" varchar(30) NOT NULL,
	"code" varchar(30) NOT NULL,
	"name" varchar(100) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"complex_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"kind" charge_kind NOT NULL,
	"account_id" uuid NOT NULL,
	"period" varchar(7),
	"description" text NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"parent_charge_id" uuid,
	"journal_entry_id" uuid,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"complex_id" uuid NOT NULL,
	"charge_id" uuid NOT NULL,
	"movement_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"applied_at" date NOT NULL,
	"journal_entry_id" uuid,
	"voided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "complexes" ADD COLUMN "fee_due_day" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "complexes" ADD COLUMN "auto_generate_fees" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "complexes" ADD COLUMN "late_fee_type" "late_fee_type" DEFAULT 'NONE' NOT NULL;--> statement-breakpoint
ALTER TABLE "complexes" ADD COLUMN "late_fee_value" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "complexes" ADD COLUMN "late_fee_grace_days" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "movements" ADD COLUMN "receipt_number" varchar(40);--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_complex_id_complexes_id_fk" FOREIGN KEY ("complex_id") REFERENCES "public"."complexes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_complex_id_complexes_id_fk" FOREIGN KEY ("complex_id") REFERENCES "public"."complexes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_complex_id_complexes_id_fk" FOREIGN KEY ("complex_id") REFERENCES "public"."complexes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_charge_id_charges_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."charges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_movement_id_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_items_uq" ON "catalog_items" USING btree ("complex_id","catalog","code");--> statement-breakpoint
CREATE INDEX "charges_unit_idx" ON "charges" USING btree ("complex_id","unit_id","due_date");--> statement-breakpoint
CREATE INDEX "charges_period_idx" ON "charges" USING btree ("complex_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "charges_monthly_uq" ON "charges" USING btree ("complex_id","unit_id","period") WHERE "charges"."kind" = 'CUOTA' and "charges"."voided_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "charges_late_fee_uq" ON "charges" USING btree ("parent_charge_id") WHERE "charges"."kind" = 'RECARGO' and "charges"."voided_at" is null;--> statement-breakpoint
CREATE INDEX "alloc_charge_idx" ON "payment_allocations" USING btree ("charge_id");--> statement-breakpoint
CREATE INDEX "alloc_movement_idx" ON "payment_allocations" USING btree ("movement_id");--> statement-breakpoint
CREATE INDEX "mov_unit_idx" ON "movements" USING btree ("complex_id","unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mov_receipt_uq" ON "movements" USING btree ("complex_id","receipt_number") WHERE "movements"."kind" = 'INCOME' and "movements"."voided_at" is null and "movements"."receipt_number" is not null;--> statement-breakpoint
-- Catálogos iniciales para los proyectos existentes (los nuevos los reciben al crearse)
INSERT INTO "catalog_items" ("complex_id", "catalog", "code", "name", "sort_order")
SELECT c."id", v.catalog, v.code, v.name, v.ord
FROM "complexes" c
CROSS JOIN (VALUES
  ('PROPERTY_TYPE', 'HOUSE', 'Casa', 1),
  ('PROPERTY_TYPE', 'APARTMENT', 'Apartamento', 2),
  ('PROPERTY_TYPE', 'LOT', 'Lote', 3),
  ('PROPERTY_TYPE', 'COMMERCIAL', 'Local comercial', 4),
  ('PROPERTY_TYPE', 'OTHER', 'Otro', 5),
  ('NEWS_CATEGORY', 'AVISO', 'Aviso', 1),
  ('NEWS_CATEGORY', 'MANTENIMIENTO', 'Mantenimiento', 2),
  ('NEWS_CATEGORY', 'ASAMBLEA', 'Asamblea', 3),
  ('NEWS_CATEGORY', 'SEGURIDAD', 'Seguridad', 4),
  ('NEWS_CATEGORY', 'EVENTO', 'Evento', 5),
  ('NEWS_CATEGORY', 'FINANZAS', 'Finanzas', 6)
) AS v(catalog, code, name, ord)
ON CONFLICT DO NOTHING;
