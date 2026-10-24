-- Custom SQL migration file, put your code below! --
INSERT INTO "automations" ("key", "name", "description", "trigger_event", "config") VALUES
	('client-inactivity-follow-up', 'Client inactivity follow-up', 'Notifies assigned staff when a client has had no linked task, note, or email activity for a while.', 'CLIENT_INACTIVITY_SCAN', '{"inactivityThresholdDays": 14}'),
	('project-deadline-reminder', 'Project deadline reminder', 'Notifies project staff as a milestone''s due date approaches, if it is not yet completed.', 'PROJECT_MILESTONE_DUE_SOON', '{"daysBeforeDeadline": 3}')
ON CONFLICT ("key") DO NOTHING;
