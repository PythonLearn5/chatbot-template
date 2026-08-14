-- ============================================================================
-- Supabase 初始化 Schema
-- 文件存储 → PostgreSQL + pgvector
-- ============================================================================

-- 启用 pgvector 扩展
CREATE EXTENSION IF NOT EXISTS vector;

-- 1. 用户表
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- 2. 会话令牌表
CREATE TABLE auth_tokens (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_auth_tokens_user_id ON auth_tokens(user_id);

-- 3. 聊天会话表（messages + meta + summary 合一）
CREATE TABLE chats (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT,
  title               TEXT DEFAULT '新对话',
  messages            JSONB DEFAULT '[]',
  message_count       INT DEFAULT 0,
  system_prompt       TEXT,
  prompt_template_id  TEXT,
  summary             TEXT,
  summarized_count    INT DEFAULT 0,
  summary_created_at  TIMESTAMPTZ,
  summary_updated_at  TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_chats_user_id     ON chats(user_id);
CREATE INDEX idx_chats_updated_at  ON chats(updated_at DESC);

-- 4. 长期记忆表
CREATE TABLE memories (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  type       TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, type, key)
);
CREATE INDEX idx_memories_user_id ON memories(user_id);

-- 5. 自定义提示词模板表
CREATE TABLE prompt_templates (
  id            TEXT PRIMARY KEY,
  user_id       TEXT,
  name          TEXT NOT NULL,
  icon          TEXT,
  description   TEXT,
  system_prompt TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_prompt_templates_user_id ON prompt_templates(user_id);

-- 6. 知识库文档表
CREATE TABLE knowledge_docs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  name        TEXT NOT NULL,
  chunk_count INT DEFAULT 0,
  size        INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_knowledge_docs_user_id ON knowledge_docs(user_id);

-- 7. 知识库向量表（pgvector）
CREATE TABLE knowledge_vectors (
  id          TEXT PRIMARY KEY,
  doc_id      TEXT NOT NULL REFERENCES knowledge_docs(id) ON DELETE CASCADE,
  user_id     TEXT,
  chunk       TEXT NOT NULL,
  embedding   VECTOR(1536),
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_kv_user_id ON knowledge_vectors(user_id);
CREATE INDEX idx_kv_embedding ON knowledge_vectors
  USING hnsw (embedding vector_cosine_ops);

-- 8. MCP 服务器配置表（全局）
CREATE TABLE mcp_servers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  transport  TEXT NOT NULL,
  url        TEXT,
  headers    JSONB,
  enabled    BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 9. 请求日志表（append-only）
CREATE TABLE request_logs (
  id             BIGSERIAL PRIMARY KEY,
  timestamp      TIMESTAMPTZ DEFAULT now(),
  chat_id        TEXT,
  user_id        TEXT,
  model          TEXT,
  duration_ms    INT,
  input_tokens   INT,
  output_tokens  INT,
  total_tokens   INT,
  status         TEXT NOT NULL,
  error          TEXT,
  tool_calls     JSONB
);
CREATE INDEX idx_request_logs_timestamp ON request_logs(timestamp DESC);
CREATE INDEX idx_request_logs_user_id   ON request_logs(user_id);
