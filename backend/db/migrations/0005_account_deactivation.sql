-- Adds account deactivation and deletion (spec 0009): a deactivated_at
-- column driving a 30 day recoverable grace period, plus ON DELETE CASCADE
-- on ratings and notifications so a users row delete (the daily purge job)
-- removes an account's data automatically instead of leaving it orphaned.
-- Re-runnable: IF NOT EXISTS / IF EXISTS on every statement makes this safe
-- against a second run.
ALTER TABLE users ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;

-- Postgres has no ALTER CONSTRAINT to add ON DELETE CASCADE in place --
-- drop and recreate under the same auto-generated name each column's
-- inline REFERENCES clause originally produced (db/import_data.py's
-- CREATE_TABLES_SQL), so this doesn't depend on a name from a migration
-- that may not have run in this exact environment.
ALTER TABLE ratings DROP CONSTRAINT IF EXISTS ratings_user_id_fkey;
ALTER TABLE ratings
    ADD CONSTRAINT ratings_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_user_id_fkey;
ALTER TABLE notifications
    ADD CONSTRAINT notifications_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
