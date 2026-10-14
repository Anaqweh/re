import { setupSuppressions } from './message-suppression.js';
// Additive migrations only. Existing campaigns, templates, lists and contacts stay intact.
export async function setupMessageStudio(db) {
  await db.query(`
    ALTER TABLE message_contacts ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT '';
    ALTER TABLE message_contacts ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
    ALTER TABLE message_contacts ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT '';
    ALTER TABLE message_contacts ADD COLUMN IF NOT EXISTS suppressed BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}';
    ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS submission_key TEXT NOT NULL DEFAULT '';
    CREATE UNIQUE INDEX IF NOT EXISTS message_submission_unique ON email_campaigns(submission_key) WHERE submission_key<>'';
    ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}';
    ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS audience_snapshot JSONB NOT NULL DEFAULT '{}';
    ALTER TABLE email_deliveries ADD COLUMN IF NOT EXISTS retryable BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE email_deliveries ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE email_deliveries ADD COLUMN IF NOT EXISTS payload_snapshot JSONB;
    CREATE TABLE IF NOT EXISTS message_drafts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), payload JSONB NOT NULL DEFAULT '{}',
      version INTEGER NOT NULL DEFAULT 1, campaign_id UUID REFERENCES email_campaigns(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS message_draft_versions (
      draft_id UUID NOT NULL REFERENCES message_drafts(id) ON DELETE CASCADE,
      version INTEGER NOT NULL, payload JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY(draft_id,version)
    );
    CREATE TABLE IF NOT EXISTS message_blocks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, body TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS message_studio_settings (
      id INTEGER PRIMARY KEY CHECK(id=1), value JSONB NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS message_test_requests (
      id UUID PRIMARY KEY, request_hash TEXT NOT NULL, payload JSONB NOT NULL,
      provider_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS message_webhook_events (
      id TEXT PRIMARY KEY, email_id TEXT NOT NULL, type TEXT NOT NULL, received_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS message_contact_tags_idx ON message_contacts USING GIN(tags);
    CREATE INDEX IF NOT EXISTS message_deliveries_campaign_idx ON email_deliveries(campaign_id);
    CREATE INDEX IF NOT EXISTS message_deliveries_email_idx ON email_deliveries(email);
    CREATE INDEX IF NOT EXISTS message_campaign_due_idx ON email_campaigns(status,scheduled_at);
  `);
  await setupSuppressions(db);
  // Create useful groups once; later edits and deletions remain the administrator's choice.
  const first = await db.query('INSERT INTO message_studio_settings(id,value) VALUES(1,$1) ON CONFLICT(id) DO NOTHING RETURNING id',[{}]);
  if (first.rowCount) for (const name of ['المعلمون','المتدربون','المهتمون بالدورات']) {
    await db.query('INSERT INTO message_recipient_lists(name) SELECT $1 WHERE NOT EXISTS(SELECT 1 FROM message_recipient_lists WHERE name=$1)',[name]);
  }
}
