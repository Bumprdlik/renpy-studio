# CLAUDE.md — renpy-dispatcher-editor

## What this is

A local Node.js tool for editing Ren'Py dispatcher pattern files. It reads/writes `.rpy` files from a configured Ren'Py project and shows a coverage grid in the browser.

## Stack

- **Runtime**: Node.js (no build step)
- **Server**: Express (`server.js`) — serves API + static files
- **Frontend**: Single HTML file (`public/index.html`) — vanilla JS + Monaco editor from CDN
- **Config**: `.dispatcher.json` in the target Ren'Py project (not in this repo)
- **AI translation**: `@anthropic-ai/sdk` — called only on demand via Generate CZ button

## Key files

- `server.js` — all backend logic: config loading, .rpy parsing, API routes, file watch, translation
- `public/index.html` — entire frontend: grid, Monaco editor, hover tooltip, SSE watch listener
- `.dispatcher.example.json` — template config for new projects

## API

| Method | Route | Description |
|---|---|---|
| GET | `/api/config` | Returns loaded config + project path |
| GET | `/api/status` | Returns grid: `{ [location]: { [state]: "written"\|"stub"\|"missing" } }` |
| GET | `/api/stats` | Returns `{ total, written, stub, missing, byChar: { a, l, narrator } }` |
| GET | `/api/search?q=` | Full-text search across all source files; returns `[{ location, label, line, text }]` (max 60) |
| GET | `/api/file/:location` | Returns EN source file content + path |
| PUT | `/api/file/:location` | Saves EN source file |
| GET | `/api/tl-file/:location` | Returns tl file content + path (null if missing) |
| PUT | `/api/tl-file/:location` | Saves tl file |
| GET | `/api/label-line/:location/:state` | Returns 1-based line number of the label in EN source |
| GET | `/api/tl-label-line/:location/:state` | Returns 1-based line of `translate czech <label>_` in tl file |
| POST | `/api/stub/:location/:state` | Creates stub label in EN source if missing |
| GET | `/api/preview/:location/:state` | Returns first 6 dialogue lines `{ who, text }[]` for hover tooltip |
| POST | `/api/generate-tl/:location` | Translates EN source → tl file via Claude API; returns `{ content }` |
| GET | `/api/watch` | SSE stream — pushes `{ location }` when source file changes on disk |

## Label detection (`getLabelStatus`)

Parses `.rpy` content to determine label status:
1. Find `label <name>:` line (exact trim match)
2. Skip consecutive fallthrough labels
3. Scan block for any `a "..."` / `l "..."` / `narrator "..."` line
4. Returns `"written"` / `"stub"` / `"missing"`

## Translation pipeline (`/api/generate-tl`)

1. `parseDialogue(content, characters)` — regex parser, extracts `{ label, who, rawWhat, parsedWhat, sourceLine }` blocks and menu strings
2. `computeHash(who, parsedWhat)` — replicates Ren'Py's `encode_say_string` + MD5 first 8 hex chars
3. `uniqueIdentifier(label, digest, seenIds)` — handles duplicate hashes within a label
4. `translateWithClaude(blocks, menuStrings, targetLang, apiKey)` — single batched call to Claude Haiku
5. `buildTlContent(...)` — assembles `translate czech <id>:` blocks + `translate czech strings:` section

API key resolved in order: `req.body.apiKey` → `ANTHROPIC_API_KEY` env → `config.anthropicApiKey`.

## Frontend features

- **Progress bar** — computed client-side from `gridData` on every `refreshGrid()`, no extra endpoint
- **Keyboard nav** — `kbdLocIdx`/`kbdStateIdx` track focused cell; keydown on `#grid-scroll` (tabindex=0); `renderGrid()` applies `.kbd-focus` class
- **Search** — debounced 300ms input → `GET /api/search?q=`; results highlight matches with `<em>`; click resolves location/state from label name suffix
- **Split view** — second read-only Monaco instance (`enEditor`) in `#en-panel`; toggled by `splitActive` flag; visible only in CZ mode with a cell open; `loadEnPanel()` loads EN source and scrolls to label
- **Character stats** — `loadStats()` fetches `/api/stats`, renders `a/l/narrator` counts in `#stats-bar` below legend

## File watch

`watchSourceFiles()` runs at startup. Uses `fs.watch` on each source directory. On `.rpy` change, pushes SSE event to all connected browsers. Frontend invalidates hover cache for the changed location and refreshes the grid. If the changed file is open and Monaco is clean (not dirty), reloads the editor content automatically.

## What NOT to change

- Do not add a build step or bundler — keep it zero-config
- Do not add a database — files are the source of truth
- Do not parse Ren'Py deeply — Monaco edits raw `.rpy`, not structured data
