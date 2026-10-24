-- Custom SQL migration file, put your code below! --
--
-- Reference data the expenses module cannot function without: the categories a claim item
-- picks from, and the HMRC approved mileage rates the mileage calculator bands against. An
-- empty mileage_rates table makes calculateMileagePence throw rather than quietly guess,
-- which is the right failure, but it makes the feature unusable until someone fills it in.
--
-- Both generations of the car rate are seeded, not just the current one. The rate rose from
-- 45p to 55p for the first 10,000 miles from 6 April 2026 (the first change since 2011), and
-- a claim for a journey made before that date must still reconcile against the rate that
-- applied then — which is the entire reason mileage_rates carries effective_from rather than
-- being a constant in code. Rates verified against
-- https://www.gov.uk/government/publications/rates-and-allowances-travel-mileage-and-fuel-allowances

INSERT INTO "expense_categories" ("name", "warn_over_pence", "block_over_pence", "is_mileage") VALUES
	('Mileage', NULL, NULL, true),
	('Travel', 20000, 50000, false),
	('Accommodation', 15000, 40000, false),
	('Subsistence', 3000, 7500, false),
	('Client entertaining', 10000, 25000, false),
	('Training and books', 25000, 100000, false),
	('Equipment', 25000, 100000, false),
	('Other', NULL, 25000, false)
ON CONFLICT ("name") DO NOTHING;

-- Cars and vans: 45p then 25p, in force from 2011 until the 2026/27 tax year.
INSERT INTO "mileage_rates" ("vehicle_type", "from_miles", "pence_per_mile", "effective_from") VALUES
	('car', 0, 45, '2011-04-06'),
	('car', 10000, 25, '2011-04-06'),
	-- From 6 April 2026 the first-10,000-mile rate rises to 55p. The above-10,000 rate is
	-- unchanged, but is restated at the new effective date so a single query for "the bands in
	-- force on this date" returns a complete set rather than one band from each generation.
	('car', 0, 55, '2026-04-06'),
	('car', 10000, 25, '2026-04-06'),
	-- Motorcycles and bicycles are flat rates with no distance band, unchanged since 2011.
	('motorcycle', 0, 24, '2011-04-06'),
	('bicycle', 0, 20, '2011-04-06')
ON CONFLICT ("vehicle_type", "from_miles", "effective_from") DO NOTHING;

-- Shift templates a rota can be built from. Editable; these are a starting point, not policy.
INSERT INTO "shift_templates" ("name", "start_minute", "end_minute", "unpaid_break_minutes", "colour") VALUES
	('Standard day', 540, 1020, 60, '#3b82f6'),
	('Early', 420, 900, 60, '#14b8a6'),
	('Late', 780, 1260, 60, '#8b5cf6'),
	('Half day (morning)', 540, 780, 0, '#f59e0b')
ON CONFLICT DO NOTHING;
