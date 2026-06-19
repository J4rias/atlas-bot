-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =========================================================
-- Conversations (shared: both consultant and manager)
-- =========================================================
CREATE TABLE conversations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mode            VARCHAR(20) NOT NULL CHECK (mode IN ('consultant', 'manager')),
    external_id     VARCHAR(255),
    channel         VARCHAR(20) NOT NULL,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at        TIMESTAMPTZ,
    metadata        JSONB DEFAULT '{}'
);

CREATE INDEX idx_conversations_mode ON conversations(mode);
CREATE INDEX idx_conversations_external ON conversations(external_id);

-- =========================================================
-- Messages
-- =========================================================
CREATE TABLE messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            VARCHAR(20) NOT NULL,
    content         TEXT NOT NULL,
    tool_use        JSONB,
    tokens_in       INTEGER,
    tokens_out      INTEGER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);

-- =========================================================
-- Agent memory (multi-layer: observation, decision, insight, rule, escalation, feedback)
-- =========================================================
CREATE TABLE agent_memory (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category        VARCHAR(50) NOT NULL,
    subject         VARCHAR(255) NOT NULL,
    content         TEXT NOT NULL,
    confidence      REAL DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
    source          VARCHAR(50),
    outcome         TEXT,
    valid_until     TIMESTAMPTZ,
    superseded_by   UUID REFERENCES agent_memory(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_memory_category ON agent_memory(category);
CREATE INDEX idx_agent_memory_subject ON agent_memory(subject);
CREATE INDEX idx_agent_memory_active ON agent_memory(category, subject)
    WHERE superseded_by IS NULL;

-- =========================================================
-- Agent self-metrics (auto-measurement)
-- =========================================================
CREATE TABLE agent_self_metrics (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    metric          VARCHAR(100) NOT NULL,
    period          VARCHAR(20) NOT NULL,
    value           REAL NOT NULL,
    details         JSONB DEFAULT '{}',
    measured_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_metrics_lookup ON agent_self_metrics(metric, period, measured_at DESC);

-- =========================================================
-- Diagnostic reports
-- =========================================================
CREATE TABLE diagnostic_reports (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_type       VARCHAR(50) NOT NULL,
    summary           TEXT NOT NULL,
    details           JSONB NOT NULL,
    actions_suggested JSONB DEFAULT '[]',
    was_sent          BOOLEAN DEFAULT FALSE,
    was_escalated     BOOLEAN DEFAULT FALSE,
    escalated_to      VARCHAR(50),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_diagnostic_reports_type ON diagnostic_reports(report_type, created_at DESC);

-- =========================================================
-- Vector embeddings (RAG for both modes)
-- =========================================================
CREATE TABLE embeddings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type     VARCHAR(50) NOT NULL,
    source_id       VARCHAR(255),
    chunk_index     INTEGER DEFAULT 0,
    content         TEXT NOT NULL,
    embedding       vector(1024),
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_embeddings_source ON embeddings(source_type, source_id);
