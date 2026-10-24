-- Custom SQL migration file, put your code below! --
--
-- Reference data the time-off module cannot function without: the leave types a request must
-- pick from, and the public holidays the working-day calculation subtracts. Seeded here rather
-- than left to an administrator because an empty leave_types table makes the Book time off
-- button do nothing, and an empty public_holidays table silently charges people for bank
-- holidays — a wrong answer that looks like a right one.
--
-- Every row is editable afterwards. ON CONFLICT DO NOTHING keeps this safe to re-run and
-- prevents it from overwriting a change someone has since made.

INSERT INTO "leave_types" ("name", "deducts_from_allowance", "is_paid", "requires_approval", "colour", "position") VALUES
	('Holiday', true, true, true, '#3b82f6', 1),
	('Unpaid leave', false, false, true, '#6b7280', 2),
	('Compassionate leave', false, true, true, '#8b5cf6', 3),
	('Parental leave', false, true, true, '#ec4899', 4),
	('Time off in lieu', true, true, true, '#14b8a6', 5),
	('Jury service', false, true, true, '#f59e0b', 6)
ON CONFLICT ("name") DO NOTHING;

-- England and Wales bank holidays, 2026 and 2027, as published by GOV.UK.
-- Regional calendars (Scotland, Northern Ireland) are deliberately not seeded: the organisation operates
-- under England and Wales, and inventing dates for regions the business does not employ in
-- would put unverified data in front of someone who would reasonably trust it. The `region`
-- column exists so they can be added when there is a reason to.
INSERT INTO "public_holidays" ("date", "name", "region") VALUES
	('2026-01-01', 'New Year''s Day', 'England and Wales'),
	('2026-04-03', 'Good Friday', 'England and Wales'),
	('2026-04-06', 'Easter Monday', 'England and Wales'),
	('2026-05-04', 'Early May bank holiday', 'England and Wales'),
	('2026-05-25', 'Spring bank holiday', 'England and Wales'),
	('2026-08-31', 'Summer bank holiday', 'England and Wales'),
	('2026-12-25', 'Christmas Day', 'England and Wales'),
	('2026-12-28', 'Boxing Day (substitute day)', 'England and Wales'),
	('2027-01-01', 'New Year''s Day', 'England and Wales'),
	('2027-03-26', 'Good Friday', 'England and Wales'),
	('2027-03-29', 'Easter Monday', 'England and Wales'),
	('2027-05-03', 'Early May bank holiday', 'England and Wales'),
	('2027-05-31', 'Spring bank holiday', 'England and Wales'),
	('2027-08-30', 'Summer bank holiday', 'England and Wales'),
	('2027-12-27', 'Christmas Day (substitute day)', 'England and Wales'),
	('2027-12-28', 'Boxing Day (substitute day)', 'England and Wales')
ON CONFLICT ("date", "region") DO NOTHING;
