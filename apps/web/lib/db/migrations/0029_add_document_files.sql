CREATE TABLE "document_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"team" text NOT NULL,
	"client_id" uuid,
	"project_id" uuid,
	"task_id" uuid,
	"uploaded_by_employee_id" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_uploaded_by_employee_id_employees_id_fk" FOREIGN KEY ("uploaded_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_files_team_idx" ON "document_files" USING btree ("team");--> statement-breakpoint
CREATE INDEX "document_files_client_id_idx" ON "document_files" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "document_files_project_id_idx" ON "document_files" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "document_files_task_id_idx" ON "document_files" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "document_files_created_at_idx" ON "document_files" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "document_links_created_at_idx" ON "document_links" USING btree ("created_at");