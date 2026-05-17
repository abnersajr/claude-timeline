/**
 * claude-timeline CLI — built with Commander.js
 *
 *   npx claude-timeline                  → opens browser with timeline
 *   npx claude-timeline serve [--port]   → start server only
 *   npx claude-timeline extract --session-id <id> → extract to JSON
 *   npx claude-timeline list             → list available sessions
 *   npx claude-timeline setup            → install cost-capture statusline
 */
import { execSync } from "node:child_process"
import { existsSync, readdirSync, statSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs"
import * as fs from "node:fs"
import * as path from "node:path"
import { homedir } from "node:os"
import { createInterface } from "node:readline"
import { Command } from "commander"
import { parseArgs, outputJSON } from "./index"
import { listSessions, listJsonlSessions } from "./db-reader"
import { extractFullTimeline, extractJsonlTimeline } from "./merger"
import type { FullTimelineSession } from "./types.js"

// ── Chalk (graceful fallback) ────────────────────────────────────────────
let chalk: any
try {
  chalk = (await import("chalk")).default
} catch {
  // Fallback: no-op colored strings
  const noop = new Proxy(
    {} as Record<string, (...args: unknown[]) => string>,
    {
      get: (_t, prop) => {
        if (typeof prop === "symbol") return () => ""
        return (...args: unknown[]) => String(args[0])
      },
    },
  )
  chalk = noop
}

// ── Cost-capture paths & helpers ──────────────────────────────────────────
const HOME = homedir()
const TIMELINE_DIR = path.join(HOME, ".claude-timeline")
const CONFIG_PATH = path.join(TIMELINE_DIR, "config.json")
const DISMISSED_PATH = path.join(TIMELINE_DIR, ".setup-dismissed")
const SETTINGS_PATH = path.join(HOME, ".claude", "settings.json")

/** Resolve paths to the bundled dist files next to this CLI module. */
function getDistDir(): string {
  return path.dirname(new URL(import.meta.url).pathname)
}

function isCostCaptureInstalled(): boolean {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return false
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"))
    return !!(config && config.originalStatusLine)
  } catch {
    return false
  }
}

function readSettings(): Record<string, unknown> {
  if (!fs.existsSync(SETTINGS_PATH)) return {}
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8"))
  } catch {
    return {}
  }
}

function writeSettings(settings: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true })
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n", "utf-8")
}

/** Default Claude data paths */
function getDefaultPaths() {
  const home = homedir()
  return {
    dbPath: path.join(home, ".claude", "usage.db"),
    projectsDir: path.join(home, ".claude", "projects"),
  }
}

/** Check if a path exists and return file size / dir count */
function inspectPath(p: string): { exists: boolean; detail?: string } {
  try {
    const stat = statSync(p)
    if (stat.isDirectory()) {
      const count = readdirSync(p).length
      return { exists: true, detail: `${count} project${count !== 1 ? "s" : ""}` }
    }
    const kb = (stat.size / 1024).toFixed(0)
    return { exists: true, detail: `${kb} KB` }
  } catch {
    return { exists: false }
  }
}

