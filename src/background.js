// npm run background: start the server in the background (no window), output goes to data/server.log.
// npm run stop: stop the background server. Same on Windows / macOS / Linux.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const PID_FILE = path.join(DATA_DIR, 'server.pid');
const LOG_FILE = path.join(DATA_DIR, 'server.log');
const PORT = Number(process.env.PORT) || 8788;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The PID file holds "pid port" (older versions: pid only)
function running() {
    try {
        const [pidStr, portStr] = fs.readFileSync(PID_FILE, 'utf8').trim().split(/\s+/);
        const pid = Number(pidStr);
        if (!pid) return null;
        process.kill(pid, 0); // only checks it's alive, doesn't kill it
        return { pid, port: Number(portStr) || PORT };
    } catch {
        return null;
    }
}

const alive = (pid) => {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
};

async function start() {
    const cur = running();
    if (cur) {
        console.log(`Perch is already running in the background (PID ${cur.pid}): http://127.0.0.1:${cur.port}`);
        return;
    }
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const out = fs.openSync(LOG_FILE, 'a');
    const child = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', path.join(__dirname, 'server.js')], {
        cwd: ROOT,
        detached: true,
        stdio: ['ignore', out, out],
        windowsHide: true,
    });
    child.unref();
    // Report only once the server is really up (PID file written); exiting early usually means the port is taken
    for (let i = 0; i < 50; i++) {
        await sleep(200);
        const now = running();
        if (now && now.pid === child.pid) {
            console.log(`Perch started in the background (PID ${child.pid}): http://127.0.0.1:${now.port}`);
            console.log(`Log: ${LOG_FILE}  Stop: npm run stop`);
            return;
        }
        if (!alive(child.pid)) break;
    }
    console.log(`Perch did not start. Port ${PORT} may be taken by another program (such as the Perch desktop app); see ${LOG_FILE}`);
    process.exitCode = 1;
}

async function stop() {
    const cur = running();
    if (!cur) {
        console.log('Perch is not running in the background');
        return;
    }
    // Ask the server to shut down cleanly first; force-kill only if it does not respond
    try {
        const res = await fetch(`http://127.0.0.1:${cur.port}/api/shutdown`, { method: 'POST', headers: { 'x-perch': 'stop' }, signal: AbortSignal.timeout(3000) });
        if (res.ok) {
            console.log(`Stopped Perch (PID ${cur.pid})`);
            return;
        }
    } catch { /* no response */ }
    process.kill(cur.pid, 'SIGTERM');
    console.log(`Perch did not respond and was killed (PID ${cur.pid})`);
}

if (process.argv.includes('stop')) stop();
else start();
