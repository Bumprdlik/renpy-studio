# CLAUDE.md — renpy-dispatcher-editor

## What this is

A local Node.js tool for editing Ren'Py dispatcher pattern files. It reads/writes `.rpy` files from a configured Ren'Py project and shows a coverage grid in the browser.

## Stack

- **Runtime**: Node.js (no build step)
- **Server**: Express (`server.js`) — serves API + static files
- **Frontend**: Single HTML file (`public/index.html`) — vanilla JS + Monaco editor from CDN
- **Config**: `.dispatcher.json` in the target Ren'Py project (not in this repo)

## Key files

- `server.js` — all backend logic: config loading, .rpy parsing, API routes
- `public/index.html` — entire frontend: grid, Monaco editor, save/load
- `.dispatcher.example.json` — template config for new projects

## API

| Method | Route | Description |
|---|---|---|
| GET | `/api/config` | Returns loaded config + project path |
| GET | `/api/status` | Returns grid: `{ [location]: { [state]: "written"\|"stub"\|"missing" } }` |
| GET | `/api/file/:location` | Returns file content + absolute path |
| PUT | `/api/file/:location` | Saves file content |
| GET | `/api/label-line/:location/:state` | Returns 1-based line number of the label |

## Label detection (`getLabelStatus`)

Parses `.rpy` content to determine label status:
1. Find `label <name>:` line (exact trim match)
2. Skip consecutive fallthrough labels
3. Scan block for any `a "..."` / `l "..."` / `narrator "..."` line
4. Returns `"written"` / `"stub"` / `"missing"`

## What NOT to change

- Do not add a build step or bundler — keep it zero-config
- Do not add a database — files are the source of truth
- Do not parse Ren'Py deeply — Monaco edits raw `.rpy`, not structured data
