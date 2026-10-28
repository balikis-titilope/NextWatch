-- Adds the notifications system (spec 0006): a persisted notifications
-- table, plus three users columns that drive its two triggers -- a
-- rating-count threshold ("recommendations ready") and a daily inactivity
-- scan ("re-engagement"). last_active_at backfills to created_at so no
-- existing account starts permanently exempt from the inactivity scan.
-- Re-runnable: IF NOT EXISTS, and a backfill that only touches still-null
-- rows, make this safe against a second run.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;
UPDATE users SET last_active_at = created_at WHERE last_active_at IS NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS ratings_since_rec_notif INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_prefs JSONB NOT NULL DEFAULT '{"recommendations_ready": true, "re_engagement": true}';

CREATE TABLE IF NOT EXISTS notifications (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    payload JSONB,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications (user_id) WHERE read_at IS NULL;
