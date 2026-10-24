ALTER TABLE "tasks" ADD COLUMN "team" text NOT NULL;--> statement-breakpoint
CREATE INDEX "tasks_team_idx" ON "tasks" USING btree ("team");