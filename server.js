#!/usr/bin/env node
const express = require('express');
const fs = require('fs');
const path = require('path');

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

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = config.port || 3000;
app.listen(PORT, () => {
    console.log(`\nDispatcher Editor → http://localhost:${PORT}`);
    console.log(`Project: ${projectPath}\n`);
});
