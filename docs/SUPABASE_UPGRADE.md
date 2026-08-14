# Supabase 数据库升级方案

> 文件存储 → Supabase (PostgreSQL + pgvector) 迁移指南

## 一、背景与现状

当前项目所有持久化数据均存储在文件系统 JSON 中（`.data/` 目录），涉及 5 个模块：

| 模块 | 数据 | 目录 |
|------|------|------|
| `lib/auth.ts` | 用户账号 + 会话令牌 | `.data/auth/users.json`, `tokens.json` |
| `lib/storage.ts` | 聊天会话、记忆、摘要、提示词模板 | `.data/chats/`, `.data/memory/`, `.data/users/{hash}/` |
| `lib/rag.ts` | 知识库文档 + 向量 | `.data/knowledge/`, `.data/users/{hash}/knowledge/` |
| `lib/mcp-config.ts` | MCP 服务器配置 | `.data/mcp/servers.json` |
| `lib/logger.ts` | 请求日志 | `.data/logs/requests.jsonl` |

### 核心问题

- **并发写竞争**：无文件锁，多请求同时写同一文件可能丢数据
- **向量检索 O(n)**：每次检索将全部向量加载到内存做暴力余弦相似度
- **无事务**：跨表/跨文件操作无法原子化
- **无索引**：列表查询靠读全量 JSON 再内存过滤
- **多实例不可行**：文件存储绑定单机，无法水平扩展

---

## 二、技术选型

| 维度 | 方案 |
|------|------|
| 数据库 | Supabase (PostgreSQL) |
| 向量检索 | pgvector 扩展 + HNSW 索引 |
| 客户端 SDK | `@supabase/supabase-js`（服务端使用 `service_role` key） |
| 多用户隔离 | 查询层 `user_id` 过滤（可选 RLS 策略） |
| 密码哈希 | 保留 Node `crypto.scrypt`（不引入 bcrypt 依赖） |

---

## 三、数据库 Schema

### 3.1 用户表

```sql
CREATE TABLE users (
  id            TEXT PRIMARY KEY,          -- user-{timestamp}-{rand}
  email         TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,             -- salt:hash (scrypt)
  created_at   TIMESTAMPTZ DEFAULT now()
);
```

### 3.2 会话令牌表

```sql
CREATE TABLE auth_tokens (
  token      TEXT PRIMARY KEY,              -- 32-byte hex
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_auth_tokens_user_id ON auth_tokens(user_id);
```

### 3.3 聊天会话表

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

### 3.4 长期记忆表

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

### 3.5 自定义提示词模板表

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

### 3.6 知识库文档表

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

### 3.7 知识库向量表（pgvector）

