ALTER TABLE "employees" ADD COLUMN "mfa_secret_encrypted" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "mfa_enabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "mfa_failed_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "mfa_locked_until" timestamp with time zone;