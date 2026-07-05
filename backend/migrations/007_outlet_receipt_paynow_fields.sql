-- Receipt branding + manual-PayNow destination, per outlet.
-- receipt_brand_name: printed as the receipt header (editable in admin later).
-- receipt_company_details: legal entity block under the header (e.g. "HAC North Pte Ltd").
-- paynow_uen: PayNow proxy for dynamically generated fallback QR codes.
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS receipt_brand_name TEXT;
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS receipt_company_details TEXT;
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS paynow_uen TEXT;
