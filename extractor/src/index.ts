import * as fs from "node:fs"
import * as path from "node:path"
import minimist from "minimist"
import { extractFullTimeline, extractJsonlTimeline } from "./merger"
import type { FullTimelineSession } from "./types"
import { getDbPath, getProjectsDir } from "./utils"

/** CLI configuration */
export interface Config {
  sessionId: string | null
  dbPath: string
  projectsDir: string
  outputPath: string | null
  listSessions: boolean
}

/**
 * Parse CLI arguments.
 * Required: --session-id
 * Optional: --db-path, --projects-dir, --output
 */
export function parseArgs(argv: string[]): Config {
  const args = minimist(argv.slice(2))

  const listSessions = Boolean(args["list-sessions"])

  if (!listSessions && !args["session-id"]) {
    throw new Error(
      "Error: --session-id is required (or use --list-sessions).\n" +
        "Usage: tsx src/index.ts --session-id <id> [options]\n" +
        "       tsx src/index.ts --list-sessions\n" +
        "Options:\n" +
        "  --db-path <path>        SQLite DB path (default: ~/.claude/usage.db)\n" +
        "  --projects-dir <path>   Projects directory (default: ~/.claude/projects)\n" +
        "  --output <path>         Write JSON to file instead of stdout\n" +
        "  --list-sessions         List recent sessions and exit",
    )
  }

  return {
    sessionId: args["session-id"] || null,
    dbPath: args["db-path"] || getDbPath(),
    projectsDir: args["projects-dir"] || getProjectsDir(),
    outputPath: args.output || null,
    listSessions,
  }
}

/**
 * Output JSON to stdout or file.
 */
export function outputJSON(data: FullTimelineSession | unknown[], outputPath: string | null): void {
  const json = JSON.stringify(data, null, 2)

  if (outputPath) {
    try {
      fs.writeFileSync(outputPath, json, "utf-8")
      console.log(`Output written to: ${outputPath}`)
    } catch (err) {
      console.error(`Failed to write output file: ${outputPath}`)
      console.error(String(err))
      // Fallback to stdout
      console.log(json)
    }
  } else {
    console.log(json)
  }
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  const config = parseArgs(process.argv)

  if (config.listSessions) {
    const { listSessions, listJsonlSessions } = await import("./db-reader.js")
    const dbSessions = listSessions(config.dbPath)
    const jsonlSessions = listJsonlSessions(config.projectsDir, config.dbPath)
    const seen = new Set(dbSessions.map((s) => s.sessionId))
    const merged = [...dbSessions]
    for (const s of jsonlSessions) {
      if (!seen.has(s.sessionId)) {
        merged.push(s)
        seen.add(s.sessionId)
      }
    }
    merged.sort((a, b) => b.lastTimestamp.localeCompare(a.lastTimestamp))
    outputJSON(merged, config.outputPath)
    return
  }

  const sessionId = config.sessionId!

  // Try SQLite + JSONL merge first, fall back to JSONL-only
  let data: FullTimelineSession
  try {
    data = await extractFullTimeline(sessionId, config.dbPath, config.projectsDir)
  } catch (err: unknown) {
    if ((err as { code?: number }).code === 2) {
      // Session not in SQLite — find JSONL file
      let foundPath: string | null = null
      for (const dir of fs.readdirSync(config.projectsDir)) {
        const candidate = path.join(config.projectsDir, dir, `${sessionId}.jsonl`)
        if (fs.existsSync(candidate)) {
          foundPath = candidate
          break
        }
      }
      if (foundPath) {
        data = await extractJsonlTimeline(sessionId, config.projectsDir, foundPath)
      } else {
        throw err
      }
    } else {
      throw err
    }
  }

  outputJSON(data, config.outputPath)
}

// Run on direct execution only
const isMainModule =
  import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("index.ts")

if (isMainModule) {
  main().catch((err) => {
    console.error(String(err))
    process.exit(1)
  })
}
