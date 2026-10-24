ALTER TABLE "employees" ADD COLUMN "lockout_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "lockout_count_reset_at" timestamp with time zone;