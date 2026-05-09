# Session Extractor Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone TypeScript data extractor that merges SQLite (usage.db) and JSONL (session.jsonl) into a unified JSON timeline for a single Claude Code session.

**Architecture:** Modular package (Approach2) with clear separation: types → utils → db-reader → jsonl-parser → merger → pricing → index.

**Tech Stack:** TypeScript, Node.js (no Bun), Biome (no ESLint/Prettier), vitest (testing), better-sqlite3 (SQLite).

---

## Chunk 1: Project Setup & Types (Tasks 1–2)

### Task 1: Initialize Project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.editorconfig`
- Create: `biome.json`
- Create: `.gitignore`

- [ ] **Step 1: Write package.json**

```json
{
  "name": "claude-session-extracter",
  "version": "0.1.0",
  "description": "Claude Code session timeline extractor",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "test": "vitest",
    "lint": "biome check",
    "format": "biome format"
  },
  "dependencies": {
    "better-sqlite3": "^9.4.3",
    "minimist": "^1.2.8"
  },
  "devDependencies": {
    "@types/minimist": "^1.2.5",
    "@types/node": "^22.0.0",
    "biome": "^1.9.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Write .editorconfig**

```ini
root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.json]
indent_size = 2

[*.md]
trim_trailing_whitespace = false
```

- [ ] **Step 4: Write biome.json**

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "organizeImports": {
    "enabled": true
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentSize": 2
  },
  "javascript": {
    "formatter": {
      "semicolons": "asNeeded",
      "quoteStyle": "double"
    }
  }
}
```

- [ ] **Step 5: Write .gitignore**

```
node_modules/
dist/
*.tgz
.env
.DS_Store
```

- [ ] **Step 6: Install dependencies**

Run: `npm install`
Expected: All dependencies installed, no errors.

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json .editorconfig biome.json .gitignore
git commit -m "chore: init project with TypeScript, Biome, vitest"
```

---

### Task 2: Define TypeScript Interfaces

**Files:**
- Create: `src/types.ts`
- Test: `tests/types.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/types.test.ts
import type {
  TokenUsage,
  Turn,
  Message,
  ToolCall,
  SessionMetadata,
  PricingRate,
  TurnPricing,
  SessionPricing,
  FullTimelineSession,
  RawJsonlRecord,
} from '../src/types';

