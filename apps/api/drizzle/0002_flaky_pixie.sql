ALTER TABLE "complexes" ADD COLUMN "logo" text;--> statement-breakpoint
ALTER TABLE "complexes" ADD COLUMN "logo_mime" varchar(20);--> statement-breakpoint
ALTER TABLE "complexes" ADD COLUMN "logo_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "failed_logins" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locked_until" timestamp with time zone;