#!/usr/bin/env node
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── Config ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const projectFlag = args.find(a => a.startsWith('--project='));
const projectPath = projectFlag
    ? path.resolve(projectFlag.replace('--project=', ''))
    : path.resolve(args[0] || process.cwd());

const configPath = path.join(projectPath, '.dispatcher.json');
if (!fs.existsSync(configPath)) {
    console.error(`\nConfig not found: ${configPath}`);
    console.error('Add a .dispatcher.json file to your Ren\'Py project.\n');
    process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
config.tlLang = config.tlLang || (config.tlDir || 'tl/czech').split('/').pop();
config.tlLangLabel = config.tlLangLabel || config.tlLang.slice(0, 2).toUpperCase();
const gameDir = path.join(projectPath, config.gameDir);

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveFilePath(location) {
    return path.join(gameDir, config.filePattern.replace('{location}', location));
}

function getLabelStatus(content, labelName) {
    const lines = content.split('\n');

    // Find the target label line
    const startIdx = lines.findIndex(l => l.trim() === `label ${labelName}:`);
    if (startIdx === -1) return 'missing';

    // Skip consecutive fallthrough labels
    let contentStart = startIdx + 1;
    while (
        contentStart < lines.length &&
        lines[contentStart].trim().match(/^label\s+\w[\w_]*:/)
    ) {
        contentStart++;
    }

    // Scan content block for any dialogue line
    for (let i = contentStart; i < lines.length; i++) {
        const line = lines[i];
        if (line.match(/^label\s+/)) break; // next top-level label
        if (line.match(/^\s+(a|l|narrator)\s+"/)) return 'written';
    }

    return 'stub';
}

function buildLabelName(location, state) {
    return config.labelPattern
        .replace('{location}', location)
        .replace('{state}', state);
}

function resolveTlFilePath(location) {
    return path.join(gameDir, config.tlDir || `tl/${config.tlLang}`, config.filePattern.replace('{location}', location));
}

// ── Translation helpers ───────────────────────────────────────────────────────

// Replicates Ren'Py's encode_say_string (translation/__init__.py:277)
function encodeSayString(s) {
    s = s.replace(/\\/g, '\\\\');
    s = s.replace(/\n/g, '\\n');
    s = s.replace(/"/g, '\\"');
    s = s.replace(/(?<= ) /g, '\\ ');
    return '"' + s + '"';
}

// Unescape a string extracted from .rpy source by regex
function unescapeRpyString(s) {
    return s
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\')
        .replace(/\\n/g, '\n')
        .replace(/\\ /g, ' ');
}

// Compute Ren'Py translation hash (first 8 hex chars of MD5)
function computeHash(who, parsedWhat) {
    const encoded = encodeSayString(parsedWhat);
    const code = who ? `${who} ${encoded}` : encoded;
    return crypto.createHash('md5').update(code + '\r\n', 'utf8').digest('hex').slice(0, 8);
}

function uniqueIdentifier(label, digest, seenIds) {
    let id = `${label}_${digest}`;
    let suffix = 0;
    while (seenIds.has(id)) {
        suffix++;
        id = `${label}_${digest}_${suffix}`;
    }
    seenIds.add(id);
    return id;
}

// Parse .rpy source into dialogue blocks and menu strings
function parseDialogue(content, characters) {
    const lines = content.split('\n');
    const blocks = [];    // { label, who, rawWhat, parsedWhat, sourceLine }
    const menuStrings = []; // { text, sourceLine }

    const KEYWORDS = new Set([
        'scene', 'show', 'hide', 'call', 'jump', 'return', 'menu',
        'if', 'elif', 'else', 'for', 'while', 'with', 'at', 'pass',
        'pause', 'play', 'stop', 'queue', 'image', 'define', 'default',
        'init', 'python', 'label', 'screen', 'transform', 'style', 'nvl',
    ]);

    let currentLabel = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNum = i + 1;

        // Top-level label declaration
        const labelMatch = line.match(/^label\s+([\w]+)\s*:/);
        if (labelMatch) {
            currentLabel = labelMatch[1];
            continue;
        }

        if (!currentLabel) continue;

        // Menu option string: `    "text":` at any indent level
        const menuMatch = line.match(/^(\s+)"((?:[^"\\]|\\.)*)"\s*:/);
        if (menuMatch) {
            menuStrings.push({ text: menuMatch[2], sourceLine: lineNum });
            continue;
        }

        // Say statement with speaker: `    who "text"` (any indent)
        const sayMatch = line.match(/^(\s+)(\w+)\s+"((?:[^"\\]|\\.)*)"\s*$/);
        if (sayMatch) {
            const who = sayMatch[2];
            const rawWhat = sayMatch[3];
            if (!KEYWORDS.has(who) && characters.includes(who)) {
                blocks.push({
                    label: currentLabel,
                    who,
                    rawWhat,
                    parsedWhat: unescapeRpyString(rawWhat),
                    sourceLine: lineNum,
                });
            }
            continue;
        }

        // Narrator string: `    "text"` (any indent, no speaker, no colon)
        const narratorMatch = line.match(/^(\s+)"((?:[^"\\]|\\.)*)"\s*$/);
        if (narratorMatch) {
            const rawWhat = narratorMatch[2];
            if (characters.includes('narrator') || characters.length === 0) {
                blocks.push({
                    label: currentLabel,
                    who: null,
                    rawWhat,
                    parsedWhat: unescapeRpyString(rawWhat),
                    sourceLine: lineNum,
                });
            }
        }
    }

    return { blocks, menuStrings };
}

