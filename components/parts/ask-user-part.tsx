import { type AskUserToolPart } from "@/tools"

export function AskUserPart({ part }: { part: AskUserToolPart }) {
  if (part.state !== "output-available" || !part.output) {
    return null
  }

  return (
    <div className="typeset typeset-docs px-1">
      <ol>
        {part.output.map((entry: any) => (
          <li key={entry.question}>
            <span className="text-muted-foreground">{entry.question}</span>{" "}
            <span className="font-medium text-foreground">{entry.answer}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
