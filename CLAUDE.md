# CLAUDE.md — renpy-dispatcher-editor

## What this is

A local Node.js tool for editing Ren'Py dispatcher pattern files. It reads/writes `.rpy` files from a configured Ren'Py project and shows a coverage grid in the browser.

## Stack

- **Runtime**: Node.js (no build step)
- **Server**: Express (`server.js`) — serves API + static files
- **Frontend**: Single HTML file (`public/index.html`) — vanilla JS + Monaco editor from CDN
- **Config**: `.dispatcher.json` in the target Ren'Py project (not in this repo)
- **AI features**: `@anthropic-ai/sdk` — Draft EN (Sonnet), Revise EN (Sonnet), Generate CZ (Haiku)

## Key files

- `server.js` — all backend logic: config loading, .rpy parsing, API routes, file watch, AI calls
- `public/index.html` — entire frontend: grid, Monaco editor, hover tooltip, SSE watch listener
- `.dispatcher.example.json` — template config for new projects

## API

| Method | Route | Description |
|---|---|---|
| GET | `/api/config` | Returns loaded config + project path |
| GET | `/api/status` | Returns grid: `{ [location]: { [state]: "written"\|"stub"\|"missing" } }` |
| GET | `/api/stats` | Returns `{ total, written, stub, missing, byChar: { ... } }` |
| GET | `/api/search?q=` | Full-text search across all source files; returns `[{ location, label, line, text }]` (max 60) |
| GET | `/api/file/:location` | Returns EN source file content + path |
| PUT | `/api/file/:location` | Saves EN source file |
| GET | `/api/tl-file/:location` | Returns tl file content + path (null if missing) |
| PUT | `/api/tl-file/:location` | Saves tl file |
| GET | `/api/label-line/:location/:state` | Returns 1-based line number of the label in EN source |
| GET | `/api/tl-label-line/:location/:state` | Returns 1-based line of `translate czech <label>_` in tl file |
| GET | `/api/line-counts` | Returns dialogue line count per location/state |
| POST | `/api/stub/:location/:state` | Creates stub label in EN source if missing |
| GET | `/api/preview/:location/:state` | Returns first 6 dialogue lines `{ who, text }[]` for hover tooltip |
| POST | `/api/generate-tl/:location` | Translates EN source → tl file via Claude Haiku; returns `{ content }` |
| POST | `/api/draft-en/:location/:state` | AI-writes EN dialogue (Claude Sonnet); returns `{ content }` (label body only) |
| POST | `/api/revise-en/:location/:state` | Rewrites label body per instruction (Claude Sonnet); body: `{ content, instructions, apiKey? }` |
| GET | `/api/tl-empty` | Returns empty-string counts per location/state in tl files |
| GET | `/api/lint` | Returns lint issues per location/state for written labels |
| GET+PUT | `/api/tl-memory` | Get/set translation memory array `[{ who, en, cz }]` |
| DELETE | `/api/tl-memory/:idx` | Remove one phrase from translation memory |
| POST | `/api/tl-memory/learn` | Scan all tl files and extract non-empty phrase pairs into memory |
| GET | `/api/export-csv` | Download all EN+CZ strings as CSV (`id,location,who,en,cz`) |
| POST | `/api/import-csv` | Update tl files in-place from filled CSV; body: `{ csv }` |
| POST | `/api/launch` | Spawn `config.renpyExe` with project path (detached) |
| GET | `/api/watch` | SSE stream — pushes `{ location }` when source file changes on disk |

## Label detection (`getLabelStatus`)

Parses `.rpy` content to determine label status:
1. Find `label <name>:` line (exact trim match)
2. Skip consecutive fallthrough labels
3. Scan block for any dialogue line matching characters in `config.characters`
4. Returns `"written"` / `"stub"` / `"missing"`

## Lint (`lintLabel`)

Run on written labels only:
- **missing return** — no `return` statement in block
- **sprite shown but never hidden** — `show <char>` exists but zero `hide <char>` in the entire block

Sprite name = first segment of `config.labelPattern` (e.g. `winston` from `winston_{location}_{state}`).
Fallthrough labels are handled the same way as in `getLabelStatus` (skip consecutive label lines before scanning).
Menu branch imbalances are ignored — only total absence of `hide` triggers a warning.

## Translation pipeline (`/api/generate-tl`)

