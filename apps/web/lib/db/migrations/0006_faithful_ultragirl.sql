CREATE TYPE "public"."document_link_check_status" AS ENUM('unknown', 'ok', 'broken');--> statement-breakpoint
CREATE TYPE "public"."document_link_system" AS ENUM('sharepoint', 'onedrive', 'nas', 'other');--> statement-breakpoint
CREATE TYPE "public"."email_activity_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."integration_status" AS ENUM('not_configured', 'connected', 'error');--> statement-breakpoint
CREATE TABLE "dead_letter_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"payload" jsonb,
	"error" text NOT NULL,
	"failed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_employee_id" uuid
);
--> statement-breakpoint
CREATE TABLE "document_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"url" text NOT NULL,
	"system" "document_link_system" NOT NULL,
	"client_id" uuid,
	"project_id" uuid,
	"added_by_employee_id" uuid NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_check_status" "document_link_check_status" DEFAULT 'unknown' NOT NULL,
	"last_check_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"direction" "email_activity_direction" NOT NULL,
	"external_message_id" text NOT NULL,
	"mailbox_resource_id" text NOT NULL,
	"from_address" text NOT NULL,
	"to_addresses" jsonb NOT NULL,
	"subject" text,
	"snippet" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"enquiry_id" uuid,
	"client_id" uuid,
	"project_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_activity_mailbox_external_message_unique" UNIQUE("mailbox_resource_id","external_message_id")
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"status" "integration_status" DEFAULT 'not_configured' NOT NULL,
	"owner_employee_id" uuid,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"config" jsonb,
	"credentials_encrypted" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integrations_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "dead_letter_jobs" ADD CONSTRAINT "dead_letter_jobs_resolved_by_employee_id_employees_id_fk" FOREIGN KEY ("resolved_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_added_by_employee_id_employees_id_fk" FOREIGN KEY ("added_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_activity" ADD CONSTRAINT "email_activity_enquiry_id_enquiries_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "public"."enquiries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_activity" ADD CONSTRAINT "email_activity_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_activity" ADD CONSTRAINT "email_activity_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_owner_employee_id_employees_id_fk" FOREIGN KEY ("owner_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dead_letter_jobs_source_idx" ON "dead_letter_jobs" USING btree ("source");--> statement-breakpoint
CREATE INDEX "dead_letter_jobs_resolved_at_idx" ON "dead_letter_jobs" USING btree ("resolved_at");--> statement-breakpoint
CREATE INDEX "document_links_client_id_idx" ON "document_links" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "document_links_project_id_idx" ON "document_links" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "email_activity_enquiry_id_idx" ON "email_activity" USING btree ("enquiry_id");--> statement-breakpoint
CREATE INDEX "email_activity_client_id_idx" ON "email_activity" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "email_activity_project_id_idx" ON "email_activity" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "email_activity_occurred_at_idx" ON "email_activity" USING btree ("occurred_at");