// ── Translation memory ────────────────────────────────────────────────────────

function resolveMemoryPath() {
    return path.join(projectPath, '.dispatcher-memory.json');
}
function loadMemory() {
    const p = resolveMemoryPath();
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : [];
}
function saveMemory(memory) {
    fs.writeFileSync(resolveMemoryPath(), JSON.stringify(memory, null, 2), 'utf-8');
}

// ── Express app ──────────────────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/tl-memory', (req, res) => res.json(loadMemory()));

app.put('/api/tl-memory', (req, res) => {
    saveMemory(req.body);
    res.json({ ok: true });
});

app.delete('/api/tl-memory/:idx', (req, res) => {
    const mem = loadMemory();
    mem.splice(parseInt(req.params.idx), 1);
    saveMemory(mem);
    res.json({ ok: true });
});

app.post('/api/tl-memory/learn', (req, res) => {
    const memory = loadMemory();
    const existing = new Set(memory.map(m => `${m.who}||${m.en}`));
    let added = 0;

    for (const loc of config.locations) {
        const tlPath = resolveTlFilePath(loc);
        if (!fs.existsSync(tlPath)) continue;
        const lines = fs.readFileSync(tlPath, 'utf-8').split('\n');
        for (let i = 0; i < lines.length - 1; i++) {
            const cm = lines[i].match(/^\s+#\s+(a|l|narrator)\s+"((?:[^"\\]|\\.)*)"\s*$/);
            if (!cm) continue;
            let j = i + 1;
            while (j < lines.length && !lines[j].trim()) j++;
            const tm = lines[j]?.match(/^\s+(a|l|narrator)\s+"((?:[^"\\]|\\.)*)"\s*$/);
            if (!tm || !tm[2]) continue;
            const key = `${cm[1]}||${cm[2]}`;
            if (!existing.has(key)) {
                memory.push({ who: cm[1], en: cm[2], cz: tm[2] });
                existing.add(key);
                added++;
            }
        }
    }
    saveMemory(memory);
    res.json({ ok: true, added, total: memory.length });
});

// ── Line count ────────────────────────────────────────────────────────────────

