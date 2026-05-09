# Session Extractor Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone TypeScript data extractor that merges SQLite (usage.db) and JSONL (session.jsonl) into a unified JSON timeline for a single Claude Code session.

**Architecture:** Modular package (Approach 2) with clear separation: types → utils → db-reader → noise-filter → jsonl-parser → tool-matcher → subagent-resolver → merger → pricing → index.

**Inspired by:** [claude-devtools](https://github.com/matt1398/claude-devtools) — streaming parsing, noise filtering, subagent resolution, tool matching.

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
  "name": "@timeline/extractor",
  "version": "0.1.0",
  "description": "Claude Code session timeline extractor",
  "type": "module",
  "main": "./src/index.ts",
  "engines": {
    "node": ">=24.15.0",
    "pnpm": ">=11.0.0"
  },
  "scripts": {
    "extract": "tsx src/index.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest",
    "lint": "biome check",
    "format": "biome format"
  },
  "dependencies": {
    "better-sqlite3": "^11.7.0",
    "minimist": "^1.2.8"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.12",
    "@types/minimist": "^1.2.5",
    "@types/node": "^22.10.5",
    "biome": "^1.9.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.3",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
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

Run: `pnpm install`
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
import { describe, it, expect } from 'vitest';
import type {
  TokenUsage,
  ParsedMessage,
  ToolCall,
  ToolResult,
  ToolExecution,
  Turn,
  ConversationGroup,
  Subagent,
  SessionMetadata,
  PricingRate,
  FullTimelineSession,
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

  it('should define ParsedMessage with all metadata fields', () => {
    const msg: ParsedMessage = {
      uuid: 'test-uuid',
      parentUuid: null,
      type: 'assistant',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello' }],
      timestamp: new Date(),
      isSidechain: false,
      isMeta: false,
      isCompactSummary: false,
      toolCalls: [],
      toolResults: [],
    };
    expect(msg.uuid).toBe('test-uuid');
    expect(msg.isSidechain).toBe(false);
  });

  it('should define ToolCall with isTask flag', () => {
    const tc: ToolCall = {
      id: 'tool-1',
      name: 'Task',
      input: { description: 'Explore codebase' },
      isTask: true,
      taskDescription: 'Explore codebase',
    };
    expect(tc.isTask).toBe(true);
  });

  it('should define Subagent with all fields', () => {
    const sub: Subagent = {
      id: 'agent-1',
      filePath: '/path/to/agent-1.jsonl',
      messages: [],
      startTime: new Date(),
      endTime: new Date(),
      durationMs: 1000,
      metrics: {
        inputTokens: 100,
        outputTokens: 200,
        cacheReadTokens: 300,
        cacheCreationTokens: 400,
        messageCount: 5,
        durationMs: 1000,
      },
      isParallel: false,
      isOngoing: false,
    };
    expect(sub.id).toBe('agent-1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/types.test.ts`
Expected: FAIL with "Cannot find module '../src/types'"

- [ ] **Step 3: Write minimal implementation**

See `2026-05-08-session-extractor-types.md` for complete type definitions. Key types:
- `TokenUsage` — per-turn/session token counts
- `ParsedMessage` — complete JSONL entry with all metadata (uuid, parentUuid, isSidechain, isMeta, sourceToolUseID, agentId, requestId, etc.)
- `ToolCall` — tool invocation with isTask flag
- `ToolResult` — tool result with toolUseId
- `ToolExecution` — matched call+result pair with timing
- `Turn` — SQLite turn + matched messages + tool executions + conversation group
- `ConversationGroup` — user message + AI responses + subagents
- `Subagent` — resolved subagent with metrics and linking
- `SessionMetadata` — session info + ongoing status + context consumption
- `PricingRate`, `TurnPricing`, `SessionPricing` — pricing types
- `FullTimelineSession` — final output with session, turns, subagents, groups, pricing

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types.ts tests/types.test.ts
git commit -m "feat: add complete TypeScript interfaces for session extractor"
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
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

describe('db-reader', () => {
  const testDbPath = path.join(os.tmpdir(), 'test-usage.db');
  
  beforeEach(() => {
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
    fs.unlinkSync(testDbPath);
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

See implementation plan for `db-reader.ts`. Key functions:
- `getSession(dbPath, sessionId)` → SessionMetadata (throws on not found)
- `getTurns(dbPath, sessionId)` → Turn[] (empty array if none)
- `getModelForSession(dbPath, sessionId)` → string (fallback to 'claude-sonnet-4-6')

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

    fs.rmSync(tmpDir, { recursive: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/utils.test.ts`
Expected: FAIL with "Cannot find module '../src/utils'"

- [ ] **Step 3: Write minimal implementation**

See implementation plan for `utils.ts`. Key functions:
- `getDbPath(customPath?)` — respects CLAUDE_CONFIG_DIR
- `getProjectsDir(customPath?)` — respects CLAUDE_CONFIG_DIR
- `encodeProjectName(projectName)` — "/" → "-"
- `resolveSessionJsonlPath(session, projectsDir)` — primary + URL-encoded fallback

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/utils.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils.ts tests/utils.test.ts
git commit -m "feat: add utils for path resolution and project name encoding"
```

---

## Chunk 3: Noise Filter & JSONL Parser (Tasks 5–6)

### Task 5: Implement Noise Filter

**Files:**
- Create: `src/noise-filter.ts`
- Test: `tests/noise-filter.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/noise-filter.test.ts
import { describe, it, expect } from 'vitest';
import { isDisplayableEntry, classifyMessage } from '../src/noise-filter';

describe('noise-filter', () => {
  it('should filter out system entries', () => {
    expect(isDisplayableEntry({ type: 'system', uuid: '1' })).toBe(false);
  });

  it('should filter out summary entries', () => {
    expect(isDisplayableEntry({ type: 'summary', uuid: '1' })).toBe(false);
  });

  it('should filter out file-history-snapshot entries', () => {
    expect(isDisplayableEntry({ type: 'file-history-snapshot', uuid: '1' })).toBe(false);
  });

  it('should filter out queue-operation entries', () => {
    expect(isDisplayableEntry({ type: 'queue-operation', uuid: '1' })).toBe(false);
  });

  it('should filter out synthetic assistant messages', () => {
    expect(isDisplayableEntry({
      type: 'assistant',
      uuid: '1',
      message: { model: '<synthetic>', content: [] }
    })).toBe(false);
  });

  it('should filter out sidechain messages', () => {
    expect(isDisplayableEntry({
      type: 'assistant',
      uuid: '1',
      isSidechain: true,
      message: { content: [] }
    })).toBe(false);
  });

  it('should keep real assistant messages', () => {
    expect(isDisplayableEntry({
      type: 'assistant',
      uuid: '1',
      message: { content: [{ type: 'text', text: 'Hello' }] }
    })).toBe(true);
  });

  it('should keep real user messages', () => {
    expect(isDisplayableEntry({
      type: 'user',
      uuid: '1',
      message: { content: 'Hello' }
    })).toBe(true);
  });

  it('should filter out hard noise tags', () => {
    expect(isDisplayableEntry({
      type: 'user',
      uuid: '1',
      message: { content: '<local-command-caveat>test</local-command-caveat>' }
    })).toBe(false);
  });

  it('should keep command output', () => {
    expect(isDisplayableEntry({
      type: 'user',
      uuid: '1',
      message: { content: '<local-command-stdout>output</local-command-stdout>' }
    })).toBe(true);
  });

  it('should keep meta user messages (tool results)', () => {
    expect(isDisplayableEntry({
      type: 'user',
      uuid: '1',
      isMeta: true,
      message: { content: [{ type: 'tool_result', tool_use_id: '1', content: 'ok' }] }
    })).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/noise-filter.test.ts`
Expected: FAIL with "Cannot find module '../src/noise-filter'"

- [ ] **Step 3: Write minimal implementation**

See `2026-05-08-session-extractor-appendix.md` Section 5.6 for complete noise filtering rules. Key functions:
- `isDisplayableEntry(entry)` — returns true if entry should be kept
- `classifyMessage(msg)` — returns MessageCategory ('user' | 'system' | 'compact' | 'hardNoise' | 'ai')

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/noise-filter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/noise-filter.ts tests/noise-filter.test.ts
git commit -m "feat: add noise filter for message classification"
```

---

### Task 6: Implement Streaming JSONL Parser

**Files:**
- Create: `src/jsonl-parser.ts`
- Test: `tests/jsonl-parser.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/jsonl-parser.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseSessionJsonl, deduplicateByRequestId } from '../src/jsonl-parser';
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

  it('should parse valid JSONL with streaming', async () => {
    const content = [
      JSON.stringify({ type: 'assistant', uuid: '1', timestamp: '2026-05-07T19:22:45.118Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] } }),
      JSON.stringify({ type: 'user', uuid: '2', timestamp: '2026-05-07T19:22:46.118Z', message: { role: 'user', content: 'Hi' } })
    ].join('\n');
    fs.writeFileSync(jsonlPath, content);

    const result = await parseSessionJsonl(jsonlPath);
    expect(result.length).toBe(2);
    expect(result[0].uuid).toBe('1');
  });

  it('should skip malformed lines', async () => {
    const content = [
      JSON.stringify({ type: 'assistant', uuid: '1', message: { content: [] } }),
      'not-json',
      JSON.stringify({ type: 'user', uuid: '2', message: { content: 'Hi' } })
    ].join('\n');
    fs.writeFileSync(jsonlPath, content);

    const result = await parseSessionJsonl(jsonlPath);
    expect(result.length).toBe(2);
  });

  it('should return empty array for missing file', async () => {
    const result = await parseSessionJsonl('/non-existent.jsonl');
    expect(result.length).toBe(0);
  });

  it('should deduplicate by requestId', () => {
    const messages = [
      { uuid: '1', requestId: 'req-1', type: 'assistant', usage: { outputTokens: 100 } },
      { uuid: '2', requestId: 'req-1', type: 'assistant', usage: { outputTokens: 200 } },
      { uuid: '3', requestId: 'req-2', type: 'assistant', usage: { outputTokens: 300 } },
      { uuid: '4', type: 'user', usage: undefined },
    ] as any[];

    const result = deduplicateByRequestId(messages);
    expect(result.length).toBe(3);
    expect(result[0].uuid).toBe('2'); // Last of req-1
    expect(result[1].uuid).toBe('3'); // Only req-2
    expect(result[2].uuid).toBe('4'); // No requestId, pass through
  });

  it('should extract all metadata fields', async () => {
    const content = JSON.stringify({
      type: 'assistant',
      uuid: '1',
      parentUuid: null,
      timestamp: '2026-05-07T19:22:45.118Z',
      isSidechain: false,
      isMeta: false,
      cwd: '/Users/test',
      gitBranch: 'main',
      agentId: 'agent-1',
      requestId: 'req-1',
      message: {
        role: 'assistant',
        model: 'claude-sonnet-4-6',
        content: [{ type: 'text', text: 'Hello' }],
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          cache_read_input_tokens: 30,
          cache_creation_input_tokens: 40,
        }
      }
    });
    fs.writeFileSync(jsonlPath, content);

    const result = await parseSessionJsonl(jsonlPath);
    expect(result.length).toBe(1);
    expect(result[0].uuid).toBe('1');
    expect(result[0].cwd).toBe('/Users/test');
    expect(result[0].gitBranch).toBe('main');
    expect(result[0].agentId).toBe('agent-1');
    expect(result[0].requestId).toBe('req-1');
    expect(result[0].isSidechain).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/jsonl-parser.test.ts`
Expected: FAIL with "Cannot find module '../src/jsonl-parser'"

- [ ] **Step 3: Write minimal implementation**

Key implementation details:
- Use `readline.createInterface` for streaming (not `fs.readFileSync`)
- Extract ALL metadata fields: uuid, parentUuid, isSidechain, isMeta, isCompactSummary, sourceToolUseID, sourceToolAssistantUUID, agentId, requestId, cwd, gitBranch, userType, toolUseResult
- Extract tool calls from content blocks (tool_use)
- Extract tool results from content blocks (tool_result)
- Parse usage → TokenUsage (with cache_creation breakdown)
- Deduplicate by requestId (keep LAST entry per requestId)
- Filter noise via noise-filter.ts

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/jsonl-parser.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/jsonl-parser.ts tests/jsonl-parser.test.ts
git commit -m "feat: add streaming JSONL parser with dedup and noise filter"
```

---

## Chunk 4: Tool Matcher & Subagent Resolver (Tasks 7–8)

### Task 7: Implement Tool Matcher

**Files:**
- Create: `src/tool-matcher.ts`
- Test: `tests/tool-matcher.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/tool-matcher.test.ts
import { describe, it, expect } from 'vitest';
import { buildToolExecutions } from '../src/tool-matcher';
import type { ParsedMessage } from '../src/types';

describe('tool-matcher', () => {
  it('should match tool calls to results via sourceToolUseID', () => {
    const messages: ParsedMessage[] = [
      {
        uuid: '1',
        parentUuid: null,
        type: 'assistant',
        timestamp: new Date('2026-05-07T19:22:45.118Z'),
        content: [{ type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'ls' } }],
        isSidechain: false,
        isMeta: false,
        isCompactSummary: false,
        toolCalls: [{ id: 'tool-1', name: 'Bash', input: { command: 'ls' }, isTask: false }],
        toolResults: [],
      },
      {
        uuid: '2',
        parentUuid: null,
        type: 'user',
        timestamp: new Date('2026-05-07T19:22:46.118Z'),
        content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'file.txt' }],
        isSidechain: false,
        isMeta: true,
        isCompactSummary: false,
        sourceToolUseID: 'tool-1',
        toolCalls: [],
        toolResults: [{ toolUseId: 'tool-1', content: 'file.txt' }],
      },
    ];

    const result = buildToolExecutions(messages);
    expect(result.length).toBe(1);
    expect(result[0].toolCall.id).toBe('tool-1');
    expect(result[0].result?.toolUseId).toBe('tool-1');
    expect(result[0].durationMs).toBeGreaterThan(0);
  });

  it('should handle calls without results', () => {
    const messages: ParsedMessage[] = [
      {
        uuid: '1',
        parentUuid: null,
        type: 'assistant',
        timestamp: new Date(),
        content: [{ type: 'tool_use', id: 'tool-1', name: 'Bash', input: {} }],
        isSidechain: false,
        isMeta: false,
        isCompactSummary: false,
        toolCalls: [{ id: 'tool-1', name: 'Bash', input: {}, isTask: false }],
        toolResults: [],
      },
    ];

    const result = buildToolExecutions(messages);
    expect(result.length).toBe(1);
    expect(result[0].result).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/tool-matcher.test.ts`
Expected: FAIL with "Cannot find module '../src/tool-matcher'"

- [ ] **Step 3: Write minimal implementation**

Key implementation:
- First pass: collect all tool calls from assistant messages
- Second pass: match with results using sourceToolUseID (primary) + toolResults array (fallback)
- Add calls without results (pending/failed)
- Sort by startTime

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/tool-matcher.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tool-matcher.ts tests/tool-matcher.test.ts
git commit -m "feat: add tool matcher with sourceToolUseID matching"
```

---

### Task 8: Implement Subagent Resolver

**Files:**
- Create: `src/subagent-resolver.ts`
- Test: `tests/subagent-resolver.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/subagent-resolver.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveSubagents, discoverSubagentFiles } from '../src/subagent-resolver';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('subagent-resolver', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('should discover subagent files in NEW structure', async () => {
    const subagentsDir = path.join(tmpDir, 'session-1', 'subagents');
    fs.mkdirSync(subagentsDir, { recursive: true });
    fs.writeFileSync(path.join(subagentsDir, 'agent-abc.jsonl'), '{"uuid":"1","type":"user","message":{"content":"Warmup"}}');

    const files = await discoverSubagentFiles(tmpDir, 'session-1');
    expect(files.length).toBe(1);
    expect(files[0]).toContain('agent-abc.jsonl');
  });

  it('should skip warmup subagents', async () => {
    const subagentsDir = path.join(tmpDir, 'session-1', 'subagents');
    fs.mkdirSync(subagentsDir, { recursive: true });
    fs.writeFileSync(path.join(subagentsDir, 'agent-abc.jsonl'),
      JSON.stringify({ uuid: '1', type: 'user', timestamp: '2026-05-07T19:22:45.118Z', message: { content: 'Warmup' } })
    );

    const result = await resolveSubagents(tmpDir, 'session-1', [], []);
    expect(result.length).toBe(0);
  });

  it('should skip compact files', async () => {
    const subagentsDir = path.join(tmpDir, 'session-1', 'subagents');
    fs.mkdirSync(subagentsDir, { recursive: true });
    fs.writeFileSync(path.join(subagentsDir, 'agent-acompact-abc.jsonl'), '{}');

    const files = await discoverSubagentFiles(tmpDir, 'session-1');
    // acompact files should be filtered
    expect(files.filter(f => f.includes('acompact')).length).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/subagent-resolver.test.ts`
Expected: FAIL with "Cannot find module '../src/subagent-resolver'"

- [ ] **Step 3: Write minimal implementation**

Key implementation:
- Discover subagent files from NEW + OLD structures
- Parse each file (streaming readline)
- Skip warmup subagents (first user message = "Warmup")
- Skip compact files (agentId starts with 'acompact')
- Link to Task calls via agentId from tool results
- Detect parallel execution (100ms overlap window)
- Propagate team metadata via parentUuid chain

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/subagent-resolver.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/subagent-resolver.ts tests/subagent-resolver.test.ts
git commit -m "feat: add subagent resolver with NEW/OLD structure support"
```

---

## Chunk 5: Merger & Pricing (Tasks 9–10)

### Task 9: Implement Merger (Orchestrator)

**Files:**
- Create: `src/merger.ts`
- Test: `tests/merger.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/merger.test.ts
import { describe, it, expect } from 'vitest';
import {
  extractFullTimeline,
  buildConversationGroups,
  trackContextConsumption,
  checkSessionOngoing,
  inferCacheReadType,
  matchTurnsToMessages,
} from '../src/merger';

describe('merger', () => {
  it('should export extractFullTimeline', () => {
    expect(typeof extractFullTimeline).toBe('function');
  });

  it('should export buildConversationGroups', () => {
    expect(typeof buildConversationGroups).toBe('function');
  });

  it('should export trackContextConsumption', () => {
    expect(typeof trackContextConsumption).toBe('function');
  });

  it('should export checkSessionOngoing', () => {
    expect(typeof checkSessionOngoing).toBe('function');
  });

  it('should infer cache read type', () => {
    const turns = [
      { timestamp: '2026-05-07T19:22:45.118Z', cacheWriteType: '5m' },
      { timestamp: '2026-05-07T19:22:50.118Z', cacheWriteType: '5m' },
    ] as any[];
    const result = inferCacheReadType(1, turns, turns[1].timestamp);
    expect(result).toBe('5m');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/merger.test.ts`
Expected: FAIL with "Cannot find module '../src/merger'"

- [ ] **Step 3: Write minimal implementation**

Key functions:
- `extractFullTimeline(sessionId, dbPath, projectsDir)` — main orchestrator
- `buildConversationGroups(messages, subagents)` — group user+AI responses
- `trackContextConsumption(messages)` — track tokens across compaction phases
- `checkSessionOngoing(messages)` — detect active sessions
- `inferCacheReadType(turnIndex, turns, currentTurnTime)` — cache tier inference
- `matchTurnsToMessages(turns, messages)` — deterministic turn matching

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/merger.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/merger.ts tests/merger.test.ts
git commit -m "feat: add merger orchestrator with conversation grouping"
```

---

### Task 10: Implement Pricing

**Files:**
- Create: `src/pricing.ts`
- Test: `tests/pricing.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/pricing.test.ts
import { describe, it, expect } from 'vitest';
import { getPricing, calculateSessionCost } from '../src/pricing';
import type { SessionMetadata, Turn } from '../src/types';

describe('pricing', () => {
  it('should get pricing for known model', () => {
    const rate = getPricing('claude-sonnet-4-6');
    expect(rate.inputPerMTok).toBe(3.00);
    expect(rate.outputPerMTok).toBe(15.00);
  });

  it('should fallback for unknown model', () => {
    const rate = getPricing('unknown-model');
    expect(rate.inputPerMTok).toBe(3.00);
  });

  it('should calculate session cost', () => {
    const session: SessionMetadata = {
      sessionId: 'test',
      projectName: '/test',
      model: 'claude-sonnet-4-6',
      workingDirectory: '/test',
      turnCount: 1,
      totalTokens: {} as any,
      startTime: '2026-05-07T19:22:45.118Z',
      endTime: '2026-05-07T19:22:46.118Z',
      isOngoing: false,
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
      toolExecutions: [],
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

Key functions:
- `getPricing(modelName)` — lookup with fallback to Sonnet 4.6
- `calculateSessionCost(session, turns)` — per-turn cost calculation

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/pricing.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/pricing.ts tests/pricing.test.ts
git commit -m "feat: add pricing calculator with hardcoded model rates"
```

---

## Chunk 6: CLI Entry Point & Integration (Tasks 11–12)

### Task 11: Implement CLI Entry Point

**Files:**
- Create: `src/index.ts`
- Test: `tests/index.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/index.test.ts
import { describe, it, expect } from 'vitest';
import { parseArgs, outputJSON } from '../src/index';
import type { FullTimelineSession } from '../src/types';

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
      subagents: [],
      conversationGroups: [],
      pricing: {} as any,
    };
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

Key functions:
- `parseArgs(argv)` — CLI arg parsing with --session-id, --db-path, --projects-dir, --output
- `outputJSON(data, outputPath)` — JSON output to stdout or file
- `main()` — orchestration entry point

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/index.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/index.test.ts
git commit -m "feat: add CLI entry point with arg parsing and JSON output"
```

---

### Task 12: Integration Tests & Final Polish

**Files:**
- Create: `tests/integration.test.ts`
- Modify: `package.json` (update scripts if needed)

- [ ] **Step 1: Write integration test**

```typescript
// tests/integration.test.ts
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

describe('integration', () => {
  it('should run CLI with --help', () => {
    try {
      execSync('npx tsx src/index.ts', { encoding: 'utf-8' });
    } catch (err: any) {
      expect(err.status).toBe(1);
      expect(err.stdout || err.stderr).toContain('session-id');
    }
  });

  it('should produce valid JSON output for real session', () => {
    const dbPath = path.join(os.homedir(), '.claude', 'usage.db');
    if (!fs.existsSync(dbPath)) {
      console.warn('Skipping integration test: no usage.db found');
      return;
    }

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

    const parsed = JSON.parse(result);
    expect(parsed.session).toBeDefined();
    expect(parsed.turns).toBeDefined();
    expect(parsed.subagents).toBeDefined();
    expect(parsed.conversationGroups).toBeDefined();
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

Run: `pnpm run lint && pnpm run format`
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
- [ ] Module order follows dependency chain (types → utils → db-reader → noise-filter → jsonl-parser → tool-matcher → subagent-resolver → merger → pricing → index)
- [ ] Streaming readline is default (not fs.readFileSync)
- [ ] RequestId deduplication is included
- [ ] Noise filtering is included
- [ ] sourceToolUseID matching is included
- [ ] Subagent resolution is included (NEW + OLD structures)
- [ ] Conversation grouping is included
- [ ] Context consumption tracking is included
- [ ] Ongoing session detection is included

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-08-session-extractor-impl.md`. Ready to execute?**
