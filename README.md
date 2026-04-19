# Ren'Py Dispatcher Editor

Visual editor for the Ren'Py dispatcher pattern — shows a **location × state** coverage grid and lets you edit `.rpy` files directly in the browser using Monaco editor.

## What it does

- Grid overview of all `label <prefix>_<location>_<state>:` combinations
- Color coding: ✓ written / ~ stub / ✗ missing
- Click any cell → opens the corresponding `.rpy` file in Monaco editor, scrolled to that label
- `Ctrl+S` saves the file and refreshes the grid

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

Copy `.dispatcher.example.json` to `.dispatcher.json` in your project and adjust the values.

## How label detection works

A label is considered:
- **written** — `label alfred_X_Y:` exists and the block contains at least one dialogue line (`a "..."` / `l "..."`)
- **stub** — label exists but has no dialogue (only `return` or empty)
- **missing** — label line not found in the file

Fallthrough labels (multiple `label X:` lines sharing one block) are handled correctly.
