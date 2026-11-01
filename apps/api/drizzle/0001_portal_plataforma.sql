CREATE TYPE "public"."member_status" AS ENUM('ACTIVE', 'PENDING', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('ABIERTO', 'EN_PROCESO', 'RESUELTO', 'CERRADO');--> statement-breakpoint
CREATE TYPE "public"."ticket_type" AS ENUM('CONSULTA', 'RECLAMO', 'SUGERENCIA');--> statement-breakpoint
ALTER TYPE "public"."member_role" ADD VALUE 'RESIDENT';--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"complex_id" uuid NOT NULL,
	"title" varchar(160) NOT NULL,
	"body" text NOT NULL,
	"category" varchar(30) DEFAULT 'AVISO' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"complex_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"complex_id" uuid NOT NULL,
	"unit_id" uuid,
	"created_by" uuid NOT NULL,
	"type" "ticket_type" DEFAULT 'CONSULTA' NOT NULL,
	"subject" varchar(160) NOT NULL,
	"description" text NOT NULL,
	"status" "ticket_status" DEFAULT 'ABIERTO' NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employees" DROP CONSTRAINT "employees_complex_id_complexes_id_fk";
--> statement-breakpoint
DROP INDEX "emp_complex_idx";--> statement-breakpoint
ALTER TABLE "complexes" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "status" "member_status" DEFAULT 'ACTIVE' NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "unit_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "username" varchar(60);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_super_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_complex_id_complexes_id_fk" FOREIGN KEY ("complex_id") REFERENCES "public"."complexes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_assignments" ADD CONSTRAINT "employee_assignments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_assignments" ADD CONSTRAINT "employee_assignments_complex_id_complexes_id_fk" FOREIGN KEY ("complex_id") REFERENCES "public"."complexes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_complex_id_complexes_id_fk" FOREIGN KEY ("complex_id") REFERENCES "public"."complexes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ann_complex_idx" ON "announcements" USING btree ("complex_id","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "emp_assign_uq" ON "employee_assignments" USING btree ("employee_id","complex_id");--> statement-breakpoint
CREATE INDEX "emp_assign_complex_idx" ON "employee_assignments" USING btree ("complex_id");--> statement-breakpoint
CREATE INDEX "ticket_msg_idx" ON "ticket_messages" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "tickets_complex_idx" ON "tickets" USING btree ("complex_id","status");--> statement-breakpoint
CREATE INDEX "tickets_creator_idx" ON "tickets" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_uq" ON "users" USING btree ("username");--> statement-breakpoint
ALTER TABLE "employees" DROP COLUMN "complex_id";