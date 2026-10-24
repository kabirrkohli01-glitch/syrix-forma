CREATE TYPE "public"."employee_work_status" AS ENUM('working', 'on_break', 'logged_off');--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "work_status" "employee_work_status" DEFAULT 'logged_off' NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "work_status_changed_at" timestamp with time zone;