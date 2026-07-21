CREATE TABLE IF NOT EXISTS print_templates (
    id UUID PRIMARY KEY,
    outlet_id UUID NULL REFERENCES outlets(id) ON DELETE CASCADE,
    document_type VARCHAR(32) NOT NULL CHECK (document_type IN ('receipt', 'kitchen_chit')),
    name VARCHAR(120) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    config JSON NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_print_templates_scope_name UNIQUE (outlet_id, document_type, name)
);

CREATE INDEX IF NOT EXISTS ix_print_templates_outlet_id ON print_templates(outlet_id);
CREATE INDEX IF NOT EXISTS ix_print_templates_document_type ON print_templates(document_type);

CREATE UNIQUE INDEX IF NOT EXISTS uq_print_templates_active_outlet
    ON print_templates(outlet_id, document_type)
    WHERE is_active = TRUE AND outlet_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_print_templates_active_global
    ON print_templates(document_type)
    WHERE is_active = TRUE AND outlet_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_print_templates_global_name
    ON print_templates(document_type, name)
    WHERE outlet_id IS NULL;
