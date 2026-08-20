# 自定义系统提示 (Custom System Prompt)

## 目标

让用户可以为**每个对话**单独设置助手角色，实现：
- 预设角色模板（通用 / 翻译 / 代码 / 写作 / 数据分析，共 5 个）
- 自定义角色模板（用户可创建、编辑、删除，持久化到 Supabase）
- 自定义系统提示（任意文本，覆盖模板）
- 每会话独立存储 & 切换
- 修改不影响历史消息（下次请求时新 system 生效）

## 技术方案

在会话元数据 `ChatMeta` 中存储 `systemPrompt?: string` 和 `promptTemplateId?: string`。后端在 `streamText({ system })` 时优先注入用户设置的 systemPrompt（与摘要 / 记忆 / 工具引导拼接）。

## 架构

```
  Chat 右上角 ⚙️ 齿轮
        │
        ▼ SystemPromptDialog
        │  ├─ 角色卡片网格（预设 5 个 + 自定义）
        │  ├─ 自定义系统提示 textarea
        │  └─ 新建/编辑/删除自定义角色
        │  [保存]
        ▼ PATCH /api/chats/{id}
             body: { systemPrompt, promptTemplateId }
        │
        ▼ storage.ts 更新 chats 表 (system_prompt + prompt_template_id 列)
        │
        ▼ 下一次 POST /api/chat
             读取 chatMeta.systemPrompt → 拼到 systemParts
```

## 修改 / 新增文件

```
lib/system-prompts.ts               # 5 个 PromptTemplate 预设定义
lib/storage.ts                       # ChatMeta 含 systemPrompt + promptTemplateId；自定义模板 CRUD
app/api/chats/[id]/route.ts          # PATCH 更新 systemPrompt + promptTemplateId
app/api/prompt-templates/route.ts    # 自定义模板 GET/POST/DELETE
components/chat.tsx                  # 右上角加 ⚙️ 按钮
components/system-prompt-dialog.tsx  # 角色设置弹窗
app/api/chat/route.ts                # 合并 chatMeta.systemPrompt 进 system
```

## 实现要点

### 1. 预设模板（lib/system-prompts.ts）

```ts
export interface PromptTemplate {
  id: string
  name: string
  icon: string        // lucide icon name
  description: string
  systemPrompt: string
}

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: "default",
    name: "通用助手",
    icon: "MessageSquare",
    description: "通用聊天助手",
    systemPrompt: "",       // 空字符串，无特殊设定
  },
  {
    id: "translator",
    name: "翻译官",
    icon: "Languages",
    description: "多语言翻译",
    systemPrompt:
      "你是一个专业翻译。用户发来的文本，请自动检测语言并翻译为中文。如果已是中文，翻译为英文。只返回翻译结果，不加解释。",
  },
  {
    id: "coder",
    name: "代码助手",
    icon: "Code",
    description: "编程问题解答",
    systemPrompt:
      "你是一个资深编程助手。请用简洁的代码示例回答，优先给出可运行的代码，解释放在代码后面。使用中文回答。",
  },
  {
    id: "writer",
    name: "写作教练",
    icon: "Pen",              // 注意：是 "Pen" 不是 "PenLine"
    description: "文章润色和创作",
    systemPrompt:
      "你是一个写作教练。帮助用户改善文章结构、用词和逻辑。指出问题并给出具体的修改建议，修改后的文本用代码块展示。",
  },
  {
    id: "analyst",
    name: "数据分析师",
    icon: "BarChart",         // 注意：是 "BarChart" 不是 "BarChart3"
    description: "数据分析与可视化建议",
    systemPrompt:
      "你是一个数据分析师。帮助用户分析数据、设计图表、编写 SQL 查询和数据处理代码。优先推荐简洁有效的方案。",
  },
]
```

### 2. 存储层（lib/storage.ts）

#### ChatMeta

```ts
export interface ChatMeta {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
  systemPrompt?: string       // 用户自定义 system prompt 原文
  promptTemplateId?: string   // 预设模板 id
}
```

对应 Supabase `chats` 表的 `system_prompt` 和 `prompt_template_id` 列。

#### 自定义模板 CRUD

自定义角色模板存储在 Supabase `prompt_templates` 表，按 `user_id` 隔离：

- `listCustomTemplates(userId?)` — 查询 `prompt_templates` 表，按 `created_at` 降序。
- `saveCustomTemplate(template, userId?)` — UPSERT 操作，存在则更新，否则插入。ID 格式 `tmpl-{timestamp}-{rand}`。
- `deleteCustomTemplate(templateId, userId?)` — 按 `id` + `user_id` 删除。

所有操作均通过 `.eq("user_id", userId ?? null)` 或 `.is("user_id", null)` 实现用户隔离。

### 3. PATCH API（app/api/chats/[id]/route.ts）

```ts
export async function PATCH(req, { params }) {
  const { id } = await params
  const user = await authenticateUser(req)
  const body = await req.json()
  const { systemPrompt, promptTemplateId } = body

  const meta = await getChatMeta(id, user?.id)
  const messages = await loadChat(id, user?.id)

  await saveChat(id, messages, meta?.title, systemPrompt, promptTemplateId, user?.id)
  return NextResponse.json({ success: true })
}
```

- 使用 `getChatMeta` 获取现有元数据（保留 title）。
- 使用 `loadChat` 获取现有消息（保留 messages）。
- 调用 `saveChat` 更新 `system_prompt` 和 `prompt_template_id` 列。

### 4. 后端注入 system（app/api/chat/route.ts）

```ts
if (chatIdStr) {
  try {
    const meta = await getChatMeta(chatIdStr, userId)
    if (meta?.systemPrompt) {
      systemParts.push(meta.systemPrompt)
    }
  } catch {
    // 忽略
  }
}
```

所有 system 部分用 `"\n\n---\n\n"` 连接：

```ts
const systemPrompt = systemParts.length > 0
  ? systemParts.join("\n\n---\n\n")
  : undefined
```

### 5. 拼接顺序

当同时存在「视觉降级提示」+「用户自定义 systemPrompt」+「摘要」+「长期记忆」+「工具引导」时，拼接顺序（越靠前越重要）：

1. **visualFallbackNote**（如适用）— 视觉模型降级提示
2. **chatMeta.systemPrompt** — 用户自定义提示词
3. **summarySystemPrompt** — 历史对话摘要
4. **用户记忆**（profile + preference）— 从 `loadAllMemories` 加载
5. **记忆工具引导** — save_memory / recall_memory 使用说明
6. **代码执行工具引导** — code_run 使用说明

每个部分之间用 `\n\n---\n\n` 分隔。

### 6. 前端弹窗（components/system-prompt-dialog.tsx）

- **触发**：Chat 右上角 ⚙️ `SettingsIcon` 按钮。
- **角色卡片网格**：预设 5 个 + 自定义模板，点击高亮选中，底部 textarea 自动填充模板 systemPrompt。
- **自定义 textarea**：行数 5，placeholder"输入你的助手人格、目标、输出风格要求等…"，可自由编辑覆盖模板内容。
- **新建/编辑/删除自定义角色**：
  - 点"新建角色"打开创建弹窗（名称 + 简介 + 系统提示）。
  - 预设模板可点编辑图标"基于此角色自定义"。
  - 自定义模板可编辑/删除（hover 显示操作按钮）。
- **保存**：`PATCH /api/chats/${chatId}` 传 `{ systemPrompt, promptTemplateId }`。
  - 若当前没有 chatId，会先 `POST /api/chats` 创建新会话再 PATCH，并跳转到 `/c/${id}`。
- **自定义模板管理**：通过 `/api/prompt-templates` 端点 GET/POST/DELETE。
