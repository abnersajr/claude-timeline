#!/usr/bin/env node
/**
 * claude-timeline build script
 *
 *   node scripts/build.mjs              Full build
 *   node scripts/build.mjs --cli        CLI only
 *   node scripts/build.mjs --server     Server only
 *   node scripts/build.mjs --web        Web only
 */
import { rolldown } from "rolldown"
import { execSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync, cpSync, rmSync, mkdirSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..")
const PACKAGES = join(ROOT, "packages")
const EXTRACTOR = join(PACKAGES, "extractor")
const API = join(PACKAGES, "api")
const WEB = join(PACKAGES, "web")
const DIST = join(ROOT, "dist")

function run(cmd, cwd) {
  console.log(`  $ ${cmd}`)
  execSync(cmd, {
    cwd,
    stdio: "inherit",
    env: {
      ...process.env,
      CI: "true",
      PATH: [
        join(ROOT, "node_modules", ".bin"),
        join(EXTRACTOR, "node_modules", ".bin"),
        join(WEB, "node_modules", ".bin"),
        process.env.PATH,
      ].join(":"),
    },
  })
}

function log(emoji, msg) {
  console.log(`${emoji} ${msg}`)
}

function fileSizeKB(filePath) {
  return (readFileSync(filePath).length / 1024).toFixed(1)
}

// ── Build CLI bundle (tsdown) ────────────────────────────────────────────
function buildCli() {
  log("📦", "Building CLI bundle (tsdown)...")

  const cliPath = join(DIST, "cli.js")
  if (existsSync(cliPath)) rmSync(cliPath)

  run(
    `tsdown src/cli.ts --format esm --out-dir ${DIST} --no-clean`,
    EXTRACTOR,
  )

  // Inject shebang if not present
  if (existsSync(cliPath)) {
    let content = readFileSync(cliPath, "utf-8")
    if (!content.startsWith("#!/usr/bin/env node")) {
      content = `#!/usr/bin/env node\n${content}`
      writeFileSync(cliPath, content)
    }
    log("  ✅", `cli.js (${fileSizeKB(cliPath)}KB)`)
  } else {
    // tsdown may output .mjs — check and rename
    const mjsPath = join(DIST, "cli.mjs")
    if (existsSync(mjsPath)) {
      let content = readFileSync(mjsPath, "utf-8")
      if (!content.startsWith("#!/usr/bin/env node")) {
        content = `#!/usr/bin/env node\n${content}`
      }
      writeFileSync(cliPath, content)
      rmSync(mjsPath)
      log("  ✅", `cli.js (${fileSizeKB(cliPath)}KB)`)
    }
  }

  // Clean up unnecessary files (source maps, dts)
  for (const f of ["cli.mjs.map", "cli.d.mts", "cli.d.ts"]) {
    const p = join(DIST, f)
    if (existsSync(p)) rmSync(p)
  }

  // Copy cost-capture scripts (plain JS, no bundling needed)
  log("📦", "Copying cost-capture scripts...")
  const ccDir = join(EXTRACTOR, "src", "cost-capture")
  for (const name of ["capture.js", "db.js"]) {
    const src = join(ccDir, name)
    const dst = join(DIST, name)
    if (existsSync(src)) {
      cpSync(src, dst)
    }
  }
  log("  ✅", "capture.js + db.js")
}

// ── Build server bundle (rolldown) ──────────────────────────────────────
async function buildServer() {
  log("🦀", "Building server bundle (rolldown)...")
  const { builtinModules } = await import("node:module")

  try {
    const bundle = await rolldown({
      input: join(API, "src", "serve.ts"),
      output: {
        file: join(DIST, "server.cjs"),
        format: "cjs",
        codeSplitting: false,
      },
      external: [
        "better-sqlite3",
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
      ],
    })

    const result = await bundle.generate({ format: "cjs" })
    await bundle.close()

    writeFileSync(join(DIST, "server.cjs"), result.output[0].code)
  } catch (err) {
    console.error("  Rolldown error:", err.message)
    if (err.frame) console.error("  Frame:", err.frame)
    throw err
  }

  const serverPath = join(DIST, "server.cjs")
  if (!existsSync(serverPath)) {
    throw new Error(`server.cjs not found at ${serverPath} after build`)
  }
  log("  ✅", `server.cjs (${fileSizeKB(serverPath)}KB)`)
}

// ── Build web UI ─────────────────────────────────────────────────────────
function buildWeb() {
  log("🎨", "Building web UI...")

  run("tsc -b", WEB)
  run("vite build", WEB)

  const distWeb = join(DIST, "web")
  if (existsSync(distWeb)) rmSync(distWeb, { recursive: true })
  cpSync(join(WEB, "dist"), distWeb, { recursive: true })

  log("  ✅", "web/ (copied to dist/web/)")
}

// ── Build types ──────────────────────────────────────────────────────────
function buildTypes() {
  log("📦", "Building type declarations...")
  run("tsc", EXTRACTOR)
  // Copy .d.ts files to root dist/
  const distDir = join(EXTRACTOR, "dist")
  if (existsSync(distDir)) {
    for (const f of readdirSync(distDir)) {
      if (f.endsWith(".d.ts") || f.endsWith(".d.ts.map")) {
        cpSync(join(distDir, f), join(DIST, f))
      }
    }
  }
  log("  ✅", "types")
}

// ── Main ─────────────────────────────────────────────────────────────────
const flags = process.argv.slice(2)
const cliOnly = flags.includes("--cli")
const serverOnly = flags.includes("--server")
const webOnly = flags.includes("--web")
const full = !cliOnly && !serverOnly && !webOnly

// Ensure dist/ exists
if (!existsSync(DIST)) mkdirSync(DIST, { recursive: true })

console.log("")
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
console.log("  Building claude-timeline")
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
console.log("")

try {
  if (full || cliOnly) {
    await buildTypes()
    buildCli()
    console.log("")
  }

  if (full || webOnly) {
    buildWeb()
    console.log("")
  }

  if (full || serverOnly) {
    await buildServer()
    console.log("")
  }

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
  console.log("  ✅ Build complete!")
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
  console.log("")
  console.log("  dist/")
  console.log("    cli.js       — CLI entry point")
  console.log("    server.cjs   — Express API + static files")
  console.log("    web/         — React SPA")
  console.log("    capture.js   — cost-capture wrapper")
  console.log("    db.js        — cost-capture SQLite layer")
  console.log("")
  console.log("  Try it:")
  console.log("    node dist/cli.js          # opens browser")
  console.log("    node dist/cli.js --help   # show all commands")
  console.log("")
} catch (err) {
  console.error("\n❌ Build failed:", err.message || err)
  process.exit(1)
}
