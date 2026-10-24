ALTER TABLE "calendar_events" ADD COLUMN "is_seed_data" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "is_seed_data" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "is_seed_data" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD COLUMN "is_seed_data" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "is_seed_data" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "is_seed_data" boolean DEFAULT false NOT NULL;