function getLabelLineCount(content, labelName) {
    const lines = content.split('\n');
    const startIdx = lines.findIndex(l => l.trim() === `label ${labelName}:`);
    if (startIdx === -1) return 0;
    let count = 0;
    for (let i = startIdx + 1; i < lines.length; i++) {
        if (lines[i].match(/^label\s+/)) break;
        if (lines[i].match(/^\s+(a|l|narrator)\s+"/)) count++;
    }
    return count;
}

app.get('/api/line-counts', (req, res) => {
    const result = {};
    for (const loc of config.locations) {
        result[loc] = {};
        const content = fs.existsSync(resolveFilePath(loc))
            ? fs.readFileSync(resolveFilePath(loc), 'utf-8') : '';
        for (const state of config.states) {
            result[loc][state] = getLabelLineCount(content, buildLabelName(loc, state));
        }
    }
    res.json(result);
});

// ── Lint ──────────────────────────────────────────────────────────────────────

function lintLabel(content, labelName) {
    const lines = content.split('\n');
    const startIdx = lines.findIndex(l => l.trim() === `label ${labelName}:`);
    if (startIdx === -1) return [];

    // Skip consecutive fallthrough labels (same logic as getLabelStatus)
    let contentStart = startIdx + 1;
    while (
        contentStart < lines.length &&
        lines[contentStart].trim().match(/^label\s+\w[\w_]*:/)
    ) {
        contentStart++;
    }

    const issues = [];
    let showCount = 0, hideCount = 0, hasReturn = false;
    // Detect the sprite character name from labelPattern (e.g. "winston" from "winston_{location}_{state}")
    const spriteChar = config.labelPattern.split('_')[0];

    for (let i = contentStart; i < lines.length; i++) {
        const line = lines[i];
        if (line.match(/^label\s+/)) break;
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        if (t === 'return') hasReturn = true;
        if (t.match(new RegExp(`^show ${spriteChar}\\b`))) showCount++;
        if (t.match(new RegExp(`^hide ${spriteChar}\\b`))) hideCount++;
    }

    if (!hasReturn) issues.push('missing return');
    // Only warn if Winston is shown but never hidden anywhere in the block
    // (don't count branch-by-branch — menu branches are mutually exclusive)
    if (showCount > 0 && hideCount === 0) issues.push(`${spriteChar} shown but never hidden`);
    return issues;
}

app.get('/api/lint', (req, res) => {
    const result = {};
    for (const loc of config.locations) {
        result[loc] = {};
        const content = fs.existsSync(resolveFilePath(loc))
            ? fs.readFileSync(resolveFilePath(loc), 'utf-8') : '';
        for (const state of config.states) {
            const labelName = buildLabelName(loc, state);
            const status = getLabelStatus(content, labelName);
            result[loc][state] = status === 'written' ? lintLabel(content, labelName) : [];
        }
    }
    res.json(result);
});

// ── Call Claude API to translate dialogue and menu strings ─────────────────────
async function translateWithClaude(blocks, menuStrings, targetLang, apiKey) {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });

    const items = [
        ...blocks.map(b => ({ who: b.who || 'narrator', text: b.parsedWhat })),
        ...menuStrings.map(m => ({ who: 'menu', text: m.text })),
    ];

    if (items.length === 0) return { dialogueTranslations: [], menuTranslations: [] };

    const memory = loadMemory();
    const memoryHint = memory.length > 0
        ? `\nUse these established translations for consistency:\n${memory.slice(0, 40).map(m => `  ${m.who} "${m.en}" → "${m.cz}"`).join('\n')}\n`
        : '';

    const defaultVoices = {
        a: 'formal English butler, polite, slightly archaic phrasing',
        l: 'first-person inner thoughts, slightly sardonic and self-aware',
        narrator: 'neutral scene description, concise',
    };
    const voices = config.characterVoices || defaultVoices;
    const charDesc = (config.characters || ['a', 'l', 'narrator'])
        .map(c => `- "${c}" = ${voices[c] || defaultVoices[c] || 'character'}`)
        .join('\n');

    const prompt = `Translate the following Ren'Py visual novel strings from English to ${config.tlLang}.

Character voices:
${charDesc}
- "menu" = player choice button labels, keep short
${memoryHint}
Return ONLY a valid JSON array with one object per input item, in the same order, each with a single "t" field containing the translation. No markdown, no explanation.

Input:
${JSON.stringify(items)}`;

    const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].text.trim();
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('Claude did not return valid JSON: ' + text.slice(0, 200));
    const parsed = JSON.parse(jsonMatch[0]);

    return {
        dialogueTranslations: parsed.slice(0, blocks.length).map(x => x.t || ''),
        menuTranslations: parsed.slice(blocks.length).map(x => x.t || ''),
    };
}

// Build tl file content from parsed blocks + translations
function buildTlContent(blocks, menuStrings, dialogueTranslations, menuTranslations, relPath) {
    const seenIds = new Set();
    let out = '';

    for (let i = 0; i < blocks.length; i++) {
        const { label, who, rawWhat, parsedWhat, sourceLine } = blocks[i];
        const digest = computeHash(who, parsedWhat);
        const id = uniqueIdentifier(label, digest, seenIds);
        const origLine = who ? `${who} "${rawWhat}"` : `"${rawWhat}"`;
        const translation = dialogueTranslations[i] || '';
        const translationEncoded = encodeSayString(translation).slice(1, -1); // strip outer quotes
        const translLine = who ? `${who} "${translationEncoded}"` : `"${translationEncoded}"`;

        out += `# game/${relPath}:${sourceLine}\n`;
        out += `translate ${config.tlLang} ${id}:\n\n`;
        out += `    # ${origLine}\n`;
        out += `    ${translLine}\n\n`;
    }

    if (menuStrings.length > 0) {
        out += `translate ${config.tlLang} strings:\n\n`;
        for (let i = 0; i < menuStrings.length; i++) {
            const { text, sourceLine } = menuStrings[i];
            const translation = menuTranslations[i] || '';
            out += `    # game/${relPath}:${sourceLine}\n`;
            out += `    old "${text}"\n`;
            out += `    new "${translation}"\n\n`;
        }
    }

    return out;
}

// ── API ───────────────────────────────────────────────────────────────────────

app.get('/api/config', (req, res) => {
    res.json({ config, projectPath });
});

app.get('/api/status', (req, res) => {
    const grid = {};
    for (const loc of config.locations) {
        grid[loc] = {};
        const filePath = resolveFilePath(loc);
        const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
        for (const state of config.states) {
            const labelName = buildLabelName(loc, state);
            grid[loc][state] = getLabelStatus(content, labelName);
        }
    }
    res.json(grid);
});

app.get('/api/file/:location', (req, res) => {
    const filePath = resolveFilePath(req.params.location);
    const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
    res.json({ content, path: filePath });
});

app.put('/api/file/:location', (req, res) => {
    const filePath = resolveFilePath(req.params.location);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, req.body.content, 'utf-8');
    res.json({ ok: true });
});

app.get('/api/tl-file/:location', (req, res) => {
    const filePath = resolveTlFilePath(req.params.location);
    if (!fs.existsSync(filePath)) return res.json({ content: null, path: filePath });
    res.json({ content: fs.readFileSync(filePath, 'utf-8'), path: filePath });
});

app.put('/api/tl-file/:location', (req, res) => {
    const filePath = resolveTlFilePath(req.params.location);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, req.body.content, 'utf-8');
    res.json({ ok: true });
});

app.get('/api/tl-label-line/:location/:state', (req, res) => {
    const { location, state } = req.params;
    const filePath = resolveTlFilePath(location);
    if (!fs.existsSync(filePath)) return res.json({ line: -1 });

    const labelName = buildLabelName(location, state);
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
    const idx = lines.findIndex(l => l.trim().startsWith(`translate ${config.tlLang} ${labelName}_`));
    res.json({ line: idx + 1 });
});

app.post('/api/stub/:location/:state', (req, res) => {
    const { location, state } = req.params;
    const filePath = resolveFilePath(location);
    const labelName = buildLabelName(location, state);

    const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
    if (existing.split('\n').some(l => l.trim() === `label ${labelName}:`)) {
        return res.json({ ok: true, created: false });
    }

    const stub = `\nlabel ${labelName}:\n    # TODO\n    return\n`;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, stub, 'utf-8');
    res.json({ ok: true, created: true });
});

app.get('/api/preview/:location/:state', (req, res) => {
    const { location, state } = req.params;
    const filePath = resolveFilePath(location);
    if (!fs.existsSync(filePath)) return res.json({ lines: [] });

    const content = fs.readFileSync(filePath, 'utf-8');
    const labelName = buildLabelName(location, state);
    const lines = content.split('\n');

    const startIdx = lines.findIndex(l => l.trim() === `label ${labelName}:`);
    if (startIdx === -1) return res.json({ lines: [] });

    const CHAR_RE = /^\s+(a|l|narrator)\s+"((?:[^"\\]|\\.)*)"/;
    const preview = [];
    for (let i = startIdx + 1; i < lines.length && preview.length < 6; i++) {
        if (lines[i].match(/^label\s+/)) break;
        const m = lines[i].match(CHAR_RE);
        if (m) preview.push({ who: m[1], text: unescapeRpyString(m[2]) });
    }
    res.json({ lines: preview });
});

app.get('/api/label-line/:location/:state', (req, res) => {
    const { location, state } = req.params;
    const filePath = resolveFilePath(location);
    if (!fs.existsSync(filePath)) return res.json({ line: -1 });

    const content = fs.readFileSync(filePath, 'utf-8');
    const labelName = buildLabelName(location, state);
    const lines = content.split('\n');
    const idx = lines.findIndex(l => l.trim() === `label ${labelName}:`);
    res.json({ line: idx + 1 }); // Monaco is 1-based
});

