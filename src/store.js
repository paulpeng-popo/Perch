// Settings and caches are stored as JSON in the data folder (4-space indent)
const fs = require('node:fs');
const path = require('node:path');

// The desktop app (Electron) sets PERCH_DATA_DIR to a folder next to the app; the CLI version uses the project's data folder
const DATA_DIR = process.env.PERCH_DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

function readJson(name, fallback) {
    try {
        return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8'));
    } catch {
        return fallback;
    }
}

function writeJson(name, data) {
    const file = path.join(DATA_DIR, name);
    fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(data, null, 4)}\n`);
    fs.renameSync(`${file}.tmp`, file);
}

let settings = readJson('settings.json', {});

const getSetting = (key, fallback = null) => (settings[key] ?? fallback);
function setSetting(key, value) {
    settings = { ...settings, [key]: value };
    writeJson('settings.json', settings);
}

module.exports = { DATA_DIR, readJson, writeJson, getSetting, setSetting };
