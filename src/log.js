// In-memory log (shown in the Log tab), also printed to the console
const lines = [];

function log(msg) {
    const entry = { time: new Date().toISOString(), msg };
    lines.push(entry);
    if (lines.length > 500) lines.shift();
    console.log(`[${entry.time}] ${msg}`);
}

module.exports = { log, lines };
