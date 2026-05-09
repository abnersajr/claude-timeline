import * as fs from "node:fs"
import minimist from "minimist"
import { extractFullTimeline } from "./merger"
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
    const { listSessions } = await import("./db-reader.js")
    const sessions = listSessions(config.dbPath)
    outputJSON(sessions, config.outputPath)
    return
  }

  const data = await extractFullTimeline(config.sessionId!, config.dbPath, config.projectsDir)
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
