# Agent 工作流 (Agent Workflow)

## 概述

本项目已实现多步 Agent 工作流，基于 AI SDK 的 `prepareStep` API 在每一步动态调整工具集，实现：

- 任务自动拆解（复杂请求 → 多个子任务）
- 按用户消息类型预判「步骤画像」（研究型 / 简单型 / 默认）
- 动态工具选择（不同步骤用不同工具集）
- 硬限制兜底（≥ 8 步禁用工具，最多 10 步强制结束）
- 避免无意义的「好的/嗯嗯」空步骤

## 涉及文件

```
lib/agent-steps.ts         # 步骤策略定义（纯函数模块）
app/api/chat/route.ts      # prepareStep 集成 + streamText 调用
```

## 核心类型

```ts
// lib/agent-steps.ts

export type StepStrategy = {
  maxSteps: number
  allowedTools?: string[] | null
  systemPromptOverride?: string
  stopAfterThisStep?: boolean
}

export type PrepareStepInput = {
  stepNumber: number
  steps: unknown[]
  firstUserMessage?: string
}

export type PrepareStepOutput = {
  tools: ToolSet | Record<string, never>
  stop?: boolean
  systemPrompt?: string
}
```

- `allowedTools` 三态语义：
  - `null` / `undefined` → 不裁剪（使用全量工具）
  - `string[]` → 仅保留列表中命名的工具
  - `[]`（空数组）→ 禁用所有工具（纯文本生成阶段）

## 关键词分类

### 研究类关键词 (RESEARCH_KEYWORDS)

```ts
const RESEARCH_KEYWORDS = [
  "调研", "对比", "比较", "研究", "报告", "综述", "趋势", "最新",
  "survey", "compare", "comparison", "research", "report", "benchmark",
  "vs", "versus",
]
```

### 简单问题关键词 (SIMPLE_KEYWORDS)

```ts
const SIMPLE_KEYWORDS = [
  "翻译", "解释", "怎么说", "什么意思", "缩写", "简写",
  "hello", "hi", "你好", "谢谢",
]
```

## 分类函数

### isSimpleQuestion

```ts
export function isSimpleQuestion(userMessage: string): boolean {
  if (userMessage.length <= 20) return true
  return hasAny(userMessage, SIMPLE_KEYWORDS)
}
```

判定逻辑：消息长度 ≤ 20 字符，**或**匹配任意简单关键词（大小写不敏感）。

### isResearchQuestion

```ts
export function isResearchQuestion(userMessage: string): boolean {
  return hasAny(userMessage, RESEARCH_KEYWORDS)
}
```

判定逻辑：匹配任意研究关键词（大小写不敏感）。

> `hasAny` 内部实现：将文本和关键词都 `toLowerCase()` 后用 `includes` 子串匹配。

## 步骤画像 planSteps

基于用户第一条消息预判「步骤画像」：

```ts
export function planSteps(userMessage: string): StepStrategy[] {
  if (isSimpleQuestion(userMessage)) {
    return [{ maxSteps: 2, allowedTools: null }]
  }
  if (isResearchQuestion(userMessage)) {
    return [
      { maxSteps: 3, allowedTools: ["web_search", "knowledge"] },
      { maxSteps: 2, allowedTools: [] },
    ]
  }
  return [{ maxSteps: 10, allowedTools: null }]
}
```

| 消息类型 | 步骤计划 | 说明 |
|----------|----------|------|
| 简单问题 | `[{ maxSteps: 2, allowedTools: null }]` | 最多 2 步，基本不需工具 |
| 研究类问题 | `[{ maxSteps: 3, allowedTools: ["web_search","knowledge"] }, { maxSteps: 2, allowedTools: [] }]` | 先搜索/知识库 3 步 → 纯文本生成 2 步 |
| 默认 | `[{ maxSteps: 10, allowedTools: null }]` | 最多 10 步自由发挥 |