1. `parseDialogue(content, characters)` — regex parser, extracts `{ label, who, rawWhat, parsedWhat, sourceLine }` blocks and menu strings
2. `computeHash(who, parsedWhat)` — replicates Ren'Py's `encode_say_string` + MD5 first 8 hex chars
3. `uniqueIdentifier(label, digest, seenIds)` — handles duplicate hashes within a label
4. `translateWithClaude(blocks, menuStrings, targetLang, apiKey)` — single batched call to Claude Haiku; injects `config.characterVoices` and translation memory into prompt
5. `buildTlContent(...)` — assembles `translate czech <id>:` blocks + `translate czech strings:` section

API key resolved in order: `req.body.apiKey` → `ANTHROPIC_API_KEY` env → `config.anthropicApiKey`.

## Draft EN / Revise EN

Both use Claude Sonnet. Prompt injects `config.characterVoices`, `config.locationDescs`, `config.stateDescs`. `extractLabelBlocks()` pulls 2 existing written labels from the same file as style examples.

Revise EN extracts the current label body from the request (`content` field) — the frontend sends the current Monaco content, not the saved file.

## CSV Export / Import

Export: iterates all locations, runs `parseDialogue` + `computeHash` to build IDs matching the tl file, reads current CZ from tl file, emits CSV rows.

Import: parses CSV, groups by `location` column, for each row with non-empty `cz` finds the `translate czech <id>:` block in the tl file and replaces the translation line in-place using string indexing (no full reparse). Menu strings matched by `old "..."` value.

## Frontend features

- **Grid filter** — `gridFilter` state; `cellMatchesFilter()` dims non-matching cells to 18% opacity
- **Progress bar** — computed client-side from `gridData` on every `refreshGrid()`, no extra endpoint
- **Line counts** — `lineCountData` from `/api/line-counts`; shown in cell text as `✓ N`
- **Keyboard nav** — `kbdLocIdx`/`kbdStateIdx` track focused cell; keydown on `#grid-scroll` (tabindex=0)
- **Batch select** — `selectedCells` Set; Ctrl+click toggles; `.batch-selected` CSS outline
- **Search** — debounced 300ms input → `GET /api/search?q=`; results highlight with `<em>`
- **Split view** — `enEditor` (read-only Monaco) in `#en-panel`; `splitActive` flag; CZ mode only
- **Character stats** — `loadStats()` → `/api/stats`, renders counts in `#stats-bar`
- **Draft EN** — `Ctrl+D` / button; replaces label block via `editor.executeEdits`
- **Revise EN (single)** — `Ctrl+R` opens inline bar; result shown in `#diff-modal` (before/after `<pre>`); Accept applies via `executeEdits`, Reject discards; `pendingRevision` stores `{ labelLine, endLine, newContent }`
- **Revise EN (batch)** — when `selectedCells.size > 1`, fetches each file from server, revises, auto-saves via PUT, no diff
- **Diff modal** — `#diff-modal` overlay; click outside = Reject; `diff-accept` / `diff-reject` buttons
- **Untranslated badges** — orange badge top-right; `tlEmptyData` from `/api/tl-empty`
- **Lint badges** — red ⚠ top-left; `lintData` from `/api/lint`; `title` shows issue text
- **Translation memory** — collapsible `#memory-panel`; phrase pairs with delete; "Learn from files" button
- **CSV export** — `<a href="/api/export-csv">` trigger download
- **CSV import** — hidden `<input type="file">`; reads file text → POST to `/api/import-csv`
- **Launch** — `Ctrl+L` / button; `POST /api/launch`; detached process, no stdout
- **Keyboard shortcuts** — `Ctrl+S` save, `Ctrl+D` draft, `Ctrl+R` revise, `Ctrl+G` toggle lang + generate, `Ctrl+L` launch; all skip when focus is in `<input>`/`<textarea>`

## File watch

`watchSourceFiles()` runs at startup. Uses `fs.watch` on each source directory. On `.rpy` change, pushes SSE event to all connected browsers. Frontend invalidates hover cache for the changed location, refreshes grid + stats + lint + line counts. If the changed file is open and Monaco is clean (not dirty), reloads the editor content automatically.

## What NOT to change

- Do not add a build step or bundler — keep it zero-config
- Do not add a database — files are the source of truth
- Do not parse Ren'Py deeply — Monaco edits raw `.rpy`, not structured data
