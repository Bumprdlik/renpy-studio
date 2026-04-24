# Ren'Py Studio

AI-assisted editor for Ren'Py visual novel projects — coverage grid, Monaco editor, dialogue AI, story arc generator, quest builder, and translation tools.

## What it does

### Coverage grid
- Overview of all `label <prefix>_<location>_<state>:` combinations with color coding: ✓ written / ~ stub / ✗ missing
- Written cells show dialogue line count (`✓ 18`); filter bar, progress bar, character stats
- Click any cell → opens `.rpy` in Monaco, scrolled to that label; hover → tooltip with first 6 lines
- **Keyboard navigation** — arrow keys + Enter; **Search** across all source files
- **Auto-refresh** — grid updates live when `.rpy` files change on disk
- **Lint badge** — ⚠ flags missing `return` or sprite shown but never hidden
- **Untranslated badge** — orange = empty CZ strings remaining

### AI dialogue tools
- **✦ Draft EN** (`Ctrl+D`) — Claude Sonnet writes a full label from scratch (uses `characterVoices`, `locationDescs`, `stateDescs`)
- **✎ Revise** (`Ctrl+R`) — rewrite with a one-line instruction; before/after diff modal before applying
- **Batch revise** — Ctrl+click multiple cells → one instruction revises all, auto-saves

### Translation
- **EN/CZ toggle** (`Ctrl+G`) + **⧉ Split EN** reference panel
- **Generate CZ** / **⟳ Generate All CZ** — Claude Haiku translates full files; uses translation memory for consistency
- **⬇ Export CSV** / **⬆ Import CSV** — offline translation workflow
- **🧠 Translation memory** — phrase pairs injected into translation prompts

### Quest tools
- **📋 Quest Builder** — modal form: define quest id, title, description, and steps (location, time, mood, notes, Winston present, player choices); saves `quest-spec.json` for AI generation + updates `quests.json` for tracking
- **📖 Story Arc** — describe a story arc → Claude generates 4–8 events → edit the list → create stub `.rpy` files in one click
- **Quests tab** — shows quest progress (missing / stub / written) per event; "+ Create" creates stub files

### Other
- **▶ Launch** (`Ctrl+L`) — opens Ren'Py directly from the editor
- **Keyboard shortcuts** — `Ctrl+S` save, `Ctrl+D` draft, `Ctrl+R` revise, `Ctrl+G` translate, `Ctrl+L` launch

## Installation

```bash
git clone git@github.com:Bumprdlik/renpy-studio.git
cd renpy-studio
npm install
npm link        # makes `renpy-studio` available globally
```

## Usage

1. Add a `.dispatcher.json` to the root of your Ren'Py project (see `.dispatcher.example.json`)
2. Run from your project directory:

```bash
cd /path/to/your-renpy-project
renpy-studio
```

Or with an explicit path:

```bash
renpy-studio --project=/path/to/your-renpy-project
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

### Quest workflow

1. **📋 Quest** → vyplň název, popis, kroky → **Uložit** → vznikne `quest-spec.json` + `quests.json`
2. Přepni na tab **Quests** → vidíš event status (missing/stub/written); klikni **+ Create** pro stub soubory
3. Řekni Claude Code: *"vytvoř quest podle quest-spec.json"* → vygeneruje `.rpy` eventy s dialogy

### Daily routine

```
1. renpy-studio                   # start server
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
