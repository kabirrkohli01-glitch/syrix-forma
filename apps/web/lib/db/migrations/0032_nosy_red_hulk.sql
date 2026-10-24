ALTER TYPE "public"."employee_status" ADD VALUE 'rejected';--> statement-breakpoint
CREATE TABLE "sign_in_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"clerk_session_id" text NOT NULL,
	"device_id" text NOT NULL,
	"new_device" boolean DEFAULT false NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"country" text,
	"account_status" "employee_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sign_in_events_session_unique" UNIQUE("employee_id","clerk_session_id")
);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "step_up_session_id" text;--> statement-breakpoint
ALTER TABLE "sign_in_events" ADD CONSTRAINT "sign_in_events_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sign_in_events_employee_id_idx" ON "sign_in_events" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "sign_in_events_device_idx" ON "sign_in_events" USING btree ("employee_id","device_id");--> statement-breakpoint
CREATE INDEX "sign_in_events_created_at_idx" ON "sign_in_events" USING btree ("created_at");