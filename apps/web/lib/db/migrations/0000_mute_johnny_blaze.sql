CREATE TYPE "public"."audit_result" AS ENUM('success', 'denied', 'error');--> statement-breakpoint
CREATE TYPE "public"."employee_role" AS ENUM('EMPLOYEE', 'TEAM_LEAD', 'MANAGER', 'ADMIN', 'SECURITY_ADMIN');--> statement-breakpoint
CREATE TYPE "public"."employee_status" AS ENUM('pending', 'active', 'disabled');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_employee_id" uuid,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"result" "audit_result" NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" "employee_role",
	"team" text,
	"status" "employee_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employees_clerk_user_id_unique" UNIQUE("clerk_user_id"),
	CONSTRAINT "employees_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_employee_id_employees_id_fk" FOREIGN KEY ("actor_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;