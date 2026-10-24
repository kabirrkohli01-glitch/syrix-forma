CREATE TYPE "public"."clock_event_type" AS ENUM('in', 'out', 'break_start', 'break_end');--> statement-breakpoint
CREATE TYPE "public"."expense_claim_status" AS ENUM('draft', 'submitted', 'approved', 'rejected', 'paid');--> statement-breakpoint
CREATE TYPE "public"."shift_swap_status" AS ENUM('pending', 'accepted', 'declined', 'cancelled', 'approved');--> statement-breakpoint
CREATE TYPE "public"."timesheet_status" AS ENUM('open', 'submitted', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "clock_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"event_type" "clock_event_type" NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"corrected_by_employee_id" uuid,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "expense_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"warn_over_pence" integer,
	"block_over_pence" integer,
	"is_mileage" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "expense_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" "expense_claim_status" DEFAULT 'draft' NOT NULL,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"total_pence" integer DEFAULT 0 NOT NULL,
	"submitted_at" timestamp with time zone,
	"decided_by_employee_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"category_id" uuid,
	"description" text NOT NULL,
	"spent_on" date NOT NULL,
	"amount_pence" integer NOT NULL,
	"miles" integer,
	"pence_per_mile_used" integer,
	"receipt_storage_key" text,
	"receipt_file_name" text,
	"client_id" uuid,
	"project_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mileage_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_type" text DEFAULT 'car' NOT NULL,
	"from_miles" integer DEFAULT 0 NOT NULL,
	"pence_per_mile" integer NOT NULL,
	"effective_from" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mileage_rates_band_unique" UNIQUE("vehicle_type","from_miles","effective_from")
);
--> statement-breakpoint
CREATE TABLE "pay_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"name" text NOT NULL,
	"amount_pence" integer NOT NULL,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"effective_from" date NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift_swap_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shift_id" uuid NOT NULL,
	"requested_by_employee_id" uuid NOT NULL,
	"offered_to_employee_id" uuid,
	"status" "shift_swap_status" DEFAULT 'pending' NOT NULL,
	"accepted_by_employee_id" uuid,
	"approved_by_employee_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL,
	"unpaid_break_minutes" integer DEFAULT 0 NOT NULL,
	"colour" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"on_date" date NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL,
	"unpaid_break_minutes" integer DEFAULT 0 NOT NULL,
	"template_name" text,
	"notes" text,
	"published_at" timestamp with time zone,
	"created_by_employee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timesheet_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"timesheet_id" uuid NOT NULL,
	"on_date" date NOT NULL,
	"minutes" integer NOT NULL,
	"project_id" uuid,
	"client_id" uuid,
	"is_billable" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timesheets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"status" timesheet_status DEFAULT 'open' NOT NULL,
	"submitted_at" timestamp with time zone,
	"decided_by_employee_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timesheets_employee_week_unique" UNIQUE("employee_id","week_start")
);
--> statement-breakpoint
ALTER TABLE "clock_events" ADD CONSTRAINT "clock_events_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clock_events" ADD CONSTRAINT "clock_events_corrected_by_employee_id_employees_id_fk" FOREIGN KEY ("corrected_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_decided_by_employee_id_employees_id_fk" FOREIGN KEY ("decided_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_items" ADD CONSTRAINT "expense_items_claim_id_expense_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."expense_claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_items" ADD CONSTRAINT "expense_items_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_items" ADD CONSTRAINT "expense_items_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_items" ADD CONSTRAINT "expense_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_rates" ADD CONSTRAINT "pay_rates_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_requested_by_employee_id_employees_id_fk" FOREIGN KEY ("requested_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_offered_to_employee_id_employees_id_fk" FOREIGN KEY ("offered_to_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_accepted_by_employee_id_employees_id_fk" FOREIGN KEY ("accepted_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_approved_by_employee_id_employees_id_fk" FOREIGN KEY ("approved_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_created_by_employee_id_employees_id_fk" FOREIGN KEY ("created_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_entries" ADD CONSTRAINT "timesheet_entries_timesheet_id_timesheets_id_fk" FOREIGN KEY ("timesheet_id") REFERENCES "public"."timesheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_entries" ADD CONSTRAINT "timesheet_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_entries" ADD CONSTRAINT "timesheet_entries_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_decided_by_employee_id_employees_id_fk" FOREIGN KEY ("decided_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clock_events_employee_occurred_idx" ON "clock_events" USING btree ("employee_id","occurred_at");--> statement-breakpoint
CREATE INDEX "expense_claims_employee_id_idx" ON "expense_claims" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "expense_claims_status_idx" ON "expense_claims" USING btree ("status");--> statement-breakpoint
CREATE INDEX "expense_items_claim_id_idx" ON "expense_items" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "pay_rates_employee_id_idx" ON "pay_rates" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "shift_swap_requests_shift_id_idx" ON "shift_swap_requests" USING btree ("shift_id");--> statement-breakpoint
CREATE INDEX "shifts_employee_id_idx" ON "shifts" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "shifts_on_date_idx" ON "shifts" USING btree ("on_date");--> statement-breakpoint
CREATE INDEX "timesheet_entries_timesheet_id_idx" ON "timesheet_entries" USING btree ("timesheet_id");--> statement-breakpoint
CREATE INDEX "timesheet_entries_project_id_idx" ON "timesheet_entries" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "timesheets_employee_id_idx" ON "timesheets" USING btree ("employee_id");