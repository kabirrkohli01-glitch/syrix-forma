ALTER TABLE "employees" ADD COLUMN "ai_language" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "ai_hub_access" boolean DEFAULT true NOT NULL;