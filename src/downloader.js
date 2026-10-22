// Save media into the download folder: one at a time, in a queue
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { getSetting } = require('./store');
const { log } = require('./log');
const x = require('./x');

const queue = [];
let current = null;
let stats = { done: 0, skipped: 0, failed: 0 };

// Default: X inside the system Downloads folder. The desktop app gets the real Downloads location from Electron
// (the user may have moved it to another drive or OneDrive); the CLI version can only use the home folder's Downloads.
const systemDownloads = () => process.env.PERCH_DOWNLOADS_DIR || path.join(os.homedir(), 'Downloads');
const root = () => getSetting('download_root') || path.join(systemDownloads(), 'X');
const safe = (s) => String(s || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 100) || '_';

function targetPath(it) {
    const ext = /^[a-z0-9]{2,5}$/i.test(it.ext || '') ? it.ext : 'bin';
    return path.join(root(), safe(it.user), `${safe(it.tweetId)}_${Number(it.idx) || 1}.${ext}`);
}

function enqueue(items) {
    let added = 0;
    for (const it of items || []) {
        if (!it || !it.url) continue;
        queue.push({ url: String(it.url), user: it.user, tweetId: it.tweetId, idx: it.idx, ext: it.ext });
        added++;
    }
    if (!current) run();
    return added;
}

async function run() {
    while (queue.length) {
        const it = queue.shift();
        const file = targetPath(it);
        current = { name: path.basename(file), received: 0, size: 0 };
        try {
            if (fs.existsSync(file)) {
                stats.skipped++;
                continue;
            }
            fs.mkdirSync(path.dirname(file), { recursive: true });
            const res = await x.fetchMedia(it.url);
            current.size = Number(res.headers.get('content-length')) || 0;
            const tmp = `${file}.part`;
            const body = Readable.fromWeb(res.body);
            body.on('data', (b) => {
                current.received += b.length;
            });
            await pipeline(body, fs.createWriteStream(tmp));
            fs.renameSync(tmp, file);
            stats.done++;
        } catch (e) {
            stats.failed++;
            log(`下載失敗 ${path.basename(file)}：${e.message}`);
            fs.rmSync(`${file}.part`, { force: true });
        }
    }
    if (current) log(`下載完成：新增 ${stats.done}、已存在略過 ${stats.skipped}、失敗 ${stats.failed}（${root()}）`);
    current = null;
    stats = { done: 0, skipped: 0, failed: 0 };
}

const snapshot = () => ({ downloading: current ? { ...current, queued: queue.length, ...stats } : null, root: root() });
const exists = (it) => fs.existsSync(targetPath(it));

module.exports = { enqueue, snapshot, exists, root };
