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
    const tlDir = config.tlDir || 'tl/czech';
    return path.join(gameDir, tlDir, config.filePattern.replace('{location}', location));
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

// Call Claude API to translate dialogue and menu strings
async function translateWithClaude(blocks, menuStrings, targetLang, apiKey) {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });

    const tlDir = config.tlDir || 'tl/czech';
    const langName = tlDir.split('/').pop(); // e.g. "czech"

    const items = [
        ...blocks.map(b => ({ who: b.who || 'narrator', text: b.parsedWhat })),
        ...menuStrings.map(m => ({ who: 'menu', text: m.text })),
    ];

    if (items.length === 0) return { dialogueTranslations: [], menuTranslations: [] };

    const prompt = `Translate the following Ren'Py visual novel strings from English to ${langName}.

Character voices:
- "a" = Alfred, formal English butler, polite, slightly archaic phrasing
- "l" = Lara, first-person inner thoughts, slightly sardonic and self-aware
- "narrator" = neutral scene description, concise
- "menu" = player choice button labels, keep short

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
        out += `translate czech ${id}:\n\n`;
        out += `    # ${origLine}\n`;
        out += `    ${translLine}\n\n`;
    }

    if (menuStrings.length > 0) {
        out += `translate czech strings:\n\n`;
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

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

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
    const idx = lines.findIndex(l => l.trim().startsWith(`translate czech ${labelName}_`));
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
            await translateWithClaude(blocks, menuStrings, config.tlDir || 'tl/czech', apiKey);

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

        const prompt = `You are writing dialogue for a Ren'Py visual novel called "Lara".

Characters:
- Alfred (variable: a): formal English butler, polite, slightly stiff, proper British mannerisms, secretly fascinated by Lara
- Lara (variable: l): first-person inner thoughts/narration, slightly sardonic, self-aware, bold

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
            const re = new RegExp(`translate czech ${labelName}_[a-f0-9_]+:[\\s\\S]*?(?=translate czech |$)`, 'g');
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