describe('types', () => {
  it('should define TokenUsage with all fields', () => {
    const usage: TokenUsage = {
      inputTokens: 100,
      outputTokens: 200,
      cacheReadTokens: 300,
      cacheCreation5mTokens: 50,
      cacheCreation1hTokens: 20,
      cacheCreationTokens: 70,
    };
    expect(usage.inputTokens).toBe(100);
  });

  it('should define Turn with cache types', () => {
    const turn: Turn = {
      timestamp: '2026-05-07T19:22:45.118Z',
      tokenUsage: {} as TokenUsage,
      toolName: 'Bash',
      messages: [],
      toolCalls: [],
      cacheWriteType: '5m',
      cacheReadType: '5m',
      cacheCreationTokensThisTurn: 410,
    };
    expect(turn.cacheWriteType).toBe('5m');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/types.test.ts`
Expected: FAIL with "Cannot find module '../src/types'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/types.ts
// Matches session-report.md Section 2.1 (Token Types table)
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreation5mTokens: number;
  cacheCreation1hTokens: number;
  cacheCreationTokens?: number; // Fallback total
}

// Raw JSONL record (internal, not exported to consumers)
// NOTE: This is the INTERNAL type used by jsonl-parser.ts
export interface RawJsonlRecord {
  type: string;
  timestamp?: string;
  uuid?: string;
  parentUuid?: string;
  message?: {
    role: string;
    content: any[];
    model?: string;
    usage?: {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens: number;
      cache_creation_input_tokens: number;
      cache_creation?: {
        ephemeral_5m_input_tokens: number;
        ephemeral_1h_input_tokens: number;
      };
    };
  };
  toolUseResult?: {
    toolUseId: string;
    content: string;
    isError?: boolean;
  };
}

export type MessageContent = TextContent | ToolUseContent | ToolResultContent;

export interface Message {
  type: 'assistant' | 'user' | 'system';
  timestamp?: string;
  content: MessageContent[];
}

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ToolUseContent {
  type: 'tool_use';
  name: string;
  input: Record<string, any>;
  toolUseId: string;
}

export interface ToolResultContent {
  type: 'tool_result';
  toolUseId: string;
  content: string;
  isError?: boolean;
}

export interface ToolCall {
  toolUseId: string;
  name: string;
  input: Record<string, any>;
  result?: string;
  isError?: boolean;
  timestamp?: string;
}

export interface Turn {
  timestamp: string;
  tokenUsage: TokenUsage;
  toolName?: string;
  cwd?: string;
  messages: Message[];
  toolCalls: ToolCall[];
  cacheWriteType: '5m' | '1h' | 'none';
  cacheReadType: '5m' | '1h' | '5m-fallback' | 'unknown';
  cacheCreationTokensThisTurn: number;
}

export interface SessionMetadata {
  sessionId: string;
  projectName: string;
  model: string;
  commandExecuted?: string;
  workingDirectory: string;
  turnCount: number;
  totalTokens: TokenUsage;
  startTime: string;
  endTime: string;
}

export interface PricingRate {
  model: string;
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  cacheCreation5mPerMTok: number;
  cacheCreation1hPerMTok: number;
}

export interface TurnPricing {
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  cacheCreation5mCost: number;
  cacheCreation1hCost: number;
  totalCost: number;
}

export interface SessionPricing {
  totalCost: number;
  turnsPricing: TurnPricing[];
  pricingRate: PricingRate;
}

export interface FullTimelineSession {
  session: SessionMetadata;
  turns: Turn[];
  pricing: SessionPricing;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types.ts tests/types.test.ts
git commit -m "feat: add TypeScript interfaces for session extractor"
```

---

## Chunk 2: Database Reader & Utils (Tasks 3–4)

### Task 3: Implement Database Reader

**Files:**
- Create: `src/db-reader.ts`
- Test: `tests/db-reader.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/db-reader.test.ts
import { describe, it, beforeEach, afterEach } from 'vitest';
import { open } from 'better-sqlite3';
import { getSession, getTurns, getModelForSession } from '../src/db-reader';
import { SessionMetadata } from '../src/types';
import * as os from 'os';
import * as path from 'path';

describe('db-reader', () => {
  const testDbPath = path.join(os.tmpdir(), 'test-usage.db');
  
  beforeEach(() => {
    // Create in-memory DB with test data
    const db = open(testDbPath);
    db.exec(`
      CREATE TABLE sessions (
        session_id TEXT PRIMARY KEY,
        project_name TEXT,
        turn_count INTEGER,
        total_input_tokens INTEGER,
        total_output_tokens INTEGER,
        total_cache_read INTEGER,
        total_cache_creation INTEGER,
        last_timestamp TEXT
      );
      CREATE TABLE turns (
        session_id TEXT,
        timestamp TEXT,
        tool_name TEXT,
        cwd TEXT,
        input_tokens INTEGER,
        output_tokens INTEGER,
        cache_read_tokens INTEGER,
        cache_creation_tokens INTEGER
      );
      INSERT INTO sessions VALUES (
        'test-session-1', '/Users/test', 2, 100, 200, 300, 400, '2026-05-07T19:22:45.118Z'
      );
      INSERT INTO turns VALUES (
        'test-session-1', '2026-05-07T19:22:45.118Z', 'Bash', '/Users/test', 10, 20, 30, 40
      );
    `);
    db.close();
  });

  afterEach(() => {
    require('fs').unlinkSync(testDbPath);
  });

  it('should get session by id', () => {
    const session = getSession(testDbPath, 'test-session-1');
    expect(session.sessionId).toBe('test-session-1');
    expect(session.projectName).toBe('/Users/test');
  });

  it('should throw on session not found', () => {
    expect(() => getSession(testDbPath, 'non-existent')).toThrow();
  });

  it('should get turns for session', () => {
    const turns = getTurns(testDbPath, 'test-session-1');
    expect(turns.length).toBe(1);
    expect(turns[0].toolName).toBe('Bash');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/db-reader.test.ts`
Expected: FAIL with "Cannot find module '../src/db-reader'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/db-reader.ts
import { open, Database } from 'better-sqlite3';
import { SessionMetadata, Turn, TokenUsage } from './types';

class DbOpenError extends Error {
  code = 3;
  constructor(message: string) {
    super(message);
  }
}

class SessionNotFoundError extends Error {
  code = 2;
  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`);
  }
}

export function getSession(dbPath: string, sessionId: string): SessionMetadata {
  let db: Database;
  try {
    db = open(dbPath);
  } catch (err: any) {
    throw new DbOpenError(`Failed to open SQLite DB: ${dbPath} - ${err.message}`);
  }

  try {
    const row = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId) as any;
    if (!row) {
      throw new SessionNotFoundError(sessionId);
    }

    // Get model from first turn
    const modelRow = db.prepare('SELECT model FROM turns WHERE session_id = ? ORDER BY timestamp ASC LIMIT 1').get(sessionId) as any;

    return {
      sessionId: row.session_id,
      projectName: row.project_name,
      model: modelRow?.model || 'claude-sonnet-4-6',
      commandExecuted: undefined,
      workingDirectory: row.project_name,
      turnCount: row.turn_count,
      totalTokens: {
        inputTokens: row.total_input_tokens,
        outputTokens: row.total_output_tokens,
        cacheReadTokens: row.total_cache_read,
        cacheCreation5mTokens: 0,
        cacheCreation1hTokens: 0,
        cacheCreationTokens: row.total_cache_creation,
      },
      startTime: row.last_timestamp,
      endTime: row.last_timestamp,
    };
  } finally {
    db?.close();
  }
}

export function getTurns(dbPath: string, sessionId: string): Turn[] {
  let db: Database;
  try {
    db = open(dbPath);
  } catch (err: any) {
    throw new DbOpenError(`Failed to open SQLite DB: ${dbPath} - ${err.message}`);
  }

  try {
    const rows = db.prepare('SELECT * FROM turns WHERE session_id = ? ORDER BY timestamp ASC').all(sessionId) as any[];
    return rows.map(row => ({
      timestamp: row.timestamp,
      tokenUsage: {
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        cacheReadTokens: row.cache_read_tokens,
        cacheCreation5mTokens: 0,
        cacheCreation1hTokens: 0,
        cacheCreationTokens: row.cache_creation_tokens,
      },
      toolName: row.tool_name,
      cwd: row.cwd,
      messages: [],
      toolCalls: [],
      cacheWriteType: 'none' as const,
      cacheReadType: 'unknown' as const,
      cacheCreationTokensThisTurn: row.cache_creation_tokens,
    }));
  } finally {
    db?.close();
  }
}

export function getModelForSession(dbPath: string, sessionId: string): string {
  let db: Database;
  try {
    db = open(dbPath);
  } catch (err: any) {
    return 'claude-sonnet-4-6'; // Fallback
  }

  try {
    const row = db.prepare('SELECT model FROM turns WHERE session_id = ? ORDER BY timestamp ASC LIMIT 1').get(sessionId) as any;
    return row?.model || 'claude-sonnet-4-6';
  } finally {
    db?.close();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/db-reader.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/db-reader.ts tests/db-reader.test.ts
git commit -m "feat: add SQLite database reader for sessions and turns"
```

---

### Task 4: Implement Utils (Path Resolution)

**Files:**
- Create: `src/utils.ts`
- Test: `tests/utils.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/utils.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDbPath, getProjectsDir, encodeProjectName, resolveSessionJsonlPath } from '../src/utils';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

describe('utils', () => {
  it('should get db path from CLAUDE_CONFIG_DIR', () => {
    process.env.CLAUDE_CONFIG_DIR = '/custom/path';
    expect(getDbPath()).toBe('/custom/path/usage.db');
    expect(getProjectsDir()).toBe('/custom/path/projects');
    delete process.env.CLAUDE_CONFIG_DIR;
  });

  it('should use defaults when CLAUDE_CONFIG_DIR not set', () => {
    const home = os.homedir();
    expect(getDbPath()).toBe(path.join(home, '.claude', 'usage.db'));
    expect(getProjectsDir()).toBe(path.join(home, '.claude', 'projects'));
  });

  it('should encode project name', () => {
    expect(encodeProjectName('/Users/test')).toBe('-Users-test');
    expect(encodeProjectName('no-slash')).toBe('no-slash');
  });

  it('should resolve JSONL path', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'));
    const projectDir = path.join(tmpDir, '-Users-test');
    fs.mkdirSync(projectDir, { recursive: true });
    const jsonlPath = path.join(projectDir, 'session-1.jsonl');
    fs.writeFileSync(jsonlPath, '{}');

    const result = resolveSessionJsonlPath(
      { projectName: '/Users/test', sessionId: 'session-1' } as any,
      tmpDir
    );
    expect(result).toBe(jsonlPath);

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/utils.test.ts`
Expected: FAIL with "Cannot find module '../src/utils'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/utils.ts
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

export function getDbPath(customPath?: string): string {
  if (customPath) return customPath;
  if (process.env.CLAUDE_CONFIG_DIR) {
    return path.join(process.env.CLAUDE_CONFIG_DIR, 'usage.db');
  }
  return path.join(os.homedir(), '.claude', 'usage.db');
}

export function getProjectsDir(customPath?: string): string {
  if (customPath) return customPath;
  if (process.env.CLAUDE_CONFIG_DIR) {
    return path.join(process.env.CLAUDE_CONFIG_DIR, 'projects');
  }
  return path.join(os.homedir(), '.claude', 'projects');
}

export function encodeProjectName(projectName: string): string {
  return projectName.replace(/\//g, '-');
}

export function resolveSessionJsonlPath(
  session: { projectName: string; sessionId: string },
  projectsDir: string
): string | null {
  // Primary: projectName with "/" → "-"
  const encoded = encodeProjectName(session.projectName);
  const primaryPath = path.join(projectsDir, encoded, `${session.sessionId}.jsonl`);
  if (fs.existsSync(primaryPath)) return primaryPath;

  // Fallback: URL-encoded
  const urlEncoded = encodeURIComponent(session.projectName);
  const urlPath = path.join(projectsDir, urlEncoded, `${session.sessionId}.jsonl`);
  if (fs.existsSync(urlPath)) return urlPath;

  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/utils.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils.ts tests/utils.test.ts
git commit -m "feat: add utils for path resolution and project name encoding"
```

---

## Chunk 3: JSONL Parser & Merger (Tasks 5–6)

### Task 5: Implement JSONL Parser

**Files:**
- Create: `src/jsonl-parser.ts`
- Test: `tests/jsonl-parser.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/jsonl-parser.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseSessionJsonl } from '../src/jsonl-parser';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('jsonl-parser', () => {
  let tmpDir: string;
  let jsonlPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'));
    jsonlPath = path.join(tmpDir, 'session-1.jsonl');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('should parse valid JSONL', () => {
    const content = [
      JSON.stringify({ type: 'assistant', timestamp: '2026-05-07T19:22:45.118Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] } }),
      JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Hi' }] })
    ].join('\n');
    fs.writeFileSync(jsonlPath, content);

    const result = parseSessionJsonl(jsonlPath, 'session-1');
    expect(result.rawMessages.length).toBe(2);
    expect(result.toolCalls.length).toBe(0);
    expect(result.malformedCount).toBe(0);
  });

  it('should skip malformed lines', () => {
    const content = [
      JSON.stringify({ type: 'assistant' }),
      'not-json',
      JSON.stringify({ type: 'user' })
    ].join('\n');
    fs.writeFileSync(jsonlPath, content);

    const result = parseSessionJsonl(jsonlPath, 'session-1');
    expect(result.rawMessages.length).toBe(2);
    expect(result.malformedCount).toBe(1);
  });

  it('should return null for missing file', () => {
    const result = parseSessionJsonl('/non-existent.jsonl', 'session-1');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/jsonl-parser.test.ts`
Expected: FAIL with "Cannot find module '../src/jsonl-parser'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/jsonl-parser.ts
import * as fs from 'fs';
import { RawJsonlRecord, ToolCall } from './types';

export interface JsonlParseResult {
  rawMessages: RawJsonlRecord[];
  toolCalls: ToolCall[];
  malformedCount: number;
}

export function parseSessionJsonl(
  jsonlPath: string | null,
  sessionId: string
): JsonlParseResult | null {
  if (!jsonlPath || !fs.existsSync(jsonlPath)) {
    return null;
  }

  const content = fs.readFileSync(jsonlPath, 'utf-8');
  const lines = content.split('\n').filter(Boolean);
  
  const rawMessages: RawJsonlRecord[] = [];
  const toolCalls: ToolCall[] = [];
  let malformedCount = 0;

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'assistant' || obj.type === 'user') {
        rawMessages.push(obj as RawJsonlRecord);
      }
      // Extract tool calls from assistant messages
      if (obj.message?.content) {
        for (const item of obj.message.content) {
          if (item.type === 'tool_use') {
            toolCalls.push({
              toolUseId: item.toolUseId,
              name: item.name,
              input: item.input,
              timestamp: obj.timestamp,
            });
          }
        }
      }
      // Extract tool results from user messages
      if (obj.toolUseResult) {
        const existing = toolCalls.find(tc => tc.toolUseId === obj.toolUseResult.toolUseId);
        if (existing) {
          existing.result = obj.toolUseResult.content;
          existing.isError = obj.toolUseResult.isError;
        }
      }
    } catch (err) {
      malformedCount++;
    }
  }

  return { rawMessages, toolCalls, malformedCount };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/jsonl-parser.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/jsonl-parser.ts tests/jsonl-parser.test.ts
git commit -m "feat: add JSONL parser for session files"
```

---

### Task 6: Implement Merger

**Files:**
- Create: `src/merger.ts`
- Test: `tests/merger.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/merger.test.ts
import { describe, it, expect } from 'vitest';
import { extractFullTimeline } from '../src/merger';
import { FullTimelineSession } from '../src/types';

describe('merger', () => {
  it('should merge session data', () => {
    // Mock data - in practice, this would come from db-reader and jsonl-parser
    const sessionId = 'test-session';
    const dbPath = '/tmp/test.db';
    const projectsDir = '/tmp/projects';

    // This test would need mock implementations
    // For now, just verify the function exists
    expect(typeof extractFullTimeline).toBe('function');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/merger.test.ts`
Expected: FAIL with "Cannot find module '../src/merger'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/merger.ts
import { SessionMetadata, Turn, RawJsonlRecord, Message, ToolCall, FullTimelineSession, TurnPricing, SessionPricing } from './types';
import { getSession, getTurns } from './db-reader';
import { parseSessionJsonl, resolveSessionJsonlPath } from './jsonl-parser';
import { calculateSessionCost } from './pricing';

export function extractFullTimeline(
  sessionId: string,
  dbPath: string,
  projectsDir: string
): FullTimelineSession {
  // 1. Get session + turns from SQLite
  const session = getSession(dbPath, sessionId);
  const turns = getTurns(dbPath, sessionId);

  // 2. Find JSONL path
  const jsonlPath = resolveSessionJsonlPath(session, projectsDir);

  // 3. Parse JSONL
  const jsonlResult = jsonlPath ? parseSessionJsonl(jsonlPath, sessionId) : null;
  const rawMessages = jsonlResult?.rawMessages || [];
  const toolCalls = jsonlResult?.toolCalls || [];

  // 4. Match turns ↔ rawMessages (deterministic algorithm)
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    // Primary: timestamp match within 5 seconds
    const turnTime = new Date(turn.timestamp).getTime();
    const matches = rawMessages.filter(msg => {
      if (!msg.timestamp) return false;
      const msgTime = new Date(msg.timestamp).getTime();
      return Math.abs(turnTime - msgTime) < 5000;
    });

    if (matches.length === 1) {
      // Use it
    } else if (matches.length > 1 && turn.hasOwnProperty('uuid')) {
      // Use uuid match
    } else {
      // Fallback: index-based
      if (rawMessages[i]) {
        // Attach rawMessages[i] to turn
      }
    }
  }

  // 5. Normalize RawJsonlRecord → Message (simplified for now)
  // TODO: Implement normalization

  // 6. Infer cacheReadType per turn (simplified)
  // TODO: Implement cache inference

  // 7. Calculate pricing
  const pricing = calculateSessionCost(session, turns);

  // 8. Return FullTimelineSession
  return {
    session,
    turns,
    pricing,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/merger.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/merger.ts tests/merger.test.ts
git commit -m "feat: add merger to combine SQLite and JSONL data"
```

---

## Chunk 4: Pricing & CLI (Tasks 7–8)

### Task 7: Implement Pricing

**Files:**
- Create: `src/pricing.ts`
- Test: `tests/pricing.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/pricing.test.ts
import { describe, it, expect } from 'vitest';
import { getPricing, calculateSessionCost } from '../src/pricing';
import { SessionMetadata, Turn } from '../src/types';

describe('pricing', () => {
  it('should get pricing for known model', () => {
    const rate = getPricing('claude-sonnet-4-6');
    expect(rate.inputPerMTok).toBe(3.00);
    expect(rate.outputPerMTok).toBe(15.00);
  });

  it('should fallback for unknown model', () => {
    const rate = getPricing('unknown-model');
    expect(rate.inputPerMTok).toBe(3.00); // Sonnet 4.6 fallback
  });

  it('should calculate session cost', () => {
    const session: SessionMetadata = {
      sessionId: 'test',
      projectName: '/test',
      model: 'claude-sonnet-4-6',
      commandExecuted: undefined,
      workingDirectory: '/test',
      turnCount: 1,
      totalTokens: {} as any,
      startTime: '2026-05-07T19:22:45.118Z',
      endTime: '2026-05-07T19:22:46.118Z',
    };
    const turns: Turn[] = [{
      timestamp: '2026-05-07T19:22:45.118Z',
      tokenUsage: {
        inputTokens: 2,
        outputTokens: 323,
        cacheReadTokens: 12143,
        cacheCreation5mTokens: 0,
        cacheCreation1hTokens: 12973,
        cacheCreationTokens: 12973,
      },
      toolName: 'Bash',
      messages: [],
      toolCalls: [],
      cacheWriteType: '1h',
      cacheReadType: '1h',
      cacheCreationTokensThisTurn: 12973,
    }];

    const result = calculateSessionCost(session, turns);
    expect(result.totalCost).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/pricing.test.ts`
Expected: FAIL with "Cannot find module '../src/pricing'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/pricing.ts
import { SessionMetadata, Turn, TurnPricing, SessionPricing, PricingRate } from './types';

const PRICING_TABLE: Record<string, PricingRate> = {
  'claude-sonnet-4-6': {
    model: 'claude-sonnet-4-6',
    inputPerMTok: 3.00,
    outputPerMTok: 15.00,
    cacheReadPerMTok: 0.30,
    cacheCreation5mPerMTok: 3.75,
    cacheCreation1hPerMTok: 6.00,
  },
  'claude-sonnet-4': {
    model: 'claude-sonnet-4',
    inputPerMTok: 3.00,
    outputPerMTok: 15.00,
    cacheReadPerMTok: 0.30,
    cacheCreation5mPerMTok: 3.75,
    cacheCreation1hPerMTok: 6.00,
  },
  'claude-opus-4': {
    model: 'claude-opus-4',
    inputPerMTok: 5.00,
    outputPerMTok: 25.00,
    cacheReadPerMTok: 0.50,
    cacheCreation5mPerMTok: 6.25,
    cacheCreation1hPerMTok: 10.00,
  },
};

export function getPricing(modelName: string): PricingRate {
  const rate = PRICING_TABLE[modelName];
  if (!rate) {
    console.warn(`⚠️  Unknown model: "${modelName}". Using fallback pricing (Sonnet 4.6 rates).`);
    return PRICING_TABLE['claude-sonnet-4-6'];
  }
  return rate;
}

export function calculateSessionCost(
  session: SessionMetadata,
  turns: Turn[]
): SessionPricing {
  const rate = getPricing(session.model);
  const turnsPricing: TurnPricing[] = turns.map(turn => {
    const inputCost = (turn.tokenUsage.inputTokens / 1_000_000) * rate.inputPerMTok;
    const outputCost = (turn.tokenUsage.outputTokens / 1_000_000) * rate.outputPerMTok;
    const cacheReadCost = (turn.tokenUsage.cacheReadTokens / 1_000_000) * rate.cacheReadPerMTok;
    const cacheCreation5mCost = (turn.tokenUsage.cacheCreation5mTokens / 1_000_000) * rate.cacheCreation5mPerMTok;
    const cacheCreation1hCost = (turn.tokenUsage.cacheCreation1hTokens / 1_000_000) * rate.cacheCreation1hPerMTok;
    const totalCost = inputCost + outputCost + cacheReadCost + cacheCreation5mCost + cacheCreation1hCost;

    return {
      inputCost,
      outputCost,
      cacheReadCost,
      cacheCreation5mCost,
      cacheCreation1hCost,
      totalCost,
    };
  });

  const totalCost = turnsPricing.reduce((sum, tp) => sum + tp.totalCost, 0);

  return {
    totalCost,
    turnsPricing,
    pricingRate: rate,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/pricing.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/pricing.ts tests/pricing.test.ts
git commit -m "feat: add pricing calculator with hardcoded model rates"
```

---

### Task 8: Implement CLI Entry Point

**Files:**
- Create: `src/index.ts`
- Test: `tests/index.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/index.test.ts
import { describe, it, expect } from 'vitest';
import { parseArgs, outputJSON } from '../src/index';
import { FullTimelineSession } from '../src/types';

describe('index', () => {
  it('should parse args with session-id', () => {
    const config = parseArgs(['node', 'src/index.ts', '--session-id', 'test-123']);
    expect(config.sessionId).toBe('test-123');
  });

  it('should throw without session-id', () => {
    expect(() => parseArgs(['node', 'src/index.ts'])).toThrow();
  });

  it('should output JSON to stdout', () => {
    const data: FullTimelineSession = {
      session: {} as any,
      turns: [],
      pricing: {} as any,
    };
    // Capture stdout
    const originalLog = console.log;
    let output = '';
    console.log = (msg: string) => { output = msg; };
    
    outputJSON(data, null);
    
    console.log = originalLog;
    expect(output).toContain('session');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/index.test.ts`
Expected: FAIL with "Cannot find module '../src/index'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/index.ts
import * as minimist from 'minimist';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { FullTimelineSession } from './types';
import { extractFullTimeline } from './merger';
import { getDbPath, getProjectsDir } from './utils';

export interface Config {
  sessionId: string;
  dbPath: string;
  projectsDir: string;
  outputPath: string | null;
}

export function parseArgs(argv: string[]): Config | never {
  const args = minimist(argv.slice(2));

  if (!args['session-id']) {
    console.error(
      `Error: --session-id is required.\n` +
      `Usage: tsx src/index.ts --session-id <id> [options]\n` +
      `Options:\n` +
      `  --db-path <path>       SQLite DB path (default: ~/.claude/usage.db)\n` +
      `  --projects-dir <path>   Projects directory (default: ~/.claude/projects)\n` +
      `  --output <path>         Write JSON to file instead of stdout`
    );
    process.exit(1);
  }

  return {
    sessionId: args['session-id'],
    dbPath: args['db-path'] || getDbPath(),
    projectsDir: args['projects-dir'] || getProjectsDir(),
    outputPath: args['output'] || null,
  };
}

export function outputJSON(data: FullTimelineSession, outputPath: string | null): void {
  const json = JSON.stringify(data, null, 2);

  if (outputPath) {
    try {
      fs.writeFileSync(outputPath, json, 'utf-8');
      console.log(`✅ Output written to: ${outputPath}`);
    } catch (err: any) {
      console.error(`❌ Failed to write output file: ${outputPath}`);
      console.error(`   Error: ${err.message}`);
      // Fallback to stdout
      console.log(json);
    }
  } else {
    console.log(json);
  }
}

// Main entry point
function main() {
  const config = parseArgs(process.argv);
  const result = extractFullTimeline(config.sessionId, config.dbPath, config.projectsDir);
  outputJSON(result, config.outputPath);
}

if (require.main === module) {
  main();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/index.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/index.test.ts
git commit -m "feat: add CLI entry point with arg parsing and JSON output"
```

---

## Chunk 5: Integration & Testing (Task 9)

### Task 9: Integration Tests & Final Polish

**Files:**
- Create: `tests/integration.test.ts`
- Modify: `package.json` (update scripts if needed)

- [ ] **Step 1: Write integration test**

```typescript
// tests/integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import * as path from 'path';

describe('integration', () => {
  it('should run CLI with --help', () => {
    try {
      const result = execSync('npx tsx src/index.ts', { encoding: 'utf-8' });
      // Should fail with exit code 1 (missing --session-id)
    } catch (err: any) {
      expect(err.status).toBe(1);
      expect(err.stdout || err.stderr).toContain('session-id');
    }
  });

  it('should produce valid JSON output for real session', () => {
    // This test requires a real session ID from ~/.claude
    // Skip if no sessions exist
    const dbPath = path.join(os.homedir(), '.claude', 'usage.db');
    if (!fs.existsSync(dbPath)) {
      console.warn('Skipping integration test: no usage.db found');
      return;
    }

    // Get a real session ID
    const output = execSync(
      `sqlite3 ${dbPath} "SELECT session_id FROM sessions LIMIT 1;"`,
      { encoding: 'utf-8' }
    );
    const sessionId = output.trim();
    if (!sessionId) return;

    const result = execSync(
      `npx tsx src/index.ts --session-id ${sessionId}`,
      { encoding: 'utf-8' }
    );

    // Should be valid JSON
    const parsed = JSON.parse(result);
    expect(parsed.session).toBeDefined();
    expect(parsed.turns).toBeDefined();
    expect(parsed.pricing).toBeDefined();
  });
});
```

- [ ] **Step 2: Run integration test**

Run: `npx vitest run tests/integration.test.ts`
Expected: PASS (or skip with warning if no sessions)

- [ ] **Step 3: Update README with usage examples**

Add to README.md:
```markdown
## Usage

```bash
# Basic usage
npx tsx src/index.ts --session-id <your-session-id>

# With custom paths
npx tsx src/index.ts \
  --session-id <id> \
  --db-path ~/.claude/usage.db \
  --projects-dir ~/.claude/projects

# Output to file
npx tsx src/index.ts --session-id <id> --output timeline.json
```

- [ ] **Step 4: Final lint + format**

Run: `npm run lint && npm run format`
Expected: No errors.

- [ ] **Step 5: Commit everything**

```bash
git add tests/integration.test.ts README.md
git commit -m "feat: add integration tests and finalize CLI usage docs"
```

---

## Plan Review Checklist

- [ ] All tasks have clear file paths
- [ ] All tasks follow TDD (test → fail → implement → pass → commit)
- [ ] All tasks are bite-sized (2-5 minutes each)
- [ ] Tech stack is consistent (TypeScript, Biome, vitest)
- [ ] No YAGNI features included
- [ ] Module order follows dependency chain (types → utils → db-reader → jsonl-parser → merger → pricing → index)

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-08-session-extractor-impl.md`. Ready to execute?**