## 阶段平铺 flattenSteps

`planSteps` 返回的是「阶段计划」，`flattenSteps` 将其平铺为每一步的策略表：

```ts
export function flattenSteps(plan: StepStrategy[]): StepStrategy[] {
  const flat: StepStrategy[] = []
  for (const phase of plan) {
    for (let i = 0; i < phase.maxSteps; i++) {
      flat.push({
        maxSteps: phase.maxSteps,
        allowedTools: phase.allowedTools,
        systemPromptOverride: phase.systemPromptOverride,
        stopAfterThisStep: false,
      })
    }
  }
  return flat
}
```

- 索引 0 对应 stepNumber=1
- 研究类问题平铺后为 5 步：`[search, search, search, text, text]`

## 核心：decidePrepareStep

`decidePrepareStep` 是 `prepareStep` 回调的实际实现，负责每一步的工具裁剪和停止判定。

```ts
export function decidePrepareStep(
  input: PrepareStepInput,
  allTools: ToolSet,
): PrepareStepOutput {
  const { stepNumber, steps, firstUserMessage } = input

  // 1) 先按画像算每步的允许列表（若取不到首条消息就不裁剪）
  let allowed: string[] | null = null
  if (firstUserMessage) {
    const flat = flattenSteps(planSteps(firstUserMessage))
    const step = flat[stepNumber - 1]
    if (step && typeof step.allowedTools !== "undefined" && step.allowedTools !== null) {
      allowed = step.allowedTools
    }
  }

  function filterTools(tools: ToolSet): ToolSet | Record<string, never> {
    if (allowed === null) return tools
    if (allowed.length === 0) return {}
    const next: Record<string, unknown> = {}
    const toolObj = tools as Record<string, unknown>
    for (const name of allowed) {
      if (toolObj[name]) next[name] = toolObj[name]
    }
    return next as ToolSet
  }

  // 2) 硬限制：>= 8 步不再用工具
  if (stepNumber >= 8) {
    const lastStep = steps[steps.length - 1] as { toolResults?: unknown[] } | undefined
    const hasToolResults =
      Array.isArray(lastStep?.toolResults) && lastStep!.toolResults!.length > 0
    return { tools: {}, stop: !hasToolResults }
  }

  const lastStep = steps[steps.length - 1] as { toolResults?: unknown[] } | undefined
  const hasToolResults =
    Array.isArray(lastStep?.toolResults) && lastStep!.toolResults!.length > 0

  if (hasToolResults) {
    return { tools: filterTools(allTools) }
  }

  if (stepNumber === 1) {
    return { tools: filterTools(allTools) }
  }

  return { tools: filterTools(allTools), stop: true }
}
```

### 执行流程

```
prepareStep(stepNumber, steps, firstUserMessage)
    │
    ├─ 1. 计算白名单 allowed
    │     flattenSteps(planSteps(firstUserMessage))[stepNumber-1]
    │     → null/undefined = 全量；[] = 禁用；string[] = 命名白名单
    │
    ├─ 2. 硬限制判定 (stepNumber >= 8)
    │     → 是: { tools: {}, stop: !hasToolResults }
    │        (有工具结果时给最后 1 步兜底，否则直接停止)
    │     → 否: 继续
    │
    ├─ 3. 上一步有 toolResults?
    │     → 是: { tools: filterTools(allTools) }  (继续下一步)
    │     → 否: 继续
    │
    ├─ 4. 是第 1 步?
    │     → 是: { tools: filterTools(allTools) }
    │     → 否: { tools: filterTools(allTools), stop: true }
    │        (避免无意义的「好的/嗯嗯」空步骤)
```

### filterTools 行为

| `allowed` 值 | 行为 |
|--------------|------|
| `null` | 返回全量工具（不裁剪） |
| `[]` | 返回 `{}`（禁用所有工具） |
| `["web_search","knowledge"]` | 仅保留这两个命名的工具 |

## chat 路由集成

