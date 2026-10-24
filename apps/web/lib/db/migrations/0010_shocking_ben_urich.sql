CREATE TABLE "calendar_event_attendees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_event_attendees_event_employee_unique" UNIQUE("event_id","employee_id")
);
--> statement-breakpoint
CREATE TABLE "calendar_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"location" text,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"team" text NOT NULL,
	"created_by_employee_id" uuid,
	"client_id" uuid,
	"project_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calendar_event_attendees" ADD CONSTRAINT "calendar_event_attendees_event_id_calendar_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_attendees" ADD CONSTRAINT "calendar_event_attendees_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_created_by_employee_id_employees_id_fk" FOREIGN KEY ("created_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_event_attendees_event_id_idx" ON "calendar_event_attendees" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "calendar_event_attendees_employee_id_idx" ON "calendar_event_attendees" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "calendar_events_start_at_idx" ON "calendar_events" USING btree ("start_at");--> statement-breakpoint
CREATE INDEX "calendar_events_team_idx" ON "calendar_events" USING btree ("team");--> statement-breakpoint
CREATE INDEX "calendar_events_client_id_idx" ON "calendar_events" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "calendar_events_project_id_idx" ON "calendar_events" USING btree ("project_id");