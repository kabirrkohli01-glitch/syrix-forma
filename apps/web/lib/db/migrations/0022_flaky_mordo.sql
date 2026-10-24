CREATE TYPE "public"."leave_request_status" AS ENUM('pending', 'approved', 'declined', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."leave_day_unit" AS ENUM('full', 'am', 'pm');--> statement-breakpoint
CREATE TABLE "absence_trigger_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"singleton" boolean DEFAULT true NOT NULL,
	"bradford_threshold" integer DEFAULT 125 NOT NULL,
	"rolling_window_days" integer DEFAULT 365 NOT NULL,
	"occurrence_threshold" integer DEFAULT 4 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "absence_trigger_settings_singleton_unique" UNIQUE("singleton")
);
--> statement-breakpoint
CREATE TABLE "leave_allowances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_year_start" date NOT NULL,
	"entitlement_half_days" integer NOT NULL,
	"carried_over_half_days" integer DEFAULT 0 NOT NULL,
	"adjustment_half_days" integer DEFAULT 0 NOT NULL,
	"adjustment_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_allowances_employee_year_unique" UNIQUE("employee_id","leave_year_start")
);
--> statement-breakpoint
CREATE TABLE "leave_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"start_unit" "leave_day_unit" DEFAULT 'full' NOT NULL,
	"end_unit" "leave_day_unit" DEFAULT 'full' NOT NULL,
	"total_half_days" integer NOT NULL,
	"status" "leave_request_status" DEFAULT 'pending' NOT NULL,
	"reason" text,
	"decided_by_employee_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"auto_approved" boolean DEFAULT false NOT NULL,
	"calendar_event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"singleton" boolean DEFAULT true NOT NULL,
	"leave_year_start_month" integer DEFAULT 1 NOT NULL,
	"leave_year_start_day" integer DEFAULT 1 NOT NULL,
	"default_entitlement_half_days" integer DEFAULT 50 NOT NULL,
	"carry_over_max_half_days" integer DEFAULT 10 NOT NULL,
	"carry_over_expiry_months" integer DEFAULT 3 NOT NULL,
	"allow_negative_balance" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_settings_singleton_unique" UNIQUE("singleton")
);
--> statement-breakpoint
CREATE TABLE "leave_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"deducts_from_allowance" boolean DEFAULT true NOT NULL,
	"is_paid" boolean DEFAULT true NOT NULL,
	"requires_approval" boolean DEFAULT true NOT NULL,
	"colour" text,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_types_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "public_holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"region" text DEFAULT 'England and Wales' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "public_holidays_date_region_unique" UNIQUE("date","region")
);
--> statement-breakpoint
CREATE TABLE "return_to_work_interviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sickness_record_id" uuid NOT NULL,
	"conducted_by_employee_id" uuid,
	"conducted_on" date NOT NULL,
	"notes" text,
	"adjustments_agreed" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "return_to_work_sickness_record_unique" UNIQUE("sickness_record_id")
);
--> statement-breakpoint
CREATE TABLE "sickness_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"total_half_days" integer,
	"category" text,
	"notes" text,
	"is_self_certified" boolean DEFAULT true NOT NULL,
	"fit_note_storage_key" text,
	"fit_note_file_name" text,
	"recorded_by_employee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leave_allowances" ADD CONSTRAINT "leave_allowances_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_decided_by_employee_id_employees_id_fk" FOREIGN KEY ("decided_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_calendar_event_id_calendar_events_id_fk" FOREIGN KEY ("calendar_event_id") REFERENCES "public"."calendar_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_to_work_interviews" ADD CONSTRAINT "return_to_work_interviews_sickness_record_id_sickness_records_id_fk" FOREIGN KEY ("sickness_record_id") REFERENCES "public"."sickness_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_to_work_interviews" ADD CONSTRAINT "return_to_work_interviews_conducted_by_employee_id_employees_id_fk" FOREIGN KEY ("conducted_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickness_records" ADD CONSTRAINT "sickness_records_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickness_records" ADD CONSTRAINT "sickness_records_recorded_by_employee_id_employees_id_fk" FOREIGN KEY ("recorded_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leave_allowances_employee_id_idx" ON "leave_allowances" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "leave_requests_employee_id_idx" ON "leave_requests" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "leave_requests_status_idx" ON "leave_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "leave_requests_start_date_idx" ON "leave_requests" USING btree ("start_date");--> statement-breakpoint
CREATE INDEX "leave_requests_end_date_idx" ON "leave_requests" USING btree ("end_date");--> statement-breakpoint
CREATE INDEX "public_holidays_date_idx" ON "public_holidays" USING btree ("date");--> statement-breakpoint
CREATE INDEX "sickness_records_employee_id_idx" ON "sickness_records" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "sickness_records_start_date_idx" ON "sickness_records" USING btree ("start_date");