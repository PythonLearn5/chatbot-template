# 自定义系统提示 (Custom System Prompt)

## 目标

让用户可以为**每个对话**单独设置助手角色，实现：
- 预设角色模板（通用 / 翻译 / 代码 / 写作 / 数据分析，共 5 个）
- 自定义系统提示（任意文本，覆盖模板）
- 每会话独立存储 & 切换
- 修改不影响历史消息（下次请求时新 system 生效）

## 技术方案

在会话元数据 `ChatMeta` 中存储 `systemPrompt?: string` 和 `promptTemplateId?: string`。后端在 `streamText({ system })` 时优先注入用户设置的 systemPrompt（与摘要 / 记忆 / RAG 上下文拼接）。

## 架构

```
  Chat 右上角 ⚙️ 齿轮
        │
        ▼ SystemPromptDialog
        │  ├─ Tab 1：预设（5 张卡片）
        │  └─ Tab 2：自定义 textarea
        │  [保存]
        ▼ PATCH /api/chats/{id}
             body: { systemPrompt, promptTemplateId }
        │
        ▼ storage.ts 更新 .data/.../chats/{id}.meta.json
        │
        ▼ 下一次 POST /api/chat
             读取 chatMeta.systemPrompt → 拼到 streamText.system 最前面
```

## 修改 / 新增文件

```
lib/system-prompts.ts        # 5 个 PromptTemplate 定义
lib/storage.ts               # ChatMeta 加 systemPrompt + promptTemplateId
app/api/chats/[id]/route.ts  # PATCH 更新两个字段
components/chat.tsx          # 右上角加 ⚙️ 按钮（PromptForm 右侧）
components/system-prompt-dialog.tsx  # 新弹窗
app/api/chat/route.ts        # 合并 chatMeta.systemPrompt 进 system
```

## 实现要点

### 1. 预设模板

```ts
// lib/system-prompts.ts
export interface PromptTemplate {
  id: string
  name: string
  icon: string  // lucide icon name
  description: string
  systemPrompt: string
}

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: "default",
    name: "通用助手",
    icon: "MessageSquare",
    description: "通用多领域聊天助手",
    systemPrompt: "",
  },
  {
    id: "translator",
    name: "翻译官",
    icon: "Languages",
    description: "中英互译 + 保留原文格式",
    systemPrompt:
      "你是一个专业翻译。用户输入任何语言都翻译成简体中文；中文翻译成英语。要求：保留术语，不随意删改，如遇专有名词加注。",
  },
  {
    id: "coder",
    name: "代码助手",
    icon: "Code",
    description: "编程问题 + 可运行代码示例",
    systemPrompt:
      "你是资深编程助手。用户提问先给一段可运行的简洁代码示例，解释跟在后面。语言/框架不明确时先问清楚再作答。",
  },
  {
    id: "writer",
    name: "写作教练",
    icon: "PenLine",
    description: "文章润色 / 逻辑梳理 / 改写",
    systemPrompt:
      "你是中文写作教练。帮助用户改善文章结构、用词和逻辑：分 ①结构问题 ②表达问题 ③修改建议三部分列出，最后附上润色版本。",
  },
  {
    id: "analyst",
    name: "数据分析",
    icon: "BarChart3",
    description: "数据解读 / 表格 / SQL 建议",
    systemPrompt:
      "你是数据分析顾问。用户给出数据/问题后，先列出核心指标与趋势，再给结论与建议；需要 SQL 时给出可运行的 SQL 示例和字段解释。",
  },
]
```

### 2. 存储层（ChatMeta）

```ts
// lib/storage.ts
export interface ChatMeta {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  systemPrompt?: string       // 新增：用户自定义 system prompt 原文
  promptTemplateId?: string   // 新增：预设模板 id（custom 模式下可空）
}
```

### 3. PATCH API

```ts
// app/api/chats/[id]/route.ts
export async function PATCH(req, { params }) {
  const user = await authenticateUser(req)
  const id = (await params).id
  const body = await req.json()
  const meta = await getChatMeta(id, user?.id)
  if (!meta) return Response.json({ error: "Not found" }, { status: 404 })

  if (typeof body.systemPrompt === "string") meta.systemPrompt = body.systemPrompt
  if (typeof body.promptTemplateId === "string") meta.promptTemplateId = body.promptTemplateId

  await saveChatMeta(id, meta, user?.id)
  return Response.json({ ok: true, meta })
}
```

### 4. 后端注入 system

```ts
// app/api/chat/route.ts
const chatMeta = chatIdStr ? await getChatMeta(chatIdStr, userId) : undefined
const systemParts: string[] = []
if (chatMeta?.systemPrompt) {
  systemParts.push(`# 角色设定\n${chatMeta.systemPrompt}`)
}
// 追加：摘要 / 长期记忆 / RAG
return systemParts.join("\n\n---\n\n")
```

### 5. 前端弹窗 SystemPromptDialog

- 顶部 Tabs：`预设模板` / `自定义`
- 「预设」：5 个卡片（图标+名字+简介），点击高亮，底部显示模板 system prompt
- 「自定义」：textarea（行数 8，placeholder"输入你的助手人格/目标/输出风格..."）
- 底部 `取消 / 保存`；保存时 `PATCH /api/chats/${chatId}` 并更新当前 `chat.systemPrompt` 缓存

按钮位置：在 `components/chat.tsx` 中，PromptForm 右上角（输入框右侧）放 ⚙️ `SettingsIcon`，点击打开 Dialog。

## 与其他模块冲突的解决顺序

当同时存在「预设模板 systemPrompt」 + 「摘要」 + 「长期记忆上下文」 + 「RAG 检索结果」时，拼接顺序（越靠前越重要）：

1. 角色设定（用户设置）
2. 历史对话摘要（Phase 2）
3. 长期记忆（recall_memory 命中）
4. RAG 相关上下文

每个模块之间用 `\n\n---\n\n` 分隔。
