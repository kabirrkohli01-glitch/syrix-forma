CREATE TYPE "public"."application_stage" AS ENUM('applied', 'shortlisted', 'interviewing', 'offered', 'hired', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."enrolment_status" AS ENUM('assigned', 'in_progress', 'completed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."incident_kind" AS ENUM('accident', 'near_miss', 'hazard', 'dangerous_occurrence', 'ill_health');--> statement-breakpoint
CREATE TYPE "public"."risk_level" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."vacancy_status" AS ENUM('draft', 'open', 'closed', 'filled');--> statement-breakpoint
CREATE TABLE "course_enrolments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"status" "enrolment_status" DEFAULT 'assigned' NOT NULL,
	"progress_percent" integer DEFAULT 0 NOT NULL,
	"due_on" date,
	"completed_on" date,
	"expires_on" date,
	"assigned_by_employee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_enrolments_course_employee_unique" UNIQUE("course_id","employee_id")
);
--> statement-breakpoint
CREATE TABLE "course_playlist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"playlist_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "course_playlist_items_unique" UNIQUE("playlist_id","course_id")
);
--> statement-breakpoint
CREATE TABLE "course_playlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"provider" text,
	"external_url" text,
	"estimated_minutes" integer,
	"required_for_team" text,
	"required_for_role" "employee_role",
	"valid_for_months" integer,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "incident_kind" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"location" text,
	"description" text NOT NULL,
	"affected_employee_id" uuid,
	"injury_detail" text,
	"immediate_action" text,
	"reported_by_employee_id" uuid,
	"riddor_reportable" boolean DEFAULT false NOT NULL,
	"riddor_reported_on" date,
	"investigation_notes" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"interviewer_employee_id" uuid,
	"location" text,
	"feedback" text,
	"recommendation" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vacancy_id" uuid NOT NULL,
	"candidate_name" text NOT NULL,
	"candidate_email" text NOT NULL,
	"candidate_phone" text,
	"stage" "application_stage" DEFAULT 'applied' NOT NULL,
	"cover_note" text,
	"cv_storage_key" text,
	"cv_file_name" text,
	"rating" integer,
	"notes" text,
	"converted_employee_id" uuid,
	"applied_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_applications_vacancy_email_unique" UNIQUE("vacancy_id","candidate_email")
);
--> statement-breakpoint
CREATE TABLE "risk_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"location" text,
	"hazard" text NOT NULL,
	"who_is_at_risk" text,
	"existing_controls" text,
	"further_action_needed" text,
	"likelihood" integer NOT NULL,
	"severity" integer NOT NULL,
	"level" "risk_level" DEFAULT 'low' NOT NULL,
	"assessed_by_employee_id" uuid,
	"assessed_on" date NOT NULL,
	"review_due_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "safety_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"role_name" text NOT NULL,
	"certified_on" date,
	"expires_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vacancies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"team" text,
	"description" text,
	"location" text,
	"salary_min_pence" integer,
	"salary_max_pence" integer,
	"status" "vacancy_status" DEFAULT 'draft' NOT NULL,
	"hiring_manager_employee_id" uuid,
	"closes_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "course_enrolments" ADD CONSTRAINT "course_enrolments_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_enrolments" ADD CONSTRAINT "course_enrolments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_enrolments" ADD CONSTRAINT "course_enrolments_assigned_by_employee_id_employees_id_fk" FOREIGN KEY ("assigned_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_playlist_items" ADD CONSTRAINT "course_playlist_items_playlist_id_course_playlists_id_fk" FOREIGN KEY ("playlist_id") REFERENCES "public"."course_playlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_playlist_items" ADD CONSTRAINT "course_playlist_items_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_affected_employee_id_employees_id_fk" FOREIGN KEY ("affected_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_reported_by_employee_id_employees_id_fk" FOREIGN KEY ("reported_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_application_id_job_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."job_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_interviewer_employee_id_employees_id_fk" FOREIGN KEY ("interviewer_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_vacancy_id_vacancies_id_fk" FOREIGN KEY ("vacancy_id") REFERENCES "public"."vacancies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_converted_employee_id_employees_id_fk" FOREIGN KEY ("converted_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_assessments" ADD CONSTRAINT "risk_assessments_assessed_by_employee_id_employees_id_fk" FOREIGN KEY ("assessed_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_roles" ADD CONSTRAINT "safety_roles_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_hiring_manager_employee_id_employees_id_fk" FOREIGN KEY ("hiring_manager_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "course_enrolments_employee_id_idx" ON "course_enrolments" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "course_enrolments_expires_on_idx" ON "course_enrolments" USING btree ("expires_on");--> statement-breakpoint
CREATE INDEX "incidents_occurred_at_idx" ON "incidents" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "incidents_kind_idx" ON "incidents" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "interviews_application_id_idx" ON "interviews" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "job_applications_vacancy_id_idx" ON "job_applications" USING btree ("vacancy_id");--> statement-breakpoint
CREATE INDEX "job_applications_stage_idx" ON "job_applications" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "risk_assessments_review_due_on_idx" ON "risk_assessments" USING btree ("review_due_on");--> statement-breakpoint
CREATE INDEX "safety_roles_employee_id_idx" ON "safety_roles" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "safety_roles_expires_on_idx" ON "safety_roles" USING btree ("expires_on");