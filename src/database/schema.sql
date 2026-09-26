-- PROBE: PostgreSQL Persistent Investigation State Schema

-- 1. Users table (Telegram-first identification for MVP)
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  telegram_chat_id BIGINT UNIQUE NOT NULL,
  username VARCHAR(255),
  first_name VARCHAR(255),
  total_credits_used INT DEFAULT 0 CHECK (total_credits_used >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_telegram_chat_id ON users(telegram_chat_id);

-- 2. Investigations table
CREATE TABLE IF NOT EXISTS investigations (
  id VARCHAR(64) PRIMARY KEY,
  telegram_chat_id BIGINT NOT NULL REFERENCES users(telegram_chat_id) ON DELETE CASCADE,
  chain VARCHAR(64) NOT NULL,
  token_address VARCHAR(128) NOT NULL,
  token_symbol VARCHAR(32) NOT NULL,
  token_name VARCHAR(128) NOT NULL,
  state VARCHAR(32) NOT NULL DEFAULT 'TOKEN_RESOLVED',
  initial_question TEXT,
  current_question TEXT,
  total_credits_used INT DEFAULT 0 CHECK (total_credits_used >= 0),
  token_metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_investigations_chat_id ON investigations(telegram_chat_id);
CREATE INDEX IF NOT EXISTS idx_investigations_token_chain ON investigations(chain, token_address);
CREATE INDEX IF NOT EXISTS idx_investigations_state ON investigations(state);

-- 3. Investigation Messages
CREATE TABLE IF NOT EXISTS investigation_messages (
  id VARCHAR(64) PRIMARY KEY,
  investigation_id VARCHAR(64) NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  role VARCHAR(16) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_investigation_id ON investigation_messages(investigation_id);

-- 4. Evidence Items (Preserves complete provenance & epistemic distinction)
CREATE TABLE IF NOT EXISTS evidence_items (
  id VARCHAR(64) PRIMARY KEY,
  investigation_id VARCHAR(64) NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  epistemic_status VARCHAR(32) NOT NULL CHECK (epistemic_status IN ('OBSERVATION', 'INTERPRETATION', 'HYPOTHESIS', 'UNKNOWN')),
  summary TEXT NOT NULL,
  source VARCHAR(32) NOT NULL DEFAULT 'nansen',
  endpoint VARCHAR(128) NOT NULL,
  capability VARCHAR(64) NOT NULL,
  chain VARCHAR(64) NOT NULL,
  token_address VARCHAR(128) NOT NULL,
  time_range JSONB,
  query_params JSONB NOT NULL,
  normalized_data JSONB NOT NULL,
  credits_cost INT DEFAULT 0 CHECK (credits_cost >= 0),
  retrieved_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evidence_investigation_id ON evidence_items(investigation_id);
CREATE INDEX IF NOT EXISTS idx_evidence_capability ON evidence_items(capability);
CREATE INDEX IF NOT EXISTS idx_evidence_epistemic_status ON evidence_items(epistemic_status);

-- 5. Findings
CREATE TABLE IF NOT EXISTS findings (
  id VARCHAR(64) PRIMARY KEY,
  investigation_id VARCHAR(64) NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  claim TEXT NOT NULL,
  status VARCHAR(32) NOT NULL CHECK (status IN ('OBSERVATION', 'INTERPRETATION', 'HYPOTHESIS', 'UNKNOWN')),
  confidence NUMERIC(3, 2) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  evidence_references JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_findings_investigation_id ON findings(investigation_id);

-- 6. Timeline Events
CREATE TABLE IF NOT EXISTS timeline_events (
  id VARCHAR(64) PRIMARY KEY,
  investigation_id VARCHAR(64) NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  event_type VARCHAR(64) NOT NULL,
  summary TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence_reference_id VARCHAR(64),
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_timeline_investigation_id ON timeline_events(investigation_id);
CREATE INDEX IF NOT EXISTS idx_timeline_timestamp ON timeline_events(timestamp);
