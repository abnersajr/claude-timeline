import * as fs from "node:fs"
import minimist from "minimist"
import { extractFullTimeline } from "./merger"
import type { FullTimelineSession } from "./types"
import { getDbPath, getProjectsDir } from "./utils"

/** CLI configuration */
export interface Config {
  sessionId: string
  dbPath: string
  projectsDir: string
  outputPath: string | null
}

/**
 * Parse CLI arguments.
 * Required: --session-id
 * Optional: --db-path, --projects-dir, --output
 */
export function parseArgs(argv: string[]): Config {
  const args = minimist(argv.slice(2))

  if (!args["session-id"]) {
    throw new Error(
      "Error: --session-id is required.\n" +
        "Usage: tsx src/index.ts --session-id <id> [options]\n" +
        "Options:\n" +
        "  --db-path <path>        SQLite DB path (default: ~/.claude/usage.db)\n" +
        "  --projects-dir <path>   Projects directory (default: ~/.claude/projects)\n" +
        "  --output <path>         Write JSON to file instead of stdout",
    )
  }

  return {
    sessionId: args["session-id"],
    dbPath: args["db-path"] || getDbPath(),
    projectsDir: args["projects-dir"] || getProjectsDir(),
    outputPath: args.output || null,
  }
}

/**
 * Output JSON to stdout or file.
 */
export function outputJSON(data: FullTimelineSession, outputPath: string | null): void {
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
  const data = await extractFullTimeline(config.sessionId, config.dbPath, config.projectsDir)
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