/** Print startup status before server launches */
function printStartupStatus(port: number): void {
  const paths = getDefaultPaths()
  const db = inspectPath(paths.dbPath)
  const projects = inspectPath(paths.projectsDir)

  // Count sessions
  let sessionCount = 0
  if (db.exists || projects.exists) {
    try {
      const dbSessions = db.exists ? listSessions(paths.dbPath) : []
      const jsonlSessions = projects.exists ? listJsonlSessions(paths.projectsDir, paths.dbPath) : []
      const seen = new Set(dbSessions.map((s) => s.sessionId))
      for (const s of jsonlSessions) {
        if (!seen.has(s.sessionId)) seen.add(s.sessionId)
      }
      sessionCount = seen.size
    } catch {
      // Best-effort — don't crash
    }
  }

  console.log("")
  console.log("  ⚡ claude-timeline")
  console.log("")
  console.log(`  → http://localhost:${port}`)
  console.log("")

  // Status bar
  const dbIcon = db.exists ? "✓" : "✗"
  const projIcon = projects.exists ? "✓" : "✗"
  const sessionIcon = sessionCount > 0 ? "✓" : "–"
  const capIcon = isCostCaptureInstalled() ? "✓" : "✗"

  console.log("  ┌─ Status ─────────────────────────────────────┐")
  console.log(`  │ ${dbIcon}  Database      ${paths.dbPath}`)
  if (db.exists && db.detail) console.log(`  │    ${db.detail}`)
  console.log(`  │ ${projIcon}  Projects      ${paths.projectsDir}`)
  if (projects.exists && projects.detail) console.log(`  │    ${projects.detail}`)
  console.log(`  │ ${sessionIcon}  Sessions      ${sessionCount} found`)
  console.log(`  │ ${capIcon}  Cost capture  ${isCostCaptureInstalled() ? "installed" : "not installed"}`)
  console.log("  └──────────────────────────────────────────────┘")
  console.log("")

  // Info banner — tip about cost-capture (once per session)
  if (!isCostCaptureInstalled() && !fs.existsSync(DISMISSED_PATH)) {
    console.log("  💡 Tip: Run `claude-timeline setup` for real-time cost tracking")
    console.log("")
    // Mark dismissed so we only show once per session
    try {
      fs.mkdirSync(TIMELINE_DIR, { recursive: true })
      writeFileSync(DISMISSED_PATH, new Date().toISOString(), "utf-8")
    } catch {
      // Best-effort
    }
  }
}

/** Open URL in the default browser. macOS → `open`, Linux → `xdg-open`, Windows → `start`. */
function openBrowser(url: string): void {
  try {
    const platform = process.platform
    if (platform === "darwin") execSync(`open "${url}"`, { stdio: "ignore" })
    else if (platform === "linux") execSync(`xdg-open "${url}" 2>/dev/null || true`, { stdio: "ignore" })
    else if (platform === "win32") execSync(`start "" "${url}"`, { stdio: "ignore" })
  } catch {
    // Best-effort — don't crash if browser can't be opened
  }
}

/**
 * Run the cost-capture setup:
 *   1. Check Claude Code installation
 *   2. Read existing settings, save original statusLine
 *   3. Create ~/.claude-timeline/ dir
 *   4. Install better-sqlite3 runtime dependency
 *   5. Copy capture.js + db.js from dist/
 *   6. Update settings.json to wrap original statusLine
 */
