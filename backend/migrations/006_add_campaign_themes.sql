-- Add campaign voucher theme columns (idempotent)
-- Revision ID: 006_campaign_themes

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS voucher_style VARCHAR;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS voucher_accent_color VARCHAR;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS voucher_headline VARCHAR;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS voucher_background_url VARCHAR;
