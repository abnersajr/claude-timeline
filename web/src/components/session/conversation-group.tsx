import { useState } from "react"
import type { ConversationGroup } from "@/lib/grouping"
import { truncateText, groupTokensSummary } from "@/lib/grouping"

interface ConversationGroupProps {
  group: ConversationGroup
}

export function ConversationGroupCard({ group }: ConversationGroupProps) {
  const [expanded, setExpanded] = useState(false)

  const hasTools = group.toolExecutions.length > 0
  const responseCount = group.responses.length

  return (
    <div
      className={`rounded-lg border border-border/30 bg-surface-1/50 mb-2 overflow-hidden transition-colors hover:border-border/50 ${expanded ? "border-accent-purple/30" : ""}`}
    >
      <button
        type="button"
        className="flex items-center gap-2 w-full px-3.5 py-2.5 bg-transparent border-none text-text-primary cursor-pointer text-sm text-left hover:bg-surface-2/50"
        onClick={() => setExpanded((prev) => !prev)}
      >
        <span className="shrink-0 w-3.5 text-[10px] text-text-muted">
          {expanded ? "▼" : "▶"}
        </span>
        <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-text-secondary">
          {truncateText(group.userMessage.content)}
        </span>
        <span className="flex gap-1.5 shrink-0">
          {responseCount > 0 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] bg-surface-3 text-text-muted">
              {responseCount} response{responseCount !== 1 ? "s" : ""}
            </span>
          )}
          {hasTools && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] bg-accent-purple/15 text-accent-purple">
              {group.toolExecutions.length} tool
              {group.toolExecutions.length !== 1 ? "s" : ""}
            </span>
          )}
        </span>
      </button>

      <div className="flex gap-4 px-3.5 pb-2 pl-14 text-xs text-text-muted">
        <span className="font-mono">{groupTokensSummary(group)}</span>
        {group.cost > 0 && (
          <span className="font-mono text-accent-green">
            ${group.cost.toFixed(4)}
          </span>
        )}
      </div>

      {expanded && (
        <div className="px-3.5 pb-3.5 border-t border-border/30">
          <div className="mt-2.5 px-3 py-2.5 rounded-md text-[13px] leading-relaxed bg-accent-purple/8 border-l-[3px] border-accent-purple/40">
            <div className="text-[11px] uppercase tracking-wider text-text-muted mb-1">
              User
            </div>
            <div className="text-text-secondary whitespace-pre-wrap break-words">
              {group.userMessage.content}
            </div>
          </div>

          {group.responses.map((resp, i) => (
            <div
              key={`resp-${i}`}
              className="mt-2.5 px-3 py-2.5 rounded-md text-[13px] leading-relaxed bg-surface-2/30 border-l-[3px] border-border/50"
            >
              <div className="text-[11px] uppercase tracking-wider text-text-muted mb-1">
                Assistant
              </div>
              <div className="text-text-secondary whitespace-pre-wrap break-words">
                {resp.content || "(no text content)"}
              </div>
              {resp.toolCalls && resp.toolCalls.length > 0 && (
                <div className="mt-2 flex flex-col gap-1">
                  {resp.toolCalls.map((tc) => (
                    <div key={tc.id} className="flex items-center gap-2 text-xs">
                      <span className="px-1.5 py-0.5 rounded bg-accent-purple/12 text-accent-purple font-mono text-[11px]">
                        {tc.name}
                      </span>
                      {tc.arguments && (
                        <code className="text-[11px] text-text-muted bg-surface-2/50 px-1.5 py-0.5 rounded">
                          {truncateText(tc.arguments, 80)}
                        </code>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {hasTools && (
            <div className="mt-3">
              <h4 className="text-xs uppercase tracking-wider text-text-muted mb-2">
                Tool Executions
              </h4>
              {group.toolExecutions.map((tool) => (
                <div
                  key={tool.id}
                  className="px-2.5 py-2 border border-border/30 rounded-md mb-1.5"
                >
                  <span className="font-mono text-xs text-accent-purple">
                    {tool.name}
                  </span>
                  {tool.result && (
                    <pre className="mt-1.5 text-[11px] text-text-muted bg-black/20 p-2 rounded overflow-x-auto max-h-[120px]">
                      {truncateText(tool.result, 200)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-4 mt-3 pt-2 border-t border-border/30 text-[11px] font-mono text-text-muted">
            <span>Prompt: {group.tokens.prompt.toLocaleString()}</span>
            <span>Completion: {group.tokens.completion.toLocaleString()}</span>
            <span>Total: {group.tokens.total.toLocaleString()}</span>
          </div>
        </div>
      )}
    </div>
  )
}
