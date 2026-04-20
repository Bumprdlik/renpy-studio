# Ren'Py Dispatcher Editor

Visual editor for the Ren'Py dispatcher pattern — shows a **location × state** coverage grid and lets you edit `.rpy` files directly in the browser using Monaco editor.

## What it does

- Grid overview of all `label <prefix>_<location>_<state>:` combinations
- Color coding: ✓ written / ~ stub / ✗ missing
- **Progress bar** — `X/Y written` with fill bar at the top of the grid panel
- **Character stats** — `a: N | l: N | narrator: N` dialogue line counts below the legend
- Click any cell → opens the corresponding `.rpy` file in Monaco editor, scrolled to that label
- **Keyboard navigation** — arrow keys move focus in the grid, Enter opens the selected cell
- **Hover over a cell** → tooltip with the first 6 dialogue lines (Alfred/Lara/narrator color coded)
- **Search** — search bar above the grid, searches across all source files, click result to navigate
- `Ctrl+S` saves the file and refreshes the grid
- **Auto-refresh** — grid and editor update automatically when `.rpy` files change on disk (e.g. saved from VS Code)
- **EN/CZ toggle** — switch between source file and `tl/czech/` translation file for any cell
- **Split view** — in CZ mode, `⧉ Split EN` button shows the EN source as a read-only reference panel beside the CZ editor
- **Generate CZ** — one-click Czech translation of the current file via Claude API (requires Anthropic API key)
- **Draft EN** — AI writes English dialogue for a stub label (Claude Sonnet)
- **Revise** — rewrite an existing label with a one-line instruction (e.g. "add tension", "shorten", "more formal")
- Auto-creates stub labels when you click a missing cell

## Installation

```bash
git clone git@github.com:Bumprdlik/renpy-dispatcher-editor.git
cd renpy-dispatcher-editor
npm install
npm link        # makes `dispatcher-editor` available globally
```

## Usage

1. Add a `.dispatcher.json` to the root of your Ren'Py project (see `.dispatcher.example.json`)
2. Run from your project directory:

```bash
cd /path/to/your-renpy-project
dispatcher-editor
```

Or with an explicit path:

```bash
dispatcher-editor --project=/path/to/your-renpy-project
```

3. Open **http://localhost:3000**

## Config: `.dispatcher.json`

| Field | Description | Example |
|---|---|---|
| `gameDir` | Path to `game/` folder relative to project root | `"lara/game"` |
| `labelPattern` | Label naming pattern | `"alfred_{location}_{state}"` |
| `filePattern` | File path pattern relative to `gameDir` | `"alfred/alfred_{location}.rpy"` |
| `locations` | List of locations | `["bathroom", "bedroom"]` |
| `states` | List of states (e.g. outfit) | `["naked", "towel", "negligee"]` |
| `port` | Port for the local server (default: 3000) | `3000` |
| `tlDir` | Translation directory relative to `gameDir` (default: `"tl/czech"`) | `"tl/czech"` |
| `characters` | Character variable names for dialogue detection (default: `["a","l","narrator"]`) | `["a","l","narrator"]` |
| `anthropicApiKey` | Anthropic API key for Generate CZ (optional, prefer env var) | `"sk-ant-..."` |

Copy `.dispatcher.example.json` to `.dispatcher.json` in your project and adjust the values.

## Typical workflow

### Writing new dialogue (EN)

1. Start the editor: `dispatcher-editor` → open **http://localhost:3000**
2. Find a **✗ missing** or **~ stub** cell in the grid
3. **Right-click → Insert Alfred template** — pre-fills a starter dialogue skeleton directly in Monaco
4. Write the dialogue in English, `Ctrl+S` to save
5. The grid cell turns **✓ written** immediately (watch mode keeps the grid live)
6. For complex scenes, click the **file path link** in the editor header → opens the file in VS Code at the exact line. Edit there, the grid refreshes automatically on save.

```
dispatcher editor          VS Code
──────────────────         ──────────────────────────────
right-click → template  →  (or open via path link)
write dialogue          ←→ edit .rpy, Ctrl+S
Ctrl+S saves + grid ✓      watch mode refreshes grid
```

### Translating to Czech

1. Switch to **CZ** in the language toggle
2. **⟳ Generate All CZ** — translates all files at once via Claude API (set API key first)
   - Or **Generate CZ** for just the current file
3. Review the generated translations in Monaco (toggle **⧉ Split EN** to see EN source beside CZ)
4. `Ctrl+S` to save — the **orange badge** on the cell shows how many strings are still empty
5. Fill in remaining gaps manually

```
EN mode: write story  →  CZ mode: Generate All CZ
                          review in Split view
                          fix empty strings (orange badge)
                          Ctrl+S
```

### Daily routine

```
1. dispatcher-editor          # start server
2. Look at grid               # find gaps (✗ missing, ~ stub, orange badge)
3. Right-click stub → Insert template → write EN dialogue
   - Or: **✦ Draft EN** → AI writes a full draft → review & edit
   - Or: write manually, then **✎ Revise** → type instruction → Go (e.g. "add more tension between choices")
4. Ctrl+S → cell turns ✓
5. Switch CZ → Generate CZ → review → Ctrl+S
6. Repeat
```

## Generate CZ (AI translation)

Switch to **CZ** mode, open any cell, then click **Generate CZ**. The server parses the English source, computes Ren'Py-compatible MD5 hashes, calls Claude to translate, and loads the result into Monaco for review. Save with `Ctrl+S` when happy.

API key priority: UI input field → `ANTHROPIC_API_KEY` env var → `anthropicApiKey` in `.dispatcher.json`.

Uses Claude Haiku — costs under $0.01 per file.

## How label detection works

A label is considered:
- **written** — `label alfred_X_Y:` exists and the block contains at least one dialogue line (`a "..."` / `l "..."`)
- **stub** — label exists but has no dialogue (only `return` or `# TODO`)
- **missing** — label line not found in the file

Fallthrough labels (multiple `label X:` lines sharing one block) are handled correctly.
