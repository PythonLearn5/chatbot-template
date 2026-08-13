# Agent 工作流 (Agent Workflow)

## 目标

将当前单轮工具调用循环升级为多步 Agent 工作流，实现：
- 任务自动拆解（复杂请求 → 多个子任务）
- 条件分支（根据结果选择不同执行路径）
- 并行工具调用
- 动态工具选择（不同步骤用不同工具集）

## 技术方案

使用 AI SDK 7 内置的 `prepareStep` API，在每一步动态调整工具集、消息和上下文。

## 架构

```
用户："帮我调研 React 和 Vue 的对比，生成对比表格"
    │
    ▼ Step 1: 任务分析
    │  prepareStep → 识别为多步任务
    │  → 调用 web_search("React features 2026")
    │  → 调用 web_search("Vue features 2026")  (并行)
    │
    ▼ Step 2: 信息整合
    │  prepareStep → 合并两个搜索结果
    │  → 模型分析对比点
    │
    ▼ Step 3: 生成输出
    │  prepareStep → 只保留 text 输出工具
    │  → 生成 Markdown 对比表格
    │
    ▼ 最终回复
```

## 修改文件

```
app/api/chat/route.ts   # 添加 prepareStep
lib/agent-steps.ts      # 步骤策略定义
```

## 实现要点

### 1. prepareStep 配置

```ts
// app/api/chat/route.ts
const result = streamText({
  model: modelId,
  system: systemPrompt,
  messages: modelMessages,
  tools,
  stopWhen: isStepCount(10),  // 增加到 10 步
  maxOutputTokens: MAX_OUTPUT_TOKENS,
  abortSignal: req.signal,

  // Phase: Agent 工作流 — 每步动态调整
  prepareStep: async ({ steps, stepNumber, messages: stepMessages }) => {
    // 第 1 步：允许所有工具
    if (stepNumber === 1) {
      return { tools }
    }

    // 如果上一步有工具调用结果，判断是否需要继续
    const lastStep = steps[steps.length - 1]
    const hasToolResults = lastStep?.toolResults?.length > 0

    if (hasToolResults) {
      // 有工具结果时，继续生成（可能再调工具或输出文本）
      return {
        tools,
        // 可以覆盖消息（比如注入总结提示）
      }
    }

    // 无工具调用时，结束循环
    return {
      tools,
      stop: true,
    }
  },
})
```

### 2. 步骤策略

```ts
// lib/agent-steps.ts
export type StepStrategy = {
  maxSteps: number
  allowedTools?: string[]      // 该步允许的工具
  systemPromptOverride?: string
  stopAfterThisStep?: boolean
}

export function planSteps(userMessage: string): StepStrategy[] {
  const steps: StepStrategy[] = []

  // 简单问题：1-2 步
  if (isSimpleQuestion(userMessage)) {
    steps.push({ maxSteps: 2, allowedTools: undefined })
    return steps
  }

  // 研究类问题：搜索 → 分析 → 生成
  if (isResearchQuestion(userMessage)) {
    steps.push({ maxSteps: 3, allowedTools: ["web_search", "knowledge"] })
    steps.push({ maxSteps: 2, allowedTools: [] })  // 只输出
    return steps
  }

  // 默认：最多 10 步
  return [{ maxSteps: 10 }]
}
```

### 3. 并行工具调用

AI SDK 7 原生支持模型返回多个 tool-call 在同一步骤中并行执行：

```ts
// 模型可以一次返回多个工具调用
// streamText 会并行执行所有 execute 函数
// 结果一起返回给模型进行下一步
```

## 注意事项

- `prepareStep` 是 AI SDK 7 的新 API，需要确认版本兼容性
- 多步工作流消耗更多 token，需要与速率限制配合
- `stopWhen: isStepCount(10)` 防止无限循环
- 每步的 `runtimeContext` 可在步骤间传递状态
