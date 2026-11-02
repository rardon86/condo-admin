ALTER TABLE "units" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- (Comparación como texto: en una BD nueva el valor RESIDENT se agrega en la 0001 dentro de la misma transacción)
-- Vincula las propiedades con el propietario aprobado que ya las tiene asignada en el portal
UPDATE "units" u SET "owner_user_id" = m."user_id"
FROM "memberships" m
WHERE m."unit_id" = u."id" AND m."role"::text = 'RESIDENT' AND m."status"::text = 'ACTIVE' AND u."owner_user_id" IS NULL;
