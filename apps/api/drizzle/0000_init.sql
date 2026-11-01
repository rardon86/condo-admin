CREATE TYPE "public"."account_type" AS ENUM('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');--> statement-breakpoint
CREATE TYPE "public"."clock_type" AS ENUM('IN', 'OUT');--> statement-breakpoint
CREATE TYPE "public"."complex_type" AS ENUM('RESIDENTIAL', 'RECREATIONAL', 'MIXED');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('OWNER', 'ADMIN', 'ACCOUNTANT', 'STAFF', 'VIEWER');--> statement-breakpoint
CREATE TYPE "public"."movement_kind" AS ENUM('INCOME', 'EXPENSE');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('CASH', 'TRANSFER', 'CARD', 'CHECK', 'OTHER');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"complex_id" uuid NOT NULL,
	"code" varchar(20) NOT NULL,
	"name" varchar(120) NOT NULL,
	"type" "account_type" NOT NULL,
	"parent_code" varchar(20),
	"is_system" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"complex_id" uuid,
	"user_id" uuid,
	"action" varchar(40) NOT NULL,
	"entity" varchar(40) NOT NULL,
	"entity_id" uuid,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "complexes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(150) NOT NULL,
	"type" "complex_type" DEFAULT 'RESIDENTIAL' NOT NULL,
	"address" text,
	"tax_id" varchar(30),
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"timezone" varchar(64) DEFAULT 'America/El_Salvador' NOT NULL,
	"opening_balance" numeric(14, 2) DEFAULT '0' NOT NULL,
	"opening_balance_date" date,
	"require_geofence" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"complex_id" uuid NOT NULL,
	"user_id" uuid,
	"full_name" varchar(150) NOT NULL,
	"document_id" varchar(30),
	"position" varchar(80),
	"phone" varchar(30),
	"hourly_rate" numeric(14, 2) DEFAULT '0' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "geofences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"complex_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"radius_meters" integer DEFAULT 100 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"complex_id" uuid NOT NULL,
	"date" date NOT NULL,
	"description" text NOT NULL,
	"source_type" varchar(20) NOT NULL,
	"source_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"complex_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"debit" numeric(14, 2) DEFAULT '0' NOT NULL,
	"credit" numeric(14, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"complex_id" uuid NOT NULL,
	"role" "member_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"complex_id" uuid NOT NULL,
	"kind" "movement_kind" NOT NULL,
	"date" date NOT NULL,
	"account_id" uuid NOT NULL,
	"unit_id" uuid,
	"counterparty" varchar(150),
	"amount" numeric(14, 2) NOT NULL,
	"method" "payment_method" DEFAULT 'TRANSFER' NOT NULL,
	"reference" varchar(80),
	"description" text,
	"receipt_url" text,
	"service_record_id" uuid,
	"journal_entry_id" uuid,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"complex_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"date" date NOT NULL,
	"unit_id" uuid,
	"employee_id" uuid,
	"provided_by" varchar(150),
	"quantity" numeric(10, 2) DEFAULT '1' NOT NULL,
	"unit_cost" numeric(14, 2) NOT NULL,
	"unit_price" numeric(14, 2) NOT NULL,
	"total_cost" numeric(14, 2) NOT NULL,
	"total_price" numeric(14, 2) NOT NULL,
	"notes" text,
	"income_movement_id" uuid,
	"cost_movement_id" uuid,
	"voided_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"complex_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"category" varchar(60),
	"unit_label" varchar(30) DEFAULT 'servicio' NOT NULL,
	"unit_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"unit_price" numeric(14, 2) DEFAULT '0' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"complex_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"type" "clock_type" NOT NULL,
	"server_time" timestamp with time zone DEFAULT now() NOT NULL,
	"device_time" timestamp with time zone,
	"latitude" double precision,
	"longitude" double precision,
	"accuracy_meters" double precision,
	"geofence_id" uuid,
	"distance_meters" double precision,
	"within_geofence" boolean,
	"manual" boolean DEFAULT false NOT NULL,
	"recorded_by" uuid,
	"ip" varchar(64),
	"user_agent" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"complex_id" uuid NOT NULL,
	"code" varchar(30) NOT NULL,
	"type" varchar(30) DEFAULT 'HOUSE' NOT NULL,
	"owner_name" varchar(150),
	"owner_email" varchar(255),
	"owner_phone" varchar(30),
	"area_m2" numeric(10, 2),
	"monthly_fee" numeric(14, 2) DEFAULT '0' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" varchar(150) NOT NULL,
	"phone" varchar(30),
	"token_version" integer DEFAULT 0 NOT NULL,
	"email_verified_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_complex_id_complexes_id_fk" FOREIGN KEY ("complex_id") REFERENCES "public"."complexes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_complex_id_complexes_id_fk" FOREIGN KEY ("complex_id") REFERENCES "public"."complexes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_complex_id_complexes_id_fk" FOREIGN KEY ("complex_id") REFERENCES "public"."complexes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geofences" ADD CONSTRAINT "geofences_complex_id_complexes_id_fk" FOREIGN KEY ("complex_id") REFERENCES "public"."complexes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_complex_id_complexes_id_fk" FOREIGN KEY ("complex_id") REFERENCES "public"."complexes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_complex_id_complexes_id_fk" FOREIGN KEY ("complex_id") REFERENCES "public"."complexes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_complex_id_complexes_id_fk" FOREIGN KEY ("complex_id") REFERENCES "public"."complexes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movements" ADD CONSTRAINT "movements_complex_id_complexes_id_fk" FOREIGN KEY ("complex_id") REFERENCES "public"."complexes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movements" ADD CONSTRAINT "movements_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movements" ADD CONSTRAINT "movements_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movements" ADD CONSTRAINT "movements_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movements" ADD CONSTRAINT "movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_records" ADD CONSTRAINT "service_records_complex_id_complexes_id_fk" FOREIGN KEY ("complex_id") REFERENCES "public"."complexes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_records" ADD CONSTRAINT "service_records_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_records" ADD CONSTRAINT "service_records_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_records" ADD CONSTRAINT "service_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_complex_id_complexes_id_fk" FOREIGN KEY ("complex_id") REFERENCES "public"."complexes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_complex_id_complexes_id_fk" FOREIGN KEY ("complex_id") REFERENCES "public"."complexes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_geofence_id_geofences_id_fk" FOREIGN KEY ("geofence_id") REFERENCES "public"."geofences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_complex_id_complexes_id_fk" FOREIGN KEY ("complex_id") REFERENCES "public"."complexes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_complex_code_uq" ON "accounts" USING btree ("complex_id","code");--> statement-breakpoint
CREATE INDEX "audit_complex_idx" ON "audit_logs" USING btree ("complex_id","created_at");--> statement-breakpoint
CREATE INDEX "emp_complex_idx" ON "employees" USING btree ("complex_id");--> statement-breakpoint
CREATE INDEX "je_complex_date_idx" ON "journal_entries" USING btree ("complex_id","date");--> statement-breakpoint
CREATE INDEX "jl_complex_account_idx" ON "journal_lines" USING btree ("complex_id","account_id");--> statement-breakpoint
CREATE INDEX "jl_entry_idx" ON "journal_lines" USING btree ("entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_user_complex_uq" ON "memberships" USING btree ("user_id","complex_id");--> statement-breakpoint
CREATE INDEX "mov_complex_kind_date_idx" ON "movements" USING btree ("complex_id","kind","date");--> statement-breakpoint
CREATE INDEX "sr_complex_date_idx" ON "service_records" USING btree ("complex_id","date");--> statement-breakpoint
CREATE INDEX "te_employee_time_idx" ON "time_entries" USING btree ("employee_id","server_time");--> statement-breakpoint
CREATE INDEX "te_complex_time_idx" ON "time_entries" USING btree ("complex_id","server_time");--> statement-breakpoint
CREATE UNIQUE INDEX "units_complex_code_uq" ON "units" USING btree ("complex_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");