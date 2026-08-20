# 模型注册表 (Model Registry)

本文档描述项目支持的 AI 模型列表、模型选择逻辑及相关接口。

---

## 一、位置

模型注册表位于 `lib/models.ts`。

---

## 二、模型列表（17 个模型，10 个提供商）

### 旗舰模型

| ID | 名称 | 说明 |
|----|------|------|
| `anthropic/claude-opus-5` | Claude Opus 5 | Anthropic 最强旗舰 · $5/$25 |
| `anthropic/claude-sonnet-5` | Claude Sonnet 5 | Anthropic 性能旗舰 · $2/$10 |
| `openai/gpt-5.6-sol` | GPT 5.6 Sol | OpenAI 旗舰 · $5/$30 |
| `openai/gpt-5.6-terra` | GPT 5.6 Terra | OpenAI 均衡版 · $2/$12 |
| `xai/grok-4.6` | Grok 4.6 | xAI 最新旗舰 · $2/$6 |
| `google/gemini-3.7-flash` | Gemini 3.7 Flash | Google 最新 · $1.50/$7.50 |

### 中端 / 高性价比

| ID | 名称 | 说明 |
|----|------|------|
| `openai/gpt-5.6-luna` | GPT 5.6 Luna | OpenAI 经济版 · $0.20/$1.20 |
| `deepseek/deepseek-v4-pro-0813` | DeepSeek V4 Pro | DeepSeek 最新 · $0.60/$1.98 |
| `google/gemini-3.5-flash-lite` | Gemini 3.5 Flash Lite | Google 轻量 · $0.30/$2.50 |
| `alibaba/qwen3.7-flash` | Qwen 3.7 Flash | 阿里云高性价比 · $0.03/$0.13 |
| `alibaba/qwen3.8-max` | Qwen 3.8 Max | 阿里云旗舰 · $2/$6 |
| `moonshotai/kimi-k3` | Kimi K3 | 月之暗面旗舰 · $3/$15 |

### 免费模型（5 个）

| ID | 名称 | 说明 |
|----|------|------|
| `alibaba/qwen3.8-27b` | Qwen 3.8 27B (Free) | 阿里云开源 · 免费 |
| `nvidia/nemotron-3.5-lightning` | Nemotron 3.5 Lightning (Free) | NVIDIA 开源 · 免费 |
| `poolside/laguna-s-2.1-free` | Laguna S 2.1 (Free) | Poolside 开源 · 免费 |
| `inclusionai/ling-3.0-tiny-free` | Ling 3.0 Tiny (Free) | InclusionAI · 免费 |
| `inclusionai/ling-3.0-flash-free` | Ling 3.0 Flash (Free) | InclusionAI · 免费 |

---

## 三、关键值

```ts
export const DEFAULT_MODEL = "alibaba/qwen3.8-27b"  // 默认模型（免费）
```

- 模型 ID 格式：`"provider/model-name"`（Vercel AI Gateway 约定）
- 默认模型为免费的 `alibaba/qwen3.8-27b`

---

## 四、函数

### isModelAllowed(id: string): boolean

检查模型 ID 是否在 `MODELS` 数组中：

```ts
export function isModelAllowed(id: string) {
  return MODELS.some((model) => model.id === id)
}
```

在 `app/api/chat/route.ts` 中用于验证用户请求的模型是否可用：

```ts
if (!isModelAllowed(modelId)) {
  return Response.json({ error: `Model ${modelId} is not available.` }, { status: 400 })
}
```

### GatewayModel 接口

```ts
export interface GatewayModel {
  id: string
  name: string
  description?: string
}
```

---

## 五、模型选择 UI

### components/model-select.tsx

下拉选择组件，数据从 `MODELS` 数组填充。按分组显示：

```ts
function buildGroups(models: GatewayModel[]) {
  const free = models.filter((m) => m.name.includes("(Free)"))
  const paid = models.filter((m) => !m.name.includes("(Free)"))
  const flagship = paid.filter((m) =>
    m.id.includes("opus") || m.id.includes("sonnet") || m.id.includes("sol") ||
    m.id.includes("terra") || m.id.includes("grok") || m.id.includes("gemini-3.7") ||
    m.id.includes("qwen3.8-max") || m.id.includes("kimi-k3")
  )
  const midRange = paid.filter((m) => !flagship.includes(m))
  return [
    { label: "旗舰模型", items: flagship },
    { label: "高性价比", items: midRange },
    { label: "免费模型", items: free },
  ].filter((g) => g.items.length > 0)
}
```

- 每个选项显示模型名称 + 价格描述
- `useChat` 的 `sendMessage` 自动附带当前选中的模型 ID

---

## 六、添加新模型

编辑 `lib/models.ts` 的 `MODELS` 数组：

```ts
{ id: "provider/model-name", name: "Display Name", description: "description" }
```

- `id`：遵循 `provider/model-name` 格式
- `name`：显示名称，免费模型在名称中加 `(Free)` 以自动分组
- `description`：简短描述，通常包含价格信息

添加后无需修改其他文件，`isModelAllowed` 和前端 `ModelSelect` 会自动识别新模型。

---

## 七、视觉模型前缀

- `openai/` 前缀 — 支持图片输入
- `anthropic/` 前缀 — 支持图片输入（但通过 Gateway 发送图片时可能触发 beta header 冲突，会自动降级到 `openai/gpt-5.6-terra`）
- 其他前缀 — 仅支持文本

---

## 八、网页搜索可用性

`tools/web_search.ts` 中的 `getWebSearch(modelId)` 根据模型前缀决定搜索实现：

| 模型前缀 | 搜索实现 |
|----------|----------|
| `openai/` | `openai.tools.webSearch()` |
| `anthropic/` | `anthropic.tools.webSearch_20260209()` |
| 其他 | `FALLBACK_WEB_SEARCH`（返回空结果） |

不支持原生搜索的模型会使用 fallback 工具，返回空结果而非报错。
