CREATE TYPE "public"."employment_contract_type" AS ENUM('permanent', 'fixed_term', 'part_time', 'apprentice', 'contractor', 'intern');--> statement-breakpoint
CREATE TYPE "public"."hr_custom_field_type" AS ENUM('text', 'number', 'date', 'select', 'checkbox');--> statement-breakpoint
CREATE TYPE "public"."pay_frequency" AS ENUM('monthly', 'four_weekly', 'weekly');--> statement-breakpoint
ALTER TYPE "public"."employee_role" ADD VALUE 'HR_ADMIN';--> statement-breakpoint
CREATE TABLE "employee_custom_field_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"field_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"value" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_custom_field_values_field_employee_unique" UNIQUE("field_id","employee_id")
);
--> statement-breakpoint
CREATE TABLE "employee_custom_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"field_type" "hr_custom_field_type" NOT NULL,
	"options" jsonb,
	"visible_to_employee" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_custom_fields_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "employee_pay" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"annual_salary_encrypted" text,
	"hourly_rate_encrypted" text,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"pay_frequency" "pay_frequency",
	"bank_account_name_encrypted" text,
	"bank_sort_code_encrypted" text,
	"bank_account_number_encrypted" text,
	"effective_from" date,
	"updated_by_employee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_pay_employee_id_unique" UNIQUE("employee_id")
);
--> statement-breakpoint
CREATE TABLE "employee_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"date_of_birth" date,
	"national_insurance_encrypted" text,
	"personal_email" text,
	"personal_phone" text,
	"address_line1" text,
	"address_line2" text,
	"address_city" text,
	"address_postcode" text,
	"address_country" text,
	"emergency_contact_name" text,
	"emergency_contact_relationship" text,
	"emergency_contact_phone" text,
	"job_title" text,
	"contract_type" "employment_contract_type",
	"start_date" date,
	"probation_end_date" date,
	"end_date" date,
	"leaving_reason" text,
	"working_days_per_week" integer,
	"working_hours_per_week" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_profiles_employee_id_unique" UNIQUE("employee_id")
);
--> statement-breakpoint
CREATE TABLE "employee_training_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"title" text NOT NULL,
	"provider" text,
	"notes" text,
	"completed_on" date,
	"expires_on" date,
	"reminder_lead_days" integer,
	"reminder_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "manager_id" uuid;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "finance_access" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_custom_field_values" ADD CONSTRAINT "employee_custom_field_values_field_id_employee_custom_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."employee_custom_fields"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_custom_field_values" ADD CONSTRAINT "employee_custom_field_values_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_pay" ADD CONSTRAINT "employee_pay_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_pay" ADD CONSTRAINT "employee_pay_updated_by_employee_id_employees_id_fk" FOREIGN KEY ("updated_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_training_records" ADD CONSTRAINT "employee_training_records_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_custom_field_values_employee_id_idx" ON "employee_custom_field_values" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "employee_training_records_employee_id_idx" ON "employee_training_records" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "employee_training_records_expires_on_idx" ON "employee_training_records" USING btree ("expires_on");--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_manager_id_employees_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;