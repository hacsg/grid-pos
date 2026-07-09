-- Manual terminal mode per outlet: when true, the POS does not integrate with
-- the KPay terminal (staff key card amounts in manually; PayNow uses self-QR).
-- Default true so outlets go live without KPay API integration.
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS manual_terminal_mode BOOLEAN NOT NULL DEFAULT TRUE;
