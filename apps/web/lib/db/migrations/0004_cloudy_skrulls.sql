CREATE TYPE "public"."automation_run_status" AS ENUM('queued', 'running', 'success', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."enquiry_source" AS ENUM('manual', 'email');--> statement-breakpoint
CREATE TYPE "public"."enquiry_status" AS ENUM('new', 'in_progress', 'awaiting_response', 'responded', 'closed');--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"automation_id" uuid NOT NULL,
	"status" "automation_run_status" DEFAULT 'queued' NOT NULL,
	"trigger_resource_type" text,
	"trigger_resource_id" text,
	"error" text,
	"result" jsonb,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_settings" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"kill_switch_enabled" boolean DEFAULT true NOT NULL,
	"updated_by_employee_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"trigger_event" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"owner_employee_id" uuid,
	"config" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automations_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "enquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "enquiry_source" DEFAULT 'manual' NOT NULL,
	"contact_name" text NOT NULL,
	"contact_email" text NOT NULL,
	"message" text,
	"team" text NOT NULL,
	"status" "enquiry_status" DEFAULT 'new' NOT NULL,
	"client_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "last_reminder_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_settings" ADD CONSTRAINT "automation_settings_updated_by_employee_id_employees_id_fk" FOREIGN KEY ("updated_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_owner_employee_id_employees_id_fk" FOREIGN KEY ("owner_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_created_by_employees_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_runs_automation_id_idx" ON "automation_runs" USING btree ("automation_id");--> statement-breakpoint
CREATE INDEX "automation_runs_status_idx" ON "automation_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "automation_runs_created_at_idx" ON "automation_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "enquiries_team_idx" ON "enquiries" USING btree ("team");--> statement-breakpoint
CREATE INDEX "enquiries_status_idx" ON "enquiries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "notifications_employee_id_idx" ON "notifications" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "notifications_read_at_idx" ON "notifications" USING btree ("read_at");--> statement-breakpoint
INSERT INTO "automation_settings" ("id", "kill_switch_enabled") VALUES ('singleton', true) ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
INSERT INTO "automations" ("key", "name", "description", "trigger_event", "config") VALUES
	('new-enquiry', 'New enquiry', 'Creates a work item and notifies the creator when a new enquiry comes in.', 'ENQUIRY_CREATED', '{}'),
	('no-response-follow-up', 'No-response follow-up', 'Follows up on an enquiry left awaiting a response for too long.', 'ENQUIRY_AWAITING_RESPONSE', '{"followUpAfterDays": 3}')
ON CONFLICT ("key") DO NOTHING;