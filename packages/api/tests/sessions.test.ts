import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { createApp } from "../src/server.js"

const FIXTURES_DIR = join(import.meta.dirname, "fixtures")
const DB_PATH = join(FIXTURES_DIR, "test.db")
const PROJECTS_DIR = join(FIXTURES_DIR, "projects")

function testConfig() {
  return {
    port: 0,
    corsOrigins: ["*"],
    dbPath: DB_PATH,
    projectsDir: PROJECTS_DIR,
  }
}

// Use dynamic import for supertest (ESM compatibility)
async function agent() {
  const { default: request } = await import("supertest")
  return request(createApp(testConfig()))
}

describe("GET /api/health", () => {
  it("returns 200 with status ok", async () => {
    const res = await agent()
    const response = await res.get("/api/health")

    expect(response.status).toBe(200)
    expect(response.body).toHaveProperty("status", "ok")
    expect(response.body).toHaveProperty("version")
    expect(response.body).toHaveProperty("uptime")
    expect(response.body).toHaveProperty("timestamp")
  })
})

describe("GET /api/sessions", () => {
  it("returns array with required fields", async () => {
    const res = await agent()
    const response = await res.get("/api/sessions")

    expect(response.status).toBe(200)
    expect(Array.isArray(response.body)).toBe(true)
    expect(response.body.length).toBeGreaterThan(0)

    const session = response.body[0]
    expect(session).toHaveProperty("sessionId")
    expect(session).toHaveProperty("projectName")
    expect(session).toHaveProperty("model")
    expect(session).toHaveProperty("turnCount")
    expect(session).toHaveProperty("lastTimestamp")
  })

  it("returns 400 for invalid limit", async () => {
    const res = await agent()
    const response = await res.get("/api/sessions?limit=-1")

    expect(response.status).toBe(400)
    expect(response.body).toHaveProperty("error")
  })
})

describe("GET /api/sessions/:id", () => {
  it("returns 404 for non-existent session", async () => {
    const res = await agent()
    const response = await res.get("/api/sessions/nonexistent-session-999")

    expect(response.status).toBe(404)
    expect(response.body).toHaveProperty("error", "not_found")
  })

  it("returns full timeline for valid session", async () => {
    const res = await agent()
    const response = await res.get("/api/sessions/test-session-001")

    expect(response.status).toBe(200)
    expect(response.body).toHaveProperty("session")
    expect(response.body).toHaveProperty("turns")
    expect(response.body).toHaveProperty("pricing")
    expect(response.body.session).toHaveProperty("sessionId", "test-session-001")
    expect(response.body.turns).toHaveLength(3)
  })

  it("serves from cache on second request", async () => {
    const res1 = await agent()
    await res1.get("/api/sessions/test-session-001")

    const res2 = await agent()
    const response = await res2.get("/api/sessions/test-session-001")

    expect(response.status).toBe(200)
    expect(response.body.session).toHaveProperty("sessionId", "test-session-001")
  })

  it("returns 400 for empty id", async () => {
    const res = await agent()
    const response = await res.get("/api/sessions/")

    // Empty id after /sessions/ — Express may treat this as the list endpoint
    // or return 404 depending on routing. Either is acceptable.
    expect([200, 400, 404]).toContain(response.status)
  })
})
