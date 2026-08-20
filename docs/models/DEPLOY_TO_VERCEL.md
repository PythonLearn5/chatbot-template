# 部署到 Vercel

本文档介绍如何将 chatbot-template 项目从本地部署到 Vercel。

---

## 前置条件

- 已安装 Node.js 18+
- 已注册 [Vercel 账号](https://vercel.com)
- 已在 [Vercel AI Gateway](https://vercel.com/ai-gateway) 获取 API Key
- 已创建 [Supabase](https://supabase.com) 项目

---

## 1. 安装 Vercel CLI

```bash
npm install -g vercel
```

检查安装：

```bash
vercel --version
```

---

## 2. 登录 Vercel

```bash
vercel login
```

按提示在浏览器中完成 Vercel 账号登录。

---

## 3. 进入项目目录

```bash
cd 你的项目目录
```

例如：

```bash
cd D:\GITHUB_python\chatbot-template
```

---

## 4. 关联 Vercel 项目

### 方式 A：关联已有项目

如果已在 Vercel Dashboard 上创建了项目：

```bash
vercel link
```

选择：

```text
Link to existing project? Yes
```

然后输入或选择你在 Vercel 上创建的项目名称。

### 方式 B：创建新项目

如果是全新部署，直接运行：

```bash
vercel
```

CLI 会自动检测 Next.js 项目并创建新项目。

---

## 5. 配置环境变量

### 所需环境变量

在 Vercel Dashboard → Settings → Environment Variables 中添加以下变量：

| 变量名 | 说明 | 示例值 |
|--------|------|--------|
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway API Key | `vck_xxxxxxxx` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 项目 URL | `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase 服务端密钥（**仅服务端使用，绕过 RLS**） | `eyJhbGciOi...` |

> **安全提示**：`SUPABASE_SERVICE_ROLE_KEY` 可绕过 RLS，**切勿暴露到前端代码**。本项目已通过 `"server-only"` 限制仅服务端引用。

> **注意**：本项目仅使用 `SUPABASE_SERVICE_ROLE_KEY`（服务端密钥），不使用 Supabase 公开发布密钥（`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`），因为所有数据库操作均在服务端完成。

### 拉取环境变量到本地

如果 Vercel 项目已配置好环境变量，可拉取到本地：

```bash
vercel env pull
```

会生成或更新 `.env.local` 文件。

### 通过 CLI 添加环境变量

也可以用命令行逐个添加：

```bash
vercel env add AI_GATEWAY_API_KEY
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add SUPABASE_SERVICE_ROLE_KEY
```

每个变量会提示选择环境：`Production`、`Preview`、`Development`（建议全选）。

---

## 6. 部署

### Preview 部署（测试）

```bash
vercel
```

部署完成后会得到一个 Preview URL：

```text
https://chatbot-template-xxx.vercel.app
```

### Production 正式部署

```bash
vercel --prod
```

部署完成后得到正式域名：

```text
https://你的项目.vercel.app
```

---

## 7. 验证部署

部署成功后，打开线上 URL 验证：

| 验证项 | 预期结果 |
|--------|----------|
| 访问首页 `/` | 显示聊天界面，无报错 |
| 注册/登录 | 邮箱+密码注册 → 登录成功 → 右上角显示用户名 |
| 新建对话 | 发送消息后收到 AI 回复 |
| 历史会话 | 侧边栏可看到创建的会话，点击可加载 |
| 知识库 `/knowledge` | 可上传文档、查看文档列表 |
| 用量统计 `/stats` | 显示请求数和 Token 用量 |

如果页面报 `AI_GATEWAY_API_KEY` 或 `SUPABASE_SERVICE_ROLE_KEY` 相关错误，回到步骤 5 检查环境变量配置。

---

## 8. Supabase 数据库初始化（首次部署）

首次部署前，确保 Supabase 项目已应用数据库迁移。

### 通过 Vercel MCP 工具应用

如果你在 Trae 中已关联 Supabase MCP，迁移 SQL 会自动应用。

### 手动应用

在 Supabase Dashboard → SQL Editor 中按顺序执行以下 3 个迁移文件：

1. `supabase/migrations/001_init_schema.sql` — 创建 9 张表 + pgvector 扩展 + HNSW 索引
2. `supabase/migrations/002_match_vectors.sql` — 创建 `match_knowledge_vectors` 向量检索 RPC 函数
3. `supabase/migrations/003_seed_mcp_servers.sql` — 插入 Toolkit MCP 种子数据

---

## 9. 自定义域名（可选）

在 Vercel Dashboard → Settings → Domains 中添加自定义域名：

1. 输入你的域名（如 `chat.example.com`）
2. 按提示在域名 DNS 服务商添加 CNAME 记录
3. 等待 DNS 生效后 Vercel 自动签发 SSL 证书

---

## 常用命令速查

```bash
vercel login        # 登录 Vercel
vercel link         # 关联已有项目
vercel env pull     # 拉取环境变量到 .env.local
vercel              # Preview 部署（生成临时 URL）
vercel --prod       # Production 正式部署
vercel logs         # 查看部署日志
vercel inspect      # 检查部署详情
vercel env ls      # 列出所有环境变量
vercel domains     # 管理自定义域名
```

---

## 常见问题

### Q: 部署后 API 报 500 错误

检查 Vercel 环境变量是否全部配置（尤其是 `SUPABASE_SERVICE_ROLE_KEY`）。在 Vercel Dashboard → Functions → Logs 查看详细错误。

### Q: 登录注册页面不工作

确认 `SUPABASE_SERVICE_ROLE_KEY` 已在 Vercel 环境变量中设置，且选择了 Production + Preview 环境。注册使用邮箱+密码方式。

### Q: 知识库上传后检索不到结果

确认 Supabase 已启用 pgvector 扩展，且 `002_match_vectors.sql` 迁移已应用。在 Supabase Dashboard → Table Editor 检查 `knowledge_vectors` 表是否有数据。

### Q: Supabase 连接超时

Supabase 免费版有连接数限制。如果部署后高并发下出现超时，考虑：
1. 升级 Supabase 到 Pro 计划
2. 检查连接池配置（Supabase → Settings → Connection Pooling）

### Q: 本地 `.env.local` 被提交到 Git

项目 `.gitignore` 已包含 `.env.local`，不会被提交。如果已被提交，运行：

```bash
git rm --cached .env.local
git commit -m "remove .env.local from tracking"
```
