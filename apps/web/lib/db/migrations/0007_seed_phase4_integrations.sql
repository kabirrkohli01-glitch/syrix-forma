-- Custom SQL migration file, put your code below! --
INSERT INTO "integrations" ("key", "name") VALUES
	('hostinger_mail', 'Hostinger Mail'),
	('microsoft_365', 'Microsoft 365 / SharePoint / OneDrive / NAS')
ON CONFLICT ("key") DO NOTHING;
