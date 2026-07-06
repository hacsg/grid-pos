-- Daily GTO (gross turnover) files for the landlord/mall SFTP feed.
-- One row per SGT sales date. batch_id is sequential and stable: a regenerated
-- file for the same date keeps its batch_id (mall spec requirement). content is
-- retained as the backup so an unsent file can be re-transmitted when SFTP is
-- restored.
CREATE TABLE IF NOT EXISTS gto_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sales_date DATE NOT NULL UNIQUE,
    batch_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    content TEXT NOT NULL,
    uploaded BOOLEAN NOT NULL DEFAULT FALSE,
    upload_error TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    uploaded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_gto_files_unuploaded ON gto_files (sales_date) WHERE uploaded = FALSE;
