# Ren'Py Studio

Visual editor for the Ren'Py dispatcher pattern — shows a **location × state** coverage grid and lets you edit `.rpy` files directly in the browser using Monaco editor.

## What it does

- Grid overview of all `label <prefix>_<location>_<state>:` combinations
- Color coding: ✓ written / ~ stub / ✗ missing; written cells show dialogue line count (`✓ 18`)
- **Grid filter** — filter bar above the grid: Vše / ✗ / ~ / ✓ / ⚠ / 🟠
- **Progress bar** — `X/Y written` with fill bar at the top of the grid panel
- **Character stats** — dialogue line counts per character below the legend
- Click any cell → opens the corresponding `.rpy` file in Monaco editor, scrolled to that label
- **Keyboard navigation** — arrow keys move focus in the grid, Enter opens the selected cell
- **Hover over a cell** → tooltip with the first 6 dialogue lines (color coded per character)
- **Search** — search bar above the grid, searches across all source files, click result to navigate
- **Keyboard shortcuts** — `Ctrl+S` save, `Ctrl+D` Draft EN, `Ctrl+R` Revise bar, `Ctrl+G` toggle EN↔CZ + Generate, `Ctrl+L` Launch
- **Auto-refresh** — grid and editor update automatically when `.rpy` files change on disk
- **EN/CZ toggle** — switch between source file and `tl/czech/` translation file for any cell
- **Split view** — in CZ mode, `⧉ Split EN` shows the EN source as a read-only reference panel beside the CZ editor
- **▶ Launch** — opens Ren'Py directly from the editor (requires `renpyExe` in config)
- **Draft EN** — AI writes English dialogue for a stub label (Claude Sonnet); uses `characterVoices` from config
- **✎ Revise** — rewrite an existing label with a one-line instruction; shows a before/after diff modal before applying
- **Batch revise** — Ctrl+click to select multiple cells, then Revise applies the instruction to all and auto-saves
- **Generate CZ** — one-click Czech translation of the current file via Claude API; uses `characterVoices` for consistent tone
- **⟳ Generate All CZ** — translates all files in one go
- **⬇ Export CSV** / **⬆ Import CSV** — export all EN+CZ strings to a spreadsheet, fill in CZ offline, import back (CZ mode)
- **Untranslated badge** — orange number on cell = empty CZ strings remaining
- **Lint badge** — red ⚠ on written cells: flags missing `return` or sprite shown but never hidden
- **Translation memory** — collapsible phrase list; injected into translation prompts for consistency
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
| `labelPattern` | Label naming pattern | `"winston_{location}_{state}"` |
| `filePattern` | File path pattern relative to `gameDir` | `"winston/winston_{location}.rpy"` |
| `locations` | List of locations | `["bathroom", "bedroom"]` |
| `states` | List of states (e.g. outfit) | `["naked", "towel", "negligee"]` |
| `port` | Port for the local server (default: 3000) | `3000` |
| `tlDir` | Translation directory relative to `gameDir` (default: `"tl/czech"`) | `"tl/czech"` |
| `characters` | Character variable names for dialogue detection (default: `["a","l","narrator"]`) | `["a","l","narrator"]` |
| `characterVoices` | Voice descriptions for each character — injected into Draft EN and Generate CZ prompts | `{ "a": "formal butler...", "l": "sardonic thoughts..." }` |
| `anthropicApiKey` | Anthropic API key for AI features (optional, prefer env var) | `"sk-ant-..."` |
| `renpyExe` | Path to `renpy.exe` for the ▶ Launch button | `"C:/RenPy/renpy.exe"` |
| `locationDescs` | Location descriptions injected into Draft EN prompt | `{ "bedroom": "..." }` |
| `stateDescs` | State descriptions injected into Draft EN prompt | `{ "naked": "..." }` |

Copy `.dispatcher.example.json` to `.dispatcher.json` in your project and adjust the values.

## Typical workflow

### Writing new dialogue (EN)

1. Start the editor: `dispatcher-editor` → open **http://localhost:3000**
2. Use the **filter bar** to show only ✗ or ~ cells — find what needs work
3. **Right-click → Insert template** — pre-fills a starter dialogue skeleton directly in Monaco
   - Or: **`Ctrl+D` / ✦ Draft EN** → AI writes a full draft based on location, state and character voices
4. Write or edit the dialogue, `Ctrl+S` to save
5. The grid cell turns **✓ N** immediately (watch mode keeps the grid live)
6. If the draft needs changes: **`Ctrl+R` / ✎ Revise** → type instruction (e.g. "shorten", "add tension") → Go → review diff → Accept

```
dispatcher editor                VS Code
──────────────────               ──────────────────────
filter → find gaps
right-click → template        →  (or open via path link)
Ctrl+D draft / write          ←→ edit .rpy, Ctrl+S
Ctrl+R revise → diff → Accept    watch mode refreshes grid
```

### Batch revise

Ctrl+click multiple cells → type one instruction → Go — all selected labels are revised and auto-saved in sequence. No diff for batch mode.

### Translating to Czech

1. Switch to **CZ** (`Ctrl+G`)
2. **⟳ Generate All CZ** — translates all files at once via Claude API (set API key first)
   - Or **Generate CZ** (`Ctrl+G` with cell open) for just the current file
3. Review in Monaco (toggle **⧉ Split EN** to see EN source beside CZ)
4. `Ctrl+S` to save — the **orange badge** shows how many strings are still empty
5. Fill gaps manually, or export to CSV and fill in a spreadsheet

```
EN mode: write story  →  CZ mode: Ctrl+G → Generate All CZ
                          review in Split view
                          fix empty strings (orange badge)
                          Ctrl+S
                          — or — Export CSV → fill → Import CSV
```

### Daily routine

```
1. dispatcher-editor              # start server
2. Filter → ✗ or ~               # find gaps
3. Ctrl+D draft → Ctrl+R revise  # write EN dialogue
4. Ctrl+S → cell turns ✓ N
5. Ctrl+G → Generate CZ → Ctrl+S
6. Repeat
```

## Generate CZ (AI translation)

Switch to **CZ** mode, open any cell, then click **Generate CZ** (or `Ctrl+G`). The server parses the English source, computes Ren'Py-compatible MD5 hashes, calls Claude to translate, and loads the result into Monaco for review. Save with `Ctrl+S` when happy.

Character voices (`characterVoices` in config) are injected into the prompt so the translation matches the established tone.

API key priority: UI input field → `ANTHROPIC_API_KEY` env var → `anthropicApiKey` in `.dispatcher.json`.

Uses Claude Haiku — costs under $0.01 per file.

## How label detection works

A label is considered:
- **written** — `label X_Y_Z:` exists and the block contains at least one dialogue line
- **stub** — label exists but has no dialogue (only `return` or `# TODO`)
- **missing** — label line not found in the file

Fallthrough labels (multiple `label X:` lines sharing one block) are handled correctly.

## Lint checks

Run on every written label:
- **missing return** — label block has no `return` statement
- **sprite shown but never hidden** — `show <char>` appears but no `hide <char>` anywhere in the block

The sprite name is derived from the first segment of `labelPattern` (e.g. `winston` from `winston_{location}_{state}`). Show/hide counts include all occurrences across the entire block (menu branches included), so only a total absence of `hide` triggers a warning — branch-level imbalances are ignored since menu branches are mutually exclusive.