### 首条用户消息抽取

```ts
// app/api/chat/route.ts

const firstUserMsg = messages.find((m) => (m as { role: string }).role === "user")
const firstUserText: string | undefined = (() => {
  if (!firstUserMsg) return undefined
  const parts = (firstUserMsg as { parts?: Array<{ type?: string; text?: string }> }).parts ?? []
  return parts
    .filter((p) => p?.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("") || undefined
})()
```

用于传入 `planSteps` 进行步骤画像预判。

### streamText 配置

```ts
const result = streamText({
  model: modelId,
  system: systemPrompt,
  messages: modelMessages,
  tools: tools as any,
  stopWhen: isStepCount(10),
  maxOutputTokens: MAX_OUTPUT_TOKENS,  // 8192
  abortSignal: req.signal,

  prepareStep: async (args: any) => {
    const stepNumber = (args?.stepNumber ?? 1) as number
    const steps = (args?.steps ?? []) as unknown[]
    return decidePrepareStep(
      { stepNumber, steps, firstUserMessage: firstUserText },
      tools as any
    ) as any
  },

  onEnd: async ({ usage }) => {
    await logRequest({
      timestamp: startTime,
      chatId: chatIdStr,
      userId,
      model: modelId,
      durationMs: Date.now() - startTime,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      totalTokens: usage?.totalTokens,
      status: "success",
    }).catch(() => {})
  },
})
```

## 关键常量

| 常量 | 值 | 位置 | 说明 |
|------|----|------|------|
| `stopWhen` | `isStepCount(10)` | `streamText` 参数 | 最多 10 步强制结束 |
| 硬工具禁用阈值 | `stepNumber >= 8` | `decidePrepareStep` | 第 8 步起禁用所有工具 |
| `MAX_OUTPUT_TOKENS` | `8192` | `app/api/chat/route.ts` | 单步最大输出 token |

## 完整工作流示例

```
用户："帮我调研 React 和 Vue 的对比，生成对比表格"
    │
    ▼ firstUserText 抽取
    │  匹配 "调研" → isResearchQuestion = true
    │  planSteps → [{3步, [web_search,knowledge]}, {2步, []}]
    │  flattenSteps → [search, search, search, text, text]
    │
    ▼ Step 1 (stepNumber=1)
    │  allowed = ["web_search", "knowledge"]
    │  filterTools → 保留 web_search + knowledge
    │  → 模型调用 web_search("React features")
    │  → 模型调用 web_search("Vue features")  (并行)
    │
    ▼ Step 2 (stepNumber=2)
    │  lastStep 有 toolResults → 继续
    │  filterTools → 保留 web_search + knowledge
    │  → 模型整合搜索结果，可能再调 knowledge 工具
    │
    ▼ Step 3 (stepNumber=3)
    │  lastStep 有 toolResults → 继续
    │  filterTools → 保留 web_search + knowledge
    │  → 模型分析对比点
    │
    ▼ Step 4 (stepNumber=4)
    │  allowed = [] (纯文本阶段)
    │  filterTools → {} (禁用所有工具)
    │  → 生成 Markdown 对比表格
    │
    ▼ Step 5 (stepNumber=5)
    │  lastStep 无 toolResults，stepNumber != 1
    │  → { tools: {}, stop: true }  (结束)
    │
    ▼ 最终回复
```

## 注意事项

- `prepareStep` 委托给纯函数 `decidePrepareStep`，方便单元测试
- 多步工作流消耗更多 token，已与速率限制模块（`lib/ratelimit.ts`）配合
- `stopWhen: isStepCount(10)` 防止无限循环
- 第 8 步起的硬限制确保即使逻辑出错也能在有限步内收敛
- 简单问题 2 步上限避免浪费 token；研究类问题分搜索/生成两阶段保证质量
- 若无法抽取首条用户消息（如纯图片消息），`allowed` 保持 `null`，等同于默认策略