app.post('/api/generate-tl/:location', async (req, res) => {
    try {
        const { location } = req.params;
        const apiKey = req.body.apiKey
            || process.env.ANTHROPIC_API_KEY
            || config.anthropicApiKey;

        if (!apiKey) {
            return res.status(400).json({
                error: 'No Anthropic API key. Set ANTHROPIC_API_KEY env var or add "anthropicApiKey" to .dispatcher.json.',
            });
        }

        const filePath = resolveFilePath(location);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Source file not found: ' + filePath });
        }

        const content = fs.readFileSync(filePath, 'utf-8');
        const relPath = path.relative(gameDir, filePath).replace(/\\/g, '/');
        const characters = config.characters || ['a', 'l', 'narrator'];

        const { blocks, menuStrings } = parseDialogue(content, characters);

        if (blocks.length === 0 && menuStrings.length === 0) {
            return res.json({ content: '', empty: true });
        }

        const { dialogueTranslations, menuTranslations } =
            await translateWithClaude(blocks, menuStrings, config.tlLang, apiKey);

        const tlContent = buildTlContent(
            blocks, menuStrings, dialogueTranslations, menuTranslations, relPath
        );

        res.json({ content: tlContent });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── AI draft EN dialogue ──────────────────────────────────────────────────────

function extractLabelBlocks(content, excludeLabel, maxBlocks) {
    const lines = content.split('\n');
    const blocks = [];
    let currentLabel = null;
    let blockStart = -1;

    for (let i = 0; i <= lines.length; i++) {
        const line = lines[i] || '';
        const lm = line.match(/^label\s+([\w]+)\s*:/);
        if (lm || i === lines.length) {
            if (currentLabel && currentLabel !== excludeLabel && blockStart >= 0) {
                const blockLines = lines.slice(blockStart, i);
                if (blockLines.some(l => l.match(/^\s+(a|l|narrator)\s+"/))) {
                    blocks.push(blockLines.join('\n').trimEnd());
                    if (blocks.length >= maxBlocks) break;
                }
            }
            if (lm) { currentLabel = lm[1]; blockStart = i; }
        }
    }
    return blocks.join('\n\n');
}

app.post('/api/draft-en/:location/:state', async (req, res) => {
    try {
        const { location, state } = req.params;
        const apiKey = req.body.apiKey || process.env.ANTHROPIC_API_KEY || config.anthropicApiKey;
        if (!apiKey) return res.status(400).json({ error: 'No Anthropic API key.' });

        const filePath = resolveFilePath(location);
        const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
        const labelName = buildLabelName(location, state);
        const styleExamples = extractLabelBlocks(content, labelName, 2);

        const locationDescs = config.locationDescs || {
            bathroom: 'bathroom — cold tiles, intimate, Lara after or before shower',
            bedroom:  'bedroom — most private space, Lara dresses/undresses here',
            dining_room: 'dining room — formal, Alfred serves meals here',
        };
        const stateDescs = config.stateDescs || {
            naked:     'completely naked',
            towel:     'wrapped only in a towel',
            negligee:  'wearing a sheer negligee',
            underwear: 'in underwear',
            casual:    'in casual clothes (shorts and t-shirt)',
        };

        const Anthropic = require('@anthropic-ai/sdk');
        const client = new Anthropic({ apiKey });

        const characters = config.characters || ['a', 'l', 'narrator'];
        const defaultVoices = {
            a: 'formal butler, polite, slightly stiff',
            l: 'first-person inner thoughts, sardonic, self-aware',
            narrator: 'neutral scene description, concise',
        };
        const voices = config.characterVoices || defaultVoices;
        const charLines = characters
            .filter(c => c !== 'narrator')
            .map(c => `- ${c}: ${voices[c] || defaultVoices[c] || 'character'}`)
            .join('\n');

        const prompt = `You are writing dialogue for a Ren'Py visual novel.

Characters:
${charLines}

Scene: ${locationDescs[location] || location}
Lara's current state: ${stateDescs[state] || state}
Label to fill: ${labelName}

${styleExamples ? `Style examples from this file — match this tone exactly:\n\n${styleExamples}\n` : ''}
Write the body of label \`${labelName}\` (do NOT include the label line itself).

Requirements:
- Open with \`show alfred\` at appropriate expression (neutral / surprised / flustered)
- 2–3 player choices via menu, each with a short distinct outcome (2–4 lines)
- Close with \`hide alfred with dissolve\` and \`return\`
- Total 10–18 lines
- Return ONLY valid Ren'Py code, no markdown fences, no comments`;

        const response = await client.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 1024,
            messages: [{ role: 'user', content: prompt }],
        });

        res.json({ content: response.content[0].text.trim() });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── AI revise EN dialogue ─────────────────────────────────────────────────────

app.post('/api/revise-en/:location/:state', async (req, res) => {
    try {
        const { location, state } = req.params;
        const { content, instructions } = req.body;
        const apiKey = req.body.apiKey || process.env.ANTHROPIC_API_KEY || config.anthropicApiKey;
        if (!apiKey) return res.status(400).json({ error: 'No Anthropic API key.' });
        if (!content || !instructions) return res.status(400).json({ error: 'content and instructions required.' });

        const labelName = buildLabelName(location, state);
        const Anthropic = require('@anthropic-ai/sdk');
        const client = new Anthropic({ apiKey });

        const prompt = `You are editing a Ren'Py visual novel dialogue label.

Label: ${labelName}
Characters:
- Alfred (variable: a): formal English butler, polite, slightly stiff, proper British mannerisms
- Lara (variable: l): first-person inner thoughts, slightly sardonic, self-aware, bold

Current label body (without the label line):
${content}

Revision instruction: ${instructions}

Rewrite the label body following the instruction. Preserve the Ren'Py structure (show/hide alfred, menu, return). Return ONLY valid Ren'Py code, no markdown fences, no label line.`;

        const response = await client.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 1024,
            messages: [{ role: 'user', content: prompt }],
        });

        res.json({ content: response.content[0].text.trim() });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── CSV Export / Import ───────────────────────────────────────────────────────

function csvEscape(s) {
    return '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
}

function parseCSV(text) {
    const rows = [];
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    for (const line of lines) {
        if (!line.trim()) continue;
        const row = [];
        let i = 0;
        while (i < line.length) {
            if (line[i] === '"') {
                i++;
                let cell = '';
                while (i < line.length) {
                    if (line[i] === '"' && line[i + 1] === '"') { cell += '"'; i += 2; }
                    else if (line[i] === '"') { i++; break; }
                    else { cell += line[i++]; }
                }
                row.push(cell);
                if (line[i] === ',') i++;
            } else {
                const end = line.indexOf(',', i);
                if (end === -1) { row.push(line.slice(i)); break; }
                row.push(line.slice(i, end));
                i = end + 1;
            }
        }
        rows.push(row);
    }
    return rows;
}

app.get('/api/export-csv', (req, res) => {
    const characters = config.characters || ['a', 'l', 'narrator'];
    const rows = [['id', 'location', 'who', 'en', 'cz']];

    for (const loc of config.locations) {
        const filePath = resolveFilePath(loc);
        if (!fs.existsSync(filePath)) continue;
        const content = fs.readFileSync(filePath, 'utf-8');
        const { blocks, menuStrings } = parseDialogue(content, characters);

        const tlPath = resolveTlFilePath(loc);
        const tlContent = fs.existsSync(tlPath) ? fs.readFileSync(tlPath, 'utf-8') : '';
        const seenIds = new Set();

        for (const block of blocks) {
            const { label, who, parsedWhat } = block;
            const digest = computeHash(who, parsedWhat);
            const id = uniqueIdentifier(label, digest, seenIds);

            let cz = '';
            if (tlContent) {
                const blockIdx = tlContent.indexOf(`translate ${config.tlLang} ${id}:`);
                if (blockIdx !== -1) {
                    const nextIdx = tlContent.indexOf(`\ntranslate ${config.tlLang} `, blockIdx + 1);
                    const slice = nextIdx === -1 ? tlContent.slice(blockIdx) : tlContent.slice(blockIdx, nextIdx);
                    const charRe = who
                        ? new RegExp(`^\\s+${who}\\s+"((?:[^"\\\\]|\\\\.)*)"`, 'm')
                        : /^\s+"((?:[^"\\]|\\.)*)"/m;
                    const m = slice.match(charRe);
                    if (m) cz = unescapeRpyString(m[1]);
                }
            }
            rows.push([id, loc, who || 'narrator', parsedWhat, cz]);
        }

        for (const ms of menuStrings) {
            let cz = '';
            if (tlContent) {
                const esc = ms.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/"/g, '\\"');
                const m = tlContent.match(new RegExp(`old "${esc}"\\s*\\n\\s*new "((?:[^"\\\\]|\\\\.)*)"`));
                if (m) cz = unescapeRpyString(m[1]);
            }
            rows.push([`menu_${loc}_L${ms.sourceLine}`, loc, 'menu', ms.text, cz]);
        }
    }

    const csv = rows.map(r => r.map(csvEscape).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="translations.csv"');
    res.send(csv);
});

app.post('/api/import-csv', (req, res) => {
    try {
        const { csv } = req.body;
        if (!csv) return res.status(400).json({ error: 'csv required' });

        const rows = parseCSV(csv);
        if (rows.length < 2) return res.json({ ok: true, updated: 0 });

        const header = rows[0];
        const col = name => header.indexOf(name);
        const idIdx = col('id'), czIdx = col('cz'), whoIdx = col('who');
        const enIdx = col('en'), locIdx = col('location');
        if (idIdx === -1 || czIdx === -1 || locIdx === -1)
            return res.status(400).json({ error: 'CSV must have id, location, cz columns' });

        // Group by location
        const byLoc = {};
        for (let i = 1; i < rows.length; i++) {
            const r = rows[i];
            const id = r[idIdx] || '', cz = r[czIdx] || '', loc = r[locIdx] || '';
            if (!id || !cz || !loc) continue;
            if (!byLoc[loc]) byLoc[loc] = [];
            byLoc[loc].push({ id, cz, who: whoIdx >= 0 ? r[whoIdx] : '', en: enIdx >= 0 ? r[enIdx] : '' });
        }

        let updated = 0;
        for (const loc of Object.keys(byLoc)) {
            const tlPath = resolveTlFilePath(loc);
            if (!fs.existsSync(tlPath)) continue;
            let tlContent = fs.readFileSync(tlPath, 'utf-8');

            for (const { id, cz, who, en } of byLoc[loc]) {
                const encoded = encodeSayString(cz).slice(1, -1);

                if (id.startsWith('menu_')) {
                    const esc = en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/"/g, '\\"');
                    const before = tlContent;
                    tlContent = tlContent.replace(
                        new RegExp(`(old "${esc}"\\s*\\n\\s*new )"(?:[^"\\\\]|\\\\.)*"`),
                        (_, prefix) => `${prefix}"${encoded}"`
                    );
                    if (tlContent !== before) updated++;
                } else {
                    const blockIdx = tlContent.indexOf(`translate ${config.tlLang} ${id}:`);
                    if (blockIdx === -1) continue;
                    const nextIdx = tlContent.indexOf(`\ntranslate ${config.tlLang} `, blockIdx + 1);
                    const blockEnd = nextIdx === -1 ? tlContent.length : nextIdx;
                    const block = tlContent.slice(blockIdx, blockEnd);
                    const whoStr = who && who !== 'narrator' ? who : null;
                    const lineRe = whoStr
                        ? new RegExp(`^(\\s+)${whoStr}\\s+"(?:[^"\\\\]|\\\\.)*"\\s*$`, 'm')
                        : /^(\s+)"(?:[^"\\]|\\.)*"\s*$/m;
                    const newBlock = block.replace(lineRe, (_, indent) =>
                        whoStr ? `${indent}${whoStr} "${encoded}"` : `${indent}"${encoded}"`
                    );
                    if (newBlock !== block) {
                        tlContent = tlContent.slice(0, blockIdx) + newBlock + tlContent.slice(blockEnd);
                        updated++;
                    }
                }
            }

            fs.writeFileSync(tlPath, tlContent, 'utf-8');
        }

        res.json({ ok: true, updated });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── TL empty count ────────────────────────────────────────────────────────────

app.get('/api/tl-empty', (req, res) => {
    const result = {};
    for (const loc of config.locations) {
        result[loc] = {};
        const tlPath = resolveTlFilePath(loc);
        if (!fs.existsSync(tlPath)) {
            for (const state of config.states) result[loc][state] = 0;
            continue;
        }
        const content = fs.readFileSync(tlPath, 'utf-8');
        for (const state of config.states) {
            const labelName = buildLabelName(loc, state);
            const re = new RegExp(`translate ${config.tlLang} ${labelName}_[a-f0-9_]+:[\\s\\S]*?(?=translate ${config.tlLang} |$)`, 'g');
            let empty = 0;
            let m;
            while ((m = re.exec(content)) !== null) {
                if (m[0].match(/^\s+(a|l|narrator)\s+""\s*$/m)) empty++;
            }
            result[loc][state] = empty;
        }
    }
    res.json(result);
});

// ── Ren'Py launch ─────────────────────────────────────────────────────────────

app.post('/api/launch', (req, res) => {
    const renpyExe = config.renpyExe;
    if (!renpyExe) return res.status(400).json({ error: 'renpyExe not set in .dispatcher.json' });
    const { spawn } = require('child_process');
    const renpyProject = path.dirname(path.join(projectPath, config.gameDir));
    spawn(renpyExe, [renpyProject], { detached: true, stdio: 'ignore' }).unref();
    res.json({ ok: true });
});

// ── Story Arc ─────────────────────────────────────────────────────────────────

app.post('/api/story-arc', async (req, res) => {
    try {
        const { description, apiKey: reqKey } = req.body;
        const apiKey = reqKey || process.env.ANTHROPIC_API_KEY || config.anthropicApiKey;
        if (!apiKey) return res.status(400).json({ error: 'No Anthropic API key.' });
        if (!description) return res.status(400).json({ error: 'description required.' });

        const Anthropic = require('@anthropic-ai/sdk');
        const client = new Anthropic({ apiKey });

        const voices = config.characterVoices || {};
        const charDesc = Object.entries(voices).map(([k, v]) => `  ${k}: ${v}`).join('\n');

        const prompt = `You are planning events for a Ren'Py visual novel.

Available locations: ${config.locations.join(', ')}
Available times: morning, afternoon, evening
Characters:\n${charDesc || '  (see config)'}

Story arc: ${description}

Generate 4–8 events that form this story arc as a sequence of scenes. Each event is one .rpy file.

Return ONLY a valid JSON array, no markdown, no explanation:
[
  {
    "id": "ev_[snake_case]",
    "location": "[one of the available locations]",
    "time": "morning|afternoon|evening",
    "description": "one sentence — what happens in this scene",
    "condition": "renpy.store.day == 1",
    "priority": 10,
    "repeatable": false
  }
]`;

        const response = await client.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 1024,
            messages: [{ role: 'user', content: prompt }],
        });

        const text = response.content[0].text.trim();
        const match = text.match(/\[[\s\S]*\]/);
        if (!match) throw new Error('Claude did not return valid JSON');
        res.json({ events: JSON.parse(match[0]) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/create-events', (req, res) => {
    try {
        const { events } = req.body;
        if (!Array.isArray(events) || events.length === 0)
            return res.status(400).json({ error: 'events array required.' });

        const eventsDir = path.join(projectPath, config.gameDir, 'events');
        fs.mkdirSync(eventsDir, { recursive: true });

        const created = [], skipped = [];
        for (const ev of events) {
            const { id, location, time, description, condition, priority, repeatable } = ev;
            const filePath = path.join(eventsDir, `${id}.rpy`);
            if (fs.existsSync(filePath)) { skipped.push(id); continue; }

            const cond = condition || 'True';
            const prio = priority ?? 10;
            const rep = repeatable ? 'True' : 'False';
            const content =
`init python:
    register_event("${id}", {
        "location": "${location}",
        "time": "${time}",
        "condition": lambda: ${cond},
        "priority": ${prio},
        "repeatable": ${rep},
    })

label ${id}:
    scene bg ${location} with dissolve
    # ${description}
    # TODO
    $ seen_events.add("${id}")
    return
`;
            fs.writeFileSync(filePath, content, 'utf-8');
            created.push(id);
        }
        res.json({ ok: true, created, skipped });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── Stats + Search ───────────────────────────────────────────────────────────

app.get('/api/stats', (req, res) => {
    let total = 0, written = 0, stub = 0, missing = 0;
    const byChar = {};
    const charRe = /^\s+(\w+)\s+"/;
    const characters = config.characters || ['a', 'l', 'narrator'];

    for (const loc of config.locations) {
        const filePath = resolveFilePath(loc);
        const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
        for (const state of config.states) {
            total++;
            const s = getLabelStatus(content, buildLabelName(loc, state));
            if (s === 'written') written++;
            else if (s === 'stub') stub++;
            else missing++;
        }
        content.split('\n').forEach(line => {
            const m = line.match(charRe);
            if (m && characters.includes(m[1])) byChar[m[1]] = (byChar[m[1]] || 0) + 1;
        });
    }
    res.json({ total, written, stub, missing, byChar });
});

app.get('/api/search', (req, res) => {
    const q = (req.query.q || '').toLowerCase().trim();
    if (q.length < 2) return res.json([]);

    const results = [];
    for (const loc of config.locations) {
        const filePath = resolveFilePath(loc);
        if (!fs.existsSync(filePath)) continue;
        const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
        let currentLabel = null;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lm = line.match(/^label\s+([\w]+)\s*:/);
            if (lm) { currentLabel = lm[1]; continue; }
            if (currentLabel && line.toLowerCase().includes(q)) {
                results.push({ location: loc, label: currentLabel, line: i + 1, text: line.trim() });
                if (results.length >= 60) return res.json(results);
            }
        }
    }
    res.json(results);
});

// ── File watch + SSE ─────────────────────────────────────────────────────────

const sseClients = new Set();

app.get('/api/watch', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
});

function notifyClients(location) {
    const payload = `data: ${JSON.stringify({ location })}\n\n`;
    for (const client of sseClients) client.write(payload);
}

function watchSourceFiles() {
    const watchedDirs = new Set();
    for (const loc of config.locations) {
        const filePath = resolveFilePath(loc);
        const dir = path.dirname(filePath);
        if (watchedDirs.has(dir)) continue;
        watchedDirs.add(dir);

        if (!fs.existsSync(dir)) continue;
        fs.watch(dir, (event, filename) => {
            if (!filename || !filename.endsWith('.rpy')) return;
            const changedLoc = config.locations.find(l =>
                resolveFilePath(l) === path.join(dir, filename)
            );
            if (changedLoc) notifyClients(changedLoc);
        });
    }
    console.log(`Watching ${watchedDirs.size} director${watchedDirs.size === 1 ? 'y' : 'ies'} for changes.`);
}

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = config.port || 3000;
app.listen(PORT, () => {
    console.log(`\nDispatcher Editor → http://localhost:${PORT}`);
    console.log(`Project: ${projectPath}\n`);
    watchSourceFiles();
});
