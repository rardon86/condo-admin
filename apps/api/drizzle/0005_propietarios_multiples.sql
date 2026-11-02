CREATE TABLE "unit_owners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"complex_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "unit_owners" ADD CONSTRAINT "unit_owners_complex_id_complexes_id_fk" FOREIGN KEY ("complex_id") REFERENCES "public"."complexes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_owners" ADD CONSTRAINT "unit_owners_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_owners" ADD CONSTRAINT "unit_owners_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "unit_owners_uq" ON "unit_owners" USING btree ("unit_id","user_id");--> statement-breakpoint
CREATE INDEX "unit_owners_user_idx" ON "unit_owners" USING btree ("complex_id","user_id");--> statement-breakpoint
-- Vínculos existentes: dueño registrado de la propiedad y propiedad asignada en el acceso del propietario.
-- (Enums comparados como texto: en una BD nueva sus valores se agregan en esta misma transacción.)
INSERT INTO "unit_owners" ("complex_id", "unit_id", "user_id")
SELECT u."complex_id", u."id", u."owner_user_id" FROM "units" u WHERE u."owner_user_id" IS NOT NULL
UNION
SELECT m."complex_id", m."unit_id", m."user_id" FROM "memberships" m
WHERE m."unit_id" IS NOT NULL AND m."role"::text = 'RESIDENT' AND m."status"::text = 'ACTIVE'
ON CONFLICT DO NOTHING;
