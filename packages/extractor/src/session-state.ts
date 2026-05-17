import type { RawJsonlRecord } from "./types"

// ─── Activity Types ────────────────────────────────────────────────

/** Classification of a record's activity role in session flow */
type ActivityType =
  | "text_output"
  | "thinking"
  | "tool_use"
  | "tool_result"
  | "interruption"
  | "other"

// ─── Activity Classification ──────────────────────────────────────

/**
 * Classify a single record into an activity type.
 * Used to determine ending events vs continuing AI activities.
 */
function classifyActivity(record: RawJsonlRecord): ActivityType {
  const { type, message, isMeta } = record

  // Interruption: user message with "[Request interrupted by user]"
  if (type === "user") {
    const content = message?.content
    if (typeof content === "string" && content === "[Request interrupted by user]") {
      return "interruption"
    }
  }

  // Assistant messages
  if (type === "assistant" && message?.content) {
    const content = message.content

    if (Array.isArray(content)) {
      // Check for tool_use blocks
      if (content.some((b) => b.type === "tool_use")) return "tool_use"
      // Check for thinking blocks
      if (content.some((b) => b.type === "thinking")) return "thinking"
      // Check for text blocks (text output)
      if (content.some((b) => b.type === "text")) return "text_output"
    }
  }

  // User meta messages with tool_result blocks
  if (type === "user" && isMeta) {
    return "tool_result"
  }

  return "other"
}

// ─── Ending Events ────────────────────────────────────────────────

/** Ending events: text_output or interruption */
function isEndingEvent(activity: ActivityType): boolean {
  return activity === "text_output" || activity === "interruption"
}

/** AI activities that indicate the session is still in progress */
function isAiActivity(activity: ActivityType): boolean {
  return activity === "thinking" || activity === "tool_use" || activity === "tool_result"
}

// ─── Session State Detection ──────────────────────────────────────

/**
 * Detect whether a session is ongoing (AI still working) vs completed.
 *
 * Algorithm:
 * 1. Classify each record into an activity type
 * 2. Find the last ending event (text_output or interruption)
 * 3. Check if any AI activities exist after that ending event
 * 4. If AI activities exist after the last ending event → ongoing
 * 5. If no AI activities after last ending event → completed
 * 6. If no ending events exist → not ongoing (empty or all AI activities)
 *
 * Special case: interruption is always treated as an ending event,
 * and no AI activities are expected to follow it in practice.
 */
export function detectSessionState(records: RawJsonlRecord[]): { isOngoing: boolean } {
  if (records.length === 0) {
    return { isOngoing: false }
  }

  // Classify all records
  const activities = records.map(classifyActivity)

  // Find the last ending event index
  let lastEndingIndex = -1
  for (let i = activities.length - 1; i >= 0; i--) {
    if (isEndingEvent(activities[i])) {
      lastEndingIndex = i
      break
    }
  }

  // No ending event found → not ongoing (session has no natural end point yet)
  if (lastEndingIndex === -1) {
    return { isOngoing: false }
  }

  // Check if any AI activities exist after the last ending event
  for (let i = lastEndingIndex + 1; i < activities.length; i++) {
    if (isAiActivity(activities[i])) {
      return { isOngoing: true }
    }
  }

  return { isOngoing: false }
}