```sql
-- 需先启用扩展
CREATE EXTENSION IF NOT EXISTS vector;

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

### 3.8 MCP 服务器配置表（全局）

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

### 3.9 请求日志表（append-only）

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

## 四、代码改造方案

### 核心原则

> 各 `lib/` 模块对外函数签名不变，API 路由零改动，仅替换内部实现。

### 文件变更清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 新增 | `lib/db.ts` | Supabase 客户端单例 |
| 改造 | `lib/auth.ts` | `fs` → Supabase `users` + `auth_tokens` 表 |
| 改造 | `lib/storage.ts` | `fs` → Supabase `chats` + `memories` + `prompt_templates` 表 |
| 改造 | `lib/rag.ts` | `fs` → Supabase `knowledge_docs` + `knowledge_vectors` + pgvector |
| 改造 | `lib/mcp-config.ts` | `fs` → Supabase `mcp_servers` 表 |
| 改造 | `lib/logger.ts` | `fs.appendFile` → `INSERT INTO request_logs` |
| 不变 | `hooks/use-auth.ts` | 客户端 localStorage 逻辑不变 |
| 不变 | `app/api/**/route.ts` | 函数签名不变 |
| 不变 | `middleware.ts` | Edge Runtime 不改 |

### 各模块改造要点

#### lib/db.ts

```ts
import { createClient } from "@supabase/supabase-js"

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,  // 服务端绕过 RLS
  { auth: { persistSession: false } }
)
```

#### lib/auth.ts

| 原函数 | 改造后 |
|--------|--------|
| `registerUser` | INSERT INTO users + INSERT INTO auth_tokens |
| `loginUser` | SELECT FROM users WHERE email=... + verify + INSERT INTO auth_tokens |
| `getUserByToken` | JOIN auth_tokens↔users WHERE token=... |
| `logoutToken` | DELETE FROM auth_tokens WHERE token=... |
| `authenticateUser` | 不变（调用 `getUserByToken`） |

#### lib/storage.ts

| 原函数 | 改造后 |
|--------|--------|
| `saveChat` | UPSERT INTO chats (messages JSONB, meta 字段) |
| `loadChat` | SELECT messages FROM chats WHERE id=... AND user_id=... |
| `listChats` | SELECT * FROM chats WHERE user_id=... ORDER BY updated_at DESC |
| `deleteChat` | DELETE FROM chats WHERE id=... AND user_id=... |
| `getChatMeta` | SELECT meta 字段 FROM chats WHERE id=... |
| `saveSummary` | UPDATE chats SET summary=..., summarized_count=... |
| `loadSummary` | SELECT summary, summarized_count FROM chats |
| `saveMemory` | INSERT ... ON CONFLICT (user_id, type, key) DO UPDATE |
| `loadAllMemories` | SELECT * FROM memories WHERE user_id=... |
| `searchMemories` | SELECT * FROM memories WHERE value ILIKE %query% |
| `listCustomTemplates` | SELECT * FROM prompt_templates WHERE user_id=... |
| `saveCustomTemplate` | UPSERT INTO prompt_templates |
| `deleteCustomTemplate` | DELETE FROM prompt_templates WHERE id=... AND user_id=... |

#### lib/rag.ts

| 原函数 | 改造后 |
|--------|--------|
| `embedAndStore` | INSERT INTO knowledge_docs + 批量 INSERT INTO knowledge_vectors |
| `listDocs` | SELECT * FROM knowledge_docs WHERE user_id=... |
| `deleteDoc` | DELETE FROM knowledge_docs WHERE id=... (CASCADE 删向量) |
| `retrieve` | `SELECT chunk, embedding <=> $query_vec AS distance FROM knowledge_vectors WHERE user_id=... ORDER BY distance LIMIT k` |

#### lib/mcp-config.ts

| 原函数 | 改造后 |
|--------|--------|
| `listMCPServers` | SELECT * FROM mcp_servers |
| `saveMCPServer` | UPSERT INTO mcp_servers |
| `deleteMCPServer` | DELETE FROM mcp_servers WHERE id=... |

#### lib/logger.ts

| 原函数 | 改造后 |
|--------|--------|
| `logRequest` | INSERT INTO request_logs |
| `getUsageStats` | SQL 聚合：`GROUP BY model, date_trunc('day', timestamp)` |

---

## 五、环境变量

`.env.local` 需包含以下变量：

```bash
# AI Gateway
AI_GATEWAY_API_KEY=...

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=...        # 服务端专用，绕过 RLS，切勿暴露给客户端
```

> `SUPABASE_SERVICE_ROLE_KEY` 可在 Supabase Dashboard → Settings → API → `service_role` secret 获取。

---

## 六、实施步骤

```
步骤 1  安装依赖
        npm install @supabase/supabase-js

步骤 2  确认环境变量
        检查 .env.local 包含 SUPABASE_URL + SERVICE_ROLE_KEY

步骤 3  创建迁移 SQL
        supabase/migrations/001_init_schema.sql
        （包含建表 + pgvector 扩展 + 索引）

步骤 4  应用迁移
        通过 supabase_apply_migration MCP 工具执行 SQL

步骤 5  新建 lib/db.ts
        Supabase 客户端单例

步骤 6  逐模块改造（顺序：auth → storage → rag → mcp-config → logger）
        每改一个模块跑 npx tsc --noEmit 验证

步骤 7  （可选）数据迁移脚本
        读 .data/ JSON → 写入 Supabase

步骤 8  删除文件存储代码
        确认无引用后清理 fs 相关 import
```

---

## 七、收益对比

| 维度 | 文件存储 | Supabase |
|------|---------|----------|
| 并发写 | 无锁，竞争条件 | ACID 事务 |
| 向量检索 | O(n) 全量扫描内存 | O(log n) HNSW 索引 |
| 多实例 | 不可能 | 天然支持 |
| 数据查询 | 读全量 JSON 过滤 | SQL 索引/聚合 |
| 部署 | 需持久卷 | 托管服务 |
| 可观测性 | 无 | Dashboard + 日志 |

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
| `GET/DELETE /api/chats/[id]` | `lib/storage.ts` — loadChat/deleteChat/getChatMeta/saveChat |
| `GET /api/knowledge` | `lib/rag.ts` — listDocs/deleteDoc |
| `POST /api/upload` | `lib/rag.ts` — embedAndStore |
| `GET /api/memory` | `lib/storage.ts` — loadAllMemories |
| `GET /api/prompt-templates` | `lib/storage.ts` — list/save/delete templates |
| `GET/POST/DELETE /api/mcp` | `lib/mcp-config.ts` — list/save/delete servers |
| `GET /api/stats` | `lib/logger.ts` — getUsageStats |
