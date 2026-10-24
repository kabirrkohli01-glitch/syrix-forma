CREATE TYPE "public"."connector_kind" AS ENUM('mcp', 'http_api');--> statement-breakpoint
CREATE TYPE "public"."connector_status" AS ENUM('unverified', 'connected', 'error');--> statement-breakpoint
CREATE TABLE "connectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "connector_kind" NOT NULL,
	"name" text NOT NULL,
	"catalogue_key" text,
	"base_url" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"status" "connector_status" DEFAULT 'unverified' NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_error" text,
	"config" jsonb,
	"credentials_encrypted" text,
	"created_by_employee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connectors_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "connectors" ADD CONSTRAINT "connectors_created_by_employee_id_employees_id_fk" FOREIGN KEY ("created_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connectors_catalogue_key_idx" ON "connectors" USING btree ("catalogue_key");