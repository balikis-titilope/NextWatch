-- Adds the stored country used to resolve Where to Watch providers to the
-- viewer's actual region (spec 0005). Captured once from the device's
-- locale at signup; null on existing accounts falls back to NG then US.
-- Re-runnable: IF NOT EXISTS makes this safe against a second run.
ALTER TABLE users ADD COLUMN IF NOT EXISTS country TEXT;
