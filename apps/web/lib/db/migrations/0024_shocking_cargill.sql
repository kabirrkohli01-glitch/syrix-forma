CREATE TYPE "public"."appraisal_status" AS ENUM('draft', 'awaiting_self_review', 'awaiting_manager_review', 'complete');--> statement-breakpoint
CREATE TYPE "public"."goal_status" AS ENUM('not_started', 'in_progress', 'achieved', 'missed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."hr_document_visibility" AS ENUM('company', 'employee');--> statement-breakpoint
CREATE TABLE "appraisals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"manager_employee_id" uuid,
	"cycle" text NOT NULL,
	"status" "appraisal_status" DEFAULT 'draft' NOT NULL,
	"self_review" text,
	"self_review_submitted_at" timestamp with time zone,
	"manager_review" text,
	"manager_review_submitted_at" timestamp with time zone,
	"rating" integer,
	"due_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appraisals_employee_cycle_unique" UNIQUE("employee_id","cycle")
);
--> statement-breakpoint
CREATE TABLE "company_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "goal_status" DEFAULT 'not_started' NOT NULL,
	"start_date" date,
	"due_date" date,
	"owner_employee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deliverables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"objective_id" uuid,
	"employee_id" uuid NOT NULL,
	"title" text NOT NULL,
	"due_date" date,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_document_acknowledgements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"typed_name" text NOT NULL,
	"document_hash" text,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_document_acknowledgements_document_employee_unique" UNIQUE("document_id","employee_id")
);
--> statement-breakpoint
CREATE TABLE "hr_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"visibility" "hr_document_visibility" NOT NULL,
	"employee_id" uuid,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"requires_acknowledgement" boolean DEFAULT false NOT NULL,
	"uploaded_by_employee_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kudos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_employee_id" uuid,
	"to_employee_id" uuid NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "objectives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"company_goal_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"status" "goal_status" DEFAULT 'not_started' NOT NULL,
	"progress_percent" integer DEFAULT 0 NOT NULL,
	"due_date" date,
	"created_by_employee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "one_to_ones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"manager_employee_id" uuid,
	"held_on" date NOT NULL,
	"agenda" text,
	"shared_notes" text,
	"private_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "survey_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"survey_id" uuid NOT NULL,
	"employee_id" uuid,
	"score" integer NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "surveys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"question" text NOT NULL,
	"is_anonymous" boolean DEFAULT true NOT NULL,
	"opens_on" date,
	"closes_on" date,
	"created_by_employee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appraisals" ADD CONSTRAINT "appraisals_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appraisals" ADD CONSTRAINT "appraisals_manager_employee_id_employees_id_fk" FOREIGN KEY ("manager_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_goals" ADD CONSTRAINT "company_goals_owner_employee_id_employees_id_fk" FOREIGN KEY ("owner_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_objective_id_objectives_id_fk" FOREIGN KEY ("objective_id") REFERENCES "public"."objectives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_document_acknowledgements" ADD CONSTRAINT "hr_document_acknowledgements_document_id_hr_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."hr_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_document_acknowledgements" ADD CONSTRAINT "hr_document_acknowledgements_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_documents" ADD CONSTRAINT "hr_documents_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_documents" ADD CONSTRAINT "hr_documents_uploaded_by_employee_id_employees_id_fk" FOREIGN KEY ("uploaded_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kudos" ADD CONSTRAINT "kudos_from_employee_id_employees_id_fk" FOREIGN KEY ("from_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kudos" ADD CONSTRAINT "kudos_to_employee_id_employees_id_fk" FOREIGN KEY ("to_employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objectives" ADD CONSTRAINT "objectives_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objectives" ADD CONSTRAINT "objectives_company_goal_id_company_goals_id_fk" FOREIGN KEY ("company_goal_id") REFERENCES "public"."company_goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objectives" ADD CONSTRAINT "objectives_created_by_employee_id_employees_id_fk" FOREIGN KEY ("created_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_to_ones" ADD CONSTRAINT "one_to_ones_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_to_ones" ADD CONSTRAINT "one_to_ones_manager_employee_id_employees_id_fk" FOREIGN KEY ("manager_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_survey_id_surveys_id_fk" FOREIGN KEY ("survey_id") REFERENCES "public"."surveys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surveys" ADD CONSTRAINT "surveys_created_by_employee_id_employees_id_fk" FOREIGN KEY ("created_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appraisals_employee_id_idx" ON "appraisals" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "deliverables_employee_id_idx" ON "deliverables" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "hr_document_acknowledgements_document_id_idx" ON "hr_document_acknowledgements" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "hr_documents_employee_id_idx" ON "hr_documents" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "hr_documents_visibility_idx" ON "hr_documents" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX "kudos_to_employee_id_idx" ON "kudos" USING btree ("to_employee_id");--> statement-breakpoint
CREATE INDEX "kudos_created_at_idx" ON "kudos" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "objectives_employee_id_idx" ON "objectives" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "objectives_company_goal_id_idx" ON "objectives" USING btree ("company_goal_id");--> statement-breakpoint
CREATE INDEX "one_to_ones_employee_id_idx" ON "one_to_ones" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "one_to_ones_held_on_idx" ON "one_to_ones" USING btree ("held_on");--> statement-breakpoint
CREATE INDEX "survey_responses_survey_id_idx" ON "survey_responses" USING btree ("survey_id");