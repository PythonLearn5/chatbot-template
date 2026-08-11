# Chatbot Template

A minimal chatbot template built with Next.js, the [AI SDK](https://ai-sdk.dev), [shadcn/ui](https://ui.shadcn.com), [shadcn/react]([https://ui.shadcn.com](https://ui.shadcn.com/docs/react/message-scroller)), [shadcn/typeset]([https://ui.shadcn.com](https://ui.shadcn.com/typeset))and the [Vercel AI Gateway](https://vercel.com/docs/ai-gateway).

## Features

- Streaming chat with markdown rendering and shadcn/typeset
- Tool calling example
- Web search via each provider's built-in search tool
- Human-in-the-loop questionnaire. The model can ask clarifying questions, answered with the shadcn questionnaire component

## Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fshadcn-ui%2Fchatbot-template&project-name=chatbot-template&repository-name=chatbot-template)

Deploy the template to Vercel, then enable the **AI Gateway** for the project in your dashboard. Deployments authenticate to the gateway automatically via OIDC.

## Local development

```bash
pnpm install
```

Then give the app a gateway credential, either by pulling an OIDC token from your linked Vercel project:

```bash
vercel link
vercel env pull
```

or by creating an API key in the Vercel dashboard (**AI Gateway → API Keys**) and adding it to `.env.local`:

```bash
cp .env.example .env.local
# then set AI_GATEWAY_API_KEY=...
```

Start the dev server:

```bash
pnpm dev
```

## Configuration

| Env var              | Required       | Description                                                  |
| -------------------- | -------------- | ------------------------------------------------------------ |
| `AI_GATEWAY_API_KEY` | Local dev only | AI Gateway API key. Not needed on Vercel deployments (OIDC). |

The model list lives in [lib/models.ts](lib/models.ts) — the first entry is the default model.

## How it works

- [app/page.tsx](app/page.tsx) fetches the model catalog server-side with `gateway.getAvailableModels()` and renders the chat, or a setup notice if no credential is configured.
- [app/api/chat/route.ts](app/api/chat/route.ts) streams responses with `streamText` — plain `"provider/model"` strings route through the AI Gateway automatically.
- [components/chat.tsx](components/chat.tsx) renders the conversation with `useChat` and shadcn chat primitives.
- [lib/tools.ts](lib/tools.ts) defines the tools: a server-executed GitHub repo lookup, the interactive `ask_user` questionnaire, and provider-native web search.

## Adding components

```bash
npx shadcn@latest add button
```

## License

MIT — see [LICENSE](LICENSE).