async function runSetup(): Promise<void> {
  const distDir = getDistDir()
  const captureSrc = path.join(distDir, "capture.js")
  const dbSrc = path.join(distDir, "db.js")
  const captureDst = path.join(TIMELINE_DIR, "capture.js")
  const dbDst = path.join(TIMELINE_DIR, "db.js")
  const claudeDir = path.join(HOME, ".claude")
  const settingsPath = path.join(claudeDir, "settings.json")

  const step = (label: string) => process.stdout.write(`  ${chalk.gray("│")} ${label} `)
  const ok = () => console.log(chalk.green("✓"))
  const fail = (reason: string) => console.log(chalk.red(`✗ ${reason}`))
  const info = (msg: string) => console.log(chalk.gray(`    ${msg}`))

  console.log("")
  console.log(chalk.bold("  claude-timeline ") + chalk.gray("setup"))
  console.log("")

  // Step 1: Check Claude Code installation
  step("Checking Claude Code installation...")
  if (!existsSync(claudeDir)) {
    fail("~/.claude not found. Is Claude Code installed?")
    return
  }
  ok()

  // Step 2: Read existing settings
  step("Reading Claude Code settings...")
  let settings: Record<string, unknown> = {}
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8"))
    } catch {
      info("Could not parse settings.json — will create new one")
    }
  }
  const existingStatusLine = settings.statusLine as Record<string, unknown> | undefined
  if (existingStatusLine) {
    info(`Found existing statusLine: ${existingStatusLine.command ?? JSON.stringify(existingStatusLine)}`)
  } else {
    info("No existing statusLine found")
  }
  ok()

  // Step 3: Create ~/.claude-timeline/ directory
  step("Setting up cost capture directory...")
  try {
    mkdirSync(TIMELINE_DIR, { recursive: true })
    ok()
  } catch (e: unknown) {
    fail((e as Error).message)
    return
  }

  // Step 4: Save original statusLine config
  step("Configuring statusLine wrapper...")
  const configPath = CONFIG_PATH
  const existingConfig = existsSync(configPath)
    ? (() => { try { return JSON.parse(readFileSync(configPath, "utf-8")) } catch { return {} } })()
    : {}
  if (existingStatusLine && !existingConfig.originalStatusLine) {
    existingConfig.originalStatusLine = existingStatusLine
    writeFileSync(configPath, JSON.stringify(existingConfig, null, 2) + "\n", "utf-8")
    info("Original statusLine saved — will be wrapped transparently")
  } else if (existingConfig.originalStatusLine) {
    info("Original statusLine already saved")
  } else {
    info("No existing statusLine to save")
  }
  ok()

  // Step 5: Install better-sqlite3 runtime dependency
  step("Installing runtime dependencies...")
  try {
    const { execSync } = await import("node:child_process")
    execSync(`cd "${TIMELINE_DIR}" && cat > package.json << 'PKGJSON'\n{"name":"claude-timeline-runtime","private":true,"type":"module","dependencies":{"better-sqlite3":"^11.0.0"}}\nPKGJSON\nnpm install --silent 2>/dev/null || true`, { stdio: "pipe" })
    ok()
  } catch {
    info("Could not install runtime deps — will try on first use")
    ok()
  }

  // Step 6: Copy capture.js
  step("Installing capture script...")
  try {
    if (!existsSync(captureSrc)) {
      fail(`not found at ${captureSrc} — run build first`)
      return
    }
    copyFileSync(captureSrc, captureDst)
    ok()
  } catch (e: unknown) {
    fail((e as Error).message)
    return
  }

  // Step 7: Copy db.js
  step("Installing database script...")
  try {
    if (!existsSync(dbSrc)) {
      fail(`not found at ${dbSrc} — run build first`)
      return
    }
    copyFileSync(dbSrc, dbDst)
    ok()
  } catch (e: unknown) {
    fail((e as Error).message)
    return
  }

  // Step 8: Update settings.json statusLine
  step("Updating Claude Code settings...")
  try {
    settings.statusLine = {
      type: "command",
      command: `node "${captureDst}"`,
    }
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf-8")
    ok()
  } catch (e: unknown) {
    fail((e as Error).message)
    return
  }

  // Done — boxed output
  console.log("")
  const lines = [
    chalk.green("  Setup complete!"),
    "",
    chalk.gray("  Cost data will be captured automatically from"),
    chalk.gray("  all Claude Code sessions."),
    "",
    existingStatusLine
      ? chalk.gray("  Your original statusline is preserved and")
      : chalk.gray("  Restart Claude Code to activate."),
    existingStatusLine
      ? chalk.gray("  It will continue to work as before.")
      : "",
    "",
    chalk.gray("  Data stored: ") + chalk.cyan("~/.claude-timeline/cost-stream.db"),
  ]
  const maxLen = Math.max(...lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, "").length))
  console.log("  ┌" + "─".repeat(maxLen + 2) + "┐")
  for (const line of lines) {
    const stripped = line.replace(/\x1b\[[0-9;]*m/g, "")
    console.log("  │ " + line + " ".repeat(Math.max(0, maxLen - stripped.length)) + " │")
  }
  console.log("  └" + "─".repeat(maxLen + 2) + "┘")
  console.log("")
}

/** Prompt the user to install cost-capture if not already set up. */
function promptSetup(): Promise<boolean> {
  return new Promise((resolve) => {
    // Skip if not a TTY — non-interactive environments
    if (!process.stdin.isTTY) {
      return resolve(false)
    }
    // Skip if already dismissed this session
    if (fs.existsSync(DISMISSED_PATH)) {
      return resolve(false)
    }

    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question(
      chalk.yellow("\n  Cost capture not installed. Run `claude-timeline setup\` to get real-time cost data? [Y/n] "),
      (answer: string) => {
        rl.close()
        const normalized = answer.trim().toLowerCase()
        if (normalized === "" || normalized === "y" || normalized === "yes") {
          resolve(true)
        } else {
          // Mark dismissed so we don't ask again
          try {
            fs.mkdirSync(TIMELINE_DIR, { recursive: true })
            writeFileSync(DISMISSED_PATH, new Date().toISOString(), "utf-8")
          } catch {
            // Best-effort
          }
          resolve(false)
        }
      },
    )
  })
}

async function startServer(port: number, open: boolean): Promise<void> {
  process.env.PORT = String(port)
  const serverPath = path.join(path.dirname(new URL(import.meta.url).pathname), "server.cjs")

  if (!fs.existsSync(serverPath)) {
    console.error("Error: server.cjs not found. Run `pnpm build` first.")
    process.exit(1)
  }

  // First-run detection: prompt to install cost-capture
  if (!isCostCaptureInstalled()) {
    const shouldSetup = await promptSetup()
    if (shouldSetup) {
      await runSetup()
    }
  }

  // Show status before server starts
  printStartupStatus(port)

  if (open) {
    setTimeout(() => openBrowser(`http://localhost:${port}`), 1500)
  }

  await import(serverPath)
}

// ── CLI Definition ───────────────────────────────────────────────────────

const program = new Command()
  .name("claude-timeline")
  .description("Claude Code session visualizer — see your sessions, costs, and timeline")
  .version("1.0.0")

// Default command: serve + open browser
program
  .option("--no-open", "Don't open browser automatically")
  .option("-p, --port <port>", "Server port", "5199")
  .action(async (opts) => {
    await startServer(Number(opts.port), opts.open !== false)
  })

// serve subcommand
program
  .command("serve")
  .description("Start the API server + web UI")
  .option("-p, --port <port>", "Server port", "5199")
  .option("--no-open", "Don't open browser automatically")
  .action(async (opts) => {
    await startServer(Number(opts.port), opts.open !== false)
  })

// extract subcommand
program
  .command("extract")
  .description("Extract a session to JSON")
  .requiredOption("-s, --session-id <id>", "Session ID to extract")
  .option("--db-path <path>", "SQLite DB path")
  .option("--projects-dir <dir>", "Projects directory")
  .option("-o, --output <path>", "Write JSON to file instead of stdout")
  .action(async (opts) => {
    // Build fake argv for the existing parseArgs function
    const fakeArgv = ["node", "cli"]
    if (opts.sessionId) fakeArgv.push("--session-id", opts.sessionId)
    if (opts.dbPath) fakeArgv.push("--db-path", opts.dbPath)
    if (opts.projectsDir) fakeArgv.push("--projects-dir", opts.projectsDir)
    if (opts.output) fakeArgv.push("--output", opts.output)

    const originalArgv = process.argv
    process.argv = fakeArgv

    try {
      const config = parseArgs(process.argv)
      const sessionId = config.sessionId!

      let data: FullTimelineSession
      try {
        data = await extractFullTimeline(sessionId, config.dbPath, config.projectsDir)
      } catch (err: unknown) {
        if ((err as { code?: number }).code === 2) {
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
    } finally {
      process.argv = originalArgv
    }
  })

// list subcommand
program
  .command("list")
  .description("List available sessions")
  .option("--db-path <path>", "SQLite DB path")
  .option("--projects-dir <dir>", "Projects directory")
  .option("-o, --output <path>", "Write JSON to file instead of stdout")
  .action((opts) => {
    const fakeArgv = ["node", "cli", "--list-sessions"]
    if (opts.dbPath) fakeArgv.push("--db-path", opts.dbPath)
    if (opts.projectsDir) fakeArgv.push("--projects-dir", opts.projectsDir)
    if (opts.output) fakeArgv.push("--output", opts.output)

    const originalArgv = process.argv
    process.argv = fakeArgv

    try {
      const config = parseArgs(process.argv)
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
    } finally {
      process.argv = originalArgv
    }
  })

// setup subcommand
program
  .command("setup")
  .description("Install cost-capture statusline wrapper")
  .action(async () => {
    await runSetup()
  })

program.parse()
