-- Custom SQL migration file, put your code below! --
INSERT INTO "automations" ("key", "name", "description", "trigger_event", "config") VALUES
	('task-completed-project-sync', 'Task completed → project sync', 'When a task completes, marks its project completed once every task on it is done.', 'TASK_COMPLETED', '{}')
ON CONFLICT ("key") DO NOTHING;
