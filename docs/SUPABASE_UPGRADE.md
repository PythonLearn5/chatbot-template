# Supabase 数据库 Schema 参考

> 文件存储 → Supabase (PostgreSQL + pgvector) 迁移**已完成**，所有代码均已使用 Supabase。

## 一、概述

本项目已完成从文件系统 JSON 存储（`.data/` 目录）到 Supabase（PostgreSQL + pgvector）的迁移。所有持久化数据现在均存储在 Supabase 数据库中，涉及以下模块：

| 模块 | 数据 | 对应表 |
|------|------|--------|
| `lib/auth.ts` | 用户账号 + 会话令牌 | `users`, `auth_tokens` |
| `lib/storage.ts` | 聊天会话、记忆、摘要、提示词模板 | `chats`, `memories`, `prompt_templates` |
| `lib/rag.ts` | 知识库文档 + 向量 | `knowledge_docs`, `knowledge_vectors` |
| `lib/mcp-config.ts` | MCP 服务器配置 | `mcp_servers` |
| `lib/logger.ts` | 请求日志 | `request_logs` |

---

## 二、环境变量

`.env.local`（或 Vercel 环境变量）需包含以下变量：

| 变量名 | 说明 | 示例值 |
|--------|------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 项目 URL | `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase 服务端密钥（**仅服务端使用，绕过 RLS**） | `eyJhbGciOi...` |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway API Key | `vck_xxxxxxxx` |

> **安全提示**：`SUPABASE_SERVICE_ROLE_KEY` 可绕过 RLS，**切勿暴露到前端代码**。本项目已通过 `"server-only"` 限制仅服务端引用。

---

## 三、数据库客户端（lib/db.ts）

```ts
import "server-only"
import { createClient } from "@supabase/supabase-js"

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,  // 服务端绕过 RLS
  { auth: { persistSession: false } }
)
```

- 使用 `service_role` key，绕过行级安全（RLS）策略。
- `{ auth: { persistSession: false } }` 禁用客户端会话持久化（服务端无需）。
- `import "server-only"` 确保此模块仅在服务端引用，防止打包到客户端。

---

## 四、完整 Schema（9 张表）

以下 Schema 来自实际迁移文件 `supabase/migrations/001_init_schema.sql`。

### 4.1 用户表

```sql
CREATE TABLE users (
  id            TEXT PRIMARY KEY,          -- user-{timestamp}-{rand}
  email         TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,             -- salt:hash (scrypt)
  created_at   TIMESTAMPTZ DEFAULT now()
);
```

### 4.2 会话令牌表

```sql
CREATE TABLE auth_tokens (
  token      TEXT PRIMARY KEY,              -- 32-byte hex
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_auth_tokens_user_id ON auth_tokens(user_id);
```

### 4.3 聊天会话表

> messages + meta + summary 合一。

```sql
CREATE TABLE chats (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT,                 -- NULL = 匿名
  title               TEXT DEFAULT '新对话',
  messages            JSONB DEFAULT '[]',   -- UIMessage[]
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
```

### 4.4 长期记忆表

```sql
CREATE TABLE memories (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,                          -- NULL = 匿名
  type       TEXT NOT NULL,                 -- profile | fact | preference
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, type, key)                -- upsert 语义
);
CREATE INDEX idx_memories_user_id ON memories(user_id);
```

### 4.5 自定义提示词模板表

```sql
CREATE TABLE prompt_templates (
  id            TEXT PRIMARY KEY,
  user_id       TEXT,                       -- NULL = 匿名
  name          TEXT NOT NULL,
  icon          TEXT,
  description   TEXT,
  system_prompt TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_prompt_templates_user_id ON prompt_templates(user_id);
```

### 4.6 知识库文档表

```sql
CREATE TABLE knowledge_docs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,                         -- NULL = 匿名
  name        TEXT NOT NULL,
  chunk_count INT DEFAULT 0,
  size        INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_knowledge_docs_user_id ON knowledge_docs(user_id);
```

### 4.7 知识库向量表（pgvector）

> 需先启用扩展：`CREATE EXTENSION IF NOT EXISTS vector;`

```sql
CREATE TABLE knowledge_vectors (
  id          TEXT PRIMARY KEY,
  doc_id      TEXT NOT NULL REFERENCES knowledge_docs(id) ON DELETE CASCADE,
  user_id     TEXT,
  chunk       TEXT NOT NULL,
  embedding   VECTOR(1536),                 -- text-embedding-3-small 维度
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_kv_user_id ON knowledge_vectors(user_id);
CREATE INDEX idx_kv_embedding ON knowledge_vectors
  USING hnsw (embedding vector_cosine_ops);
```

### 4.8 MCP 服务器配置表（全局）

```sql
CREATE TABLE mcp_servers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  transport  TEXT NOT NULL,                 -- sse | streamable-http
  url        TEXT,
  headers    JSONB,
  enabled    BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 4.9 请求日志表（append-only）

```sql
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
  status         TEXT NOT NULL,             -- success | error
  error          TEXT,
  tool_calls     JSONB
);
CREATE INDEX idx_request_logs_timestamp ON request_logs(timestamp DESC);
CREATE INDEX idx_request_logs_user_id   ON request_logs(user_id);
```

---

## 五、match_knowledge_vectors RPC 函数

来自 `supabase/migrations/002_match_vectors.sql`，用于 RAG 语义检索，通过余弦距离排序：

```sql
CREATE OR REPLACE FUNCTION match_knowledge_vectors(
  query_embedding vector(1536),
  match_count int DEFAULT 5,
  filter_user_id text DEFAULT NULL
)
RETURNS TABLE (
  id text,
  doc_id text,
  chunk text,
  similarity float
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    kv.id,
    kv.doc_id,
    kv.chunk,
    1 - (kv.embedding <=> query_embedding) AS similarity
  FROM knowledge_vectors kv
  WHERE filter_user_id IS NULL OR kv.user_id = filter_user_id
  ORDER BY kv.embedding <=> query_embedding
  LIMIT match_count;
$$;
```

- `query_embedding`：查询向量（1536 维）。
- `match_count`：返回结果数量，默认 5。
- `filter_user_id`：用户隔离过滤，`NULL` 表示匿名或不过滤。
- `<=>` 为 pgvector 的余弦距离运算符，`1 - distance` 转换为相似度。

---

## 六、种子数据

来自 `supabase/migrations/003_seed_mcp_servers.sql`，插入一个公开 MCP 服务器作为示例：

```sql
INSERT INTO mcp_servers (id, name, transport, url, enabled, created_at)
VALUES
  (
    'toolkit-mcp',
    'Toolkit MCP',
    'streamable-http',
    'https://toolkit.caseyjhand.com/mcp',
    true,
    now()
  )
ON CONFLICT (id) DO NOTHING;
```

- Toolkit MCP 是一个公开的 MCP 服务器，提供工具集能力。
- 使用 `ON CONFLICT (id) DO NOTHING` 确保重复执行不会报错。

---

## 七、迁移文件列表

| 文件 | 说明 |
|------|------|
| `supabase/migrations/001_init_schema.sql` | 创建 9 张表 + pgvector 扩展 + HNSW 索引 |
| `supabase/migrations/002_match_vectors.sql` | 创建 `match_knowledge_vectors` 向量检索 RPC 函数 |
| `supabase/migrations/003_seed_mcp_servers.sql` | 插入 Toolkit MCP 种子数据 |

---

## 八、API 路由 → 存储模块映射

| API 路由 | 存储模块 |
|----------|----------|
| `POST /api/auth` | `lib/auth.ts` — register/login |
| `GET /api/auth` | `lib/auth.ts` — getCurrentUser |
| `DELETE /api/auth` | `lib/auth.ts` — logout |
| `POST /api/chat` | `lib/storage.ts` + `lib/rag.ts` + `lib/auth.ts` + `lib/mcp-config.ts` + `lib/logger.ts` |
| `GET /api/chats` | `lib/storage.ts` — listChats |
| `POST /api/chats` | `lib/storage.ts` — saveChat |
| `GET/DELETE/PATCH /api/chats/[id]` | `lib/storage.ts` — loadChat/deleteChat/getChatMeta/saveChat |
| `GET /api/knowledge` | `lib/rag.ts` — listDocs/deleteDoc |
| `POST /api/upload` | `lib/rag.ts` — embedAndStore |
| `GET /api/memory` | `lib/storage.ts` — loadAllMemories |
| `GET/POST/DELETE /api/prompt-templates` | `lib/storage.ts` — list/save/delete templates |
| `GET/POST/DELETE /api/mcp` | `lib/mcp-config.ts` — list/save/delete servers |
| `GET /api/stats` | `lib/logger.ts` — getUsageStats |

---

## 九、用户隔离模式

所有用户相关表均通过 `user_id` 字段实现隔离：

- **登录用户**：`user_id` 为用户 ID（`user-{timestamp}-{rand}`）。
- **匿名用户**：`user_id` 为 `NULL`。
- 所有查询均通过 `.eq("user_id", userId ?? null)` 或 `.is("user_id", null)` 进行范围限定。
- `listChats`、`loadChat`、`deleteChat`、`getChatMeta`、`saveSummary`、`loadSummary`、`searchMemories`、`listCustomTemplates` 等函数均接受 `userId?: string` 参数并按此过滤。
- 全局表（如 `mcp_servers`、`request_logs`）不按用户隔离。
