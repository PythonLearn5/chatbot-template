import { KeyRoundIcon, TriangleAlertIcon } from "lucide-react"

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"

export function SetupNotice({ isAuthError }: { isAuthError: boolean }) {
  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      {isAuthError ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <KeyRoundIcon />
            </EmptyMedia>
            <EmptyTitle>Connect the AI Gateway</EmptyTitle>
            <EmptyDescription>
              This template needs an AI Gateway credential. Vercel deployments
              authenticate automatically via OIDC. For local development,
              either run <code>vercel env pull</code> after linking your
              project, or create an{" "}
              <a
                className="underline underline-offset-4"
                href="https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai-gateway%2Fapi-keys"
                target="_blank"
                rel="noreferrer"
              >
                API key
              </a>{" "}
              and add it to <code>.env.local</code>:
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <pre className="rounded-xl bg-muted px-4 py-3 text-left font-mono text-xs">
              AI_GATEWAY_API_KEY=your-key-here
            </pre>
          </EmptyContent>
        </Empty>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <TriangleAlertIcon />
            </EmptyMedia>
            <EmptyTitle>AI Gateway unavailable</EmptyTitle>
            <EmptyDescription>
              Could not load models from the AI Gateway. Check your network
              connection and credentials, then reload the page.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  )
}
