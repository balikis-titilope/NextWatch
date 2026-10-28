-- Adds the onboarding completion flag used by the relaunch routing check
-- (spec 0004). Only ever moves false -> true; nothing sets it back.
-- Re-runnable: IF NOT EXISTS makes this safe against a second run.
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed boolean not null default false;
