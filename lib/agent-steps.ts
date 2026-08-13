import type { ToolSet } from "ai"

/**
 * Agent 步骤策略定义
 * ------------------------------
 * 从 AGENT_WORKFLOW.md 设计文档抽离的独立策略模块，
 * 负责：
 * 1) 按用户消息类型预判「步骤画像」（研究型 / 简单型 / 默认）
 * 2) 按 stepNumber 动态裁剪可用工具集（prepareStep 的返回值计算）
 * 3) 暴露给上层 (app/api/chat/route.ts) 作为纯函数
 */

export type StepStrategy = {
  maxSteps: number
  allowedTools?: string[] | null
  systemPromptOverride?: string
  stopAfterThisStep?: boolean
}

const RESEARCH_KEYWORDS = [
  "调研", "对比", "比较", "研究", "报告", "综述", "趋势", "最新",
  "survey", "compare", "comparison", "research", "report", "benchmark",
  "vs", "versus",
]

const SIMPLE_KEYWORDS = [
  "翻译", "解释", "怎么说", "什么意思", "缩写", "简写",
  "hello", "hi", "你好", "谢谢",
]

function hasAny(text: string, words: string[]) {
  const lower = text.toLowerCase()
  return words.some((w) => lower.includes(w.toLowerCase()))
}

export function isSimpleQuestion(userMessage: string): boolean {
  if (userMessage.length <= 20) return true
  return hasAny(userMessage, SIMPLE_KEYWORDS)
}

export function isResearchQuestion(userMessage: string): boolean {
  return hasAny(userMessage, RESEARCH_KEYWORDS)
}

/**
 * 基于用户第一条消息预判「步骤画像」
 *   - 简单问题：最多 2 步（基本不需工具，或 1 次工具立刻收敛）
 *   - 研究类问题：先搜索/知识库 3 步 → 纯文本生成 2 步
 *   - 默认：最多 10 步自由发挥
 */
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

/**
 * 把 planSteps 的「阶段计划」平铺为每一步的策略表
 * 索引 0 对应 stepNumber=1
 */
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

/**
 * 通用 prepareStep 动态工具裁剪
 * ------------------------------
 * 逻辑：
 *  - ≥ 8 步：禁止工具（强制出文本兜底），若还有未完成的 toolResults 就再给最后 1 步
 *  - 有 toolResults → 继续下一步（模型可能还想调工具/综合结果）
 *  - 第 1 步：允许所有工具
 *  - 之后若没有 toolResults：结束（stop: true），避免无意义的「好的/嗯嗯」空步骤
 *
 *  同时叠加 planSteps 的 allowedTools 白名单：
 *   - null/undefined：不裁剪（用全量）
 *   - string[]：仅保留列表中命名的工具
 *   - [] ：禁用所有工具（纯文本生成阶段）
 */
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
