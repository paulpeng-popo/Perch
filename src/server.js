const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const express = require('express');
const { DATA_DIR, getSetting, setSetting } = require('./store');
const { log, lines } = require('./log');
const x = require('./x');
const api = require('./api');
const accounts = require('./accounts');
const rss = require('./rss');
const update = require('./update');
const downloader = require('./downloader');

const DEFAULT_PORT = Number(process.env.PORT) || 8788;
const PID_FILE = path.join(DATA_DIR, 'server.pid');
const IS_CLI = require.main === module; // run directly with node src/server.js; the desktop app loads it from Electron
// The port actually in use; the desktop app picks another one when the usual port is taken, and the UI warns that RSS URLs differ
let portInfo = { current: DEFAULT_PORT, usual: DEFAULT_PORT, fallback: false };

// Open a URL in the default browser (Windows / macOS / Linux)
function openBrowser(url) {
    let cmd = 'xdg-open';
    if (process.platform === 'win32') cmd = 'explorer';
    else if (process.platform === 'darwin') cmd = 'open';
    const args = [url];
    try {
        spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref();
    } catch { /* can't open a browser: fine, the URL is already printed */ }
}

// CLI version: log why we exit and handle Ctrl+C. The desktop app manages its own process via Electron.
if (IS_CLI) {
    process.on('exit', (code) => {
        // only remove the PID file we wrote ourselves
        try {
            if (fs.readFileSync(PID_FILE, 'utf8').trim().split(/\s+/)[0] === String(process.pid)) fs.rmSync(PID_FILE);
        } catch { /* no PID file */ }
        console.log(`[${new Date().toISOString()}] 伺服器結束，代碼 ${code}`);
    });
    // SIGBREAK exists only on Windows, SIGHUP only on macOS / Linux: register only the ones this OS knows
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP'].filter((s) => s in os.constants.signals)) {
        process.on(sig, () => {
            console.log(`[${new Date().toISOString()}] 收到 ${sig}，結束`);
            process.exit(0);
        });
    }
}
process.on('uncaughtException', (e) => {
    console.error(`[${new Date().toISOString()}] 未處理的錯誤：`, e && e.stack ? e.stack : e);
});
process.on('unhandledRejection', (e) => {
    console.error(`[${new Date().toISOString()}] 未處理的 Promise 錯誤：`, e && e.stack ? e.stack : e);
});
const app = express();
app.use(express.json({ limit: '1mb' }));
// Frontend files are revalidated on every request (code changes take effect on refresh, no stale cache).
// Desktop app: public is packaged into app.asar.unpacked (not inside the asar) so real files are read;
// serving files from inside the asar makes Electron extract a copy into the system temp folder every time and never clean it up.
function publicDir() {
    const dir = path.join(__dirname, '..', 'public');
    const unpacked = dir.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
    return unpacked !== dir && fs.existsSync(unpacked) ? unpacked : dir;
}
app.use(express.static(publicDir(), { setHeaders: (res) => res.set('Cache-Control', 'no-cache') }));

const wrap = (fn) => (req, res) => {
    Promise.resolve()
        .then(() => fn(req, res))
        .then((data) => res.json(data === undefined ? { ok: true } : data))
        .catch((e) => {
            // Program errors (not errors returned by X): print the stack to the console for debugging
            if (!e.code && !/^X |cookie|找不到|次數上限|尚未設定|請輸入|請至少/.test(e.message) && e.stack) console.error(`[${req.method} ${req.path}]`, e.stack);
            res.status(e.code === 'NO_AUTH' || e.code === 'AUTH' ? 401 : 400).json({ error: e.message || String(e), code: e.code });
        });
};

// ---- Status and settings ----
// ---- Accounts ----
let authState = { ok: false, error: null, user: null, key: null };
const brief = (u) => ({ id: u.id, name: u.name, screen_name: u.screen_name, avatar: u.avatar });

// Check the active account (the log doesn't include the account name)
async function checkAuth() {
    const a = accounts.active();
    if (!a) {
        authState = { ok: false, error: null, user: null, key: null };
        return authState;
    }
    api.resetViewer(a.key);
    try {
        const u = await api.viewer(true);
        accounts.update(a.key, { user: brief(u), ok: true });
        authState = { ok: true, error: null, user: brief(u), key: a.key };
        log(`已登入 X（共 ${accounts.all().length} 個帳號）`);
    } catch (e) {
        accounts.update(a.key, { ok: false });
        authState = { ok: false, error: e.message, user: a.user || null, key: a.key };
        log(`X 登入檢查失敗：${e.message}`);
    }
    return authState;
}

app.get('/api/status', wrap(() => ({ auth: authState, accounts: accounts.publicList(), x: x.status(), port: portInfo, ...downloader.snapshot(), log: lines.slice(-200) })));
app.get('/api/update', wrap((req) => update.check(req.query.force === '1')));

// Accept a whole pasted cookie string: pick out the one we need
const pick = (s, k) => {
    const m = new RegExp(`(?:^|[;\\s])${k}=([^;\\s]+)`).exec(String(s || ''));
    return m ? m[1] : String(s || '').trim();
};

// Add an account: verify the login with these cookies first; save and switch to it only on success.
// Used by both cookie pasting on the settings page and the desktop app's in-app login.
async function addAccount(auth, ct0) {
    if (!auth || !ct0) throw new Error('auth_token 和 ct0 都要填');
    const tmp = { key: `tmp-${Date.now()}`, auth_token: auth, ct0 };
    const u = await api.viewer(true, tmp);
    api.resetViewer(tmp.key);
    const acct = accounts.add(auth, tmp.ct0);
    accounts.update(acct.key, { user: brief(u), ok: true });
    accounts.activate(acct.key);
    rss.clear();
    log('已新增 X 帳號並切換過去');
    await checkAuth();
    return { auth: authState, accounts: accounts.publicList() };
}
app.post('/api/accounts', wrap((req) => {
    const both = `${req.body.auth_token || ''}; ${req.body.ct0 || ''}`;
    const auth = pick(/auth_token=/.test(both) ? both : req.body.auth_token, 'auth_token');
    const ct0 = pick(/ct0=/.test(both) ? both : req.body.ct0, 'ct0');
    return addAccount(auth, ct0);
}));

app.post('/api/accounts/:key/activate', wrap(async (req) => {
    accounts.activate(req.params.key);
    rss.clear();
    log('已切換 X 帳號');
    await checkAuth();
    return { auth: authState, accounts: accounts.publicList() };
}));

app.delete('/api/accounts/:key', wrap(async (req) => {
    accounts.remove(req.params.key);
    api.resetViewer(req.params.key);
    log('已移除一個 X 帳號');
    await checkAuth();
    return { auth: authState, accounts: accounts.publicList() };
}));

app.post('/api/check-auth', wrap(() => checkAuth()));

// For npm run stop: shut down cleanly (removes the PID file, writes the log).
// Requires a custom header, which pages on other sites cannot send cross-origin.
app.post('/api/shutdown', (req, res) => {
    if (!IS_CLI || req.get('x-perch') !== 'stop') return res.status(403).end();
    log('收到停止指令');
    res.json({ ok: true });
    setTimeout(() => process.exit(0), 100);
});

// ---- Settings ----
app.get('/api/settings', wrap(() => ({
    download_root: getSetting('download_root', ''),
    default_root: downloader.root(),
})));

app.put('/api/settings', wrap((req) => {
    if (req.body.download_root !== undefined) setSetting('download_root', String(req.body.download_root).trim());
    log('設定已更新');
}));
app.post('/api/rediscover', wrap(async () => {
    await x.init(true);
    return x.status();
}));

// ---- Browsing (read-only) ----
const cur = (req) => (req.query.cursor ? String(req.query.cursor) : undefined);
app.get('/api/home', wrap((req) => api.home(req.query.kind, cur(req))));
app.get('/api/user/:name', wrap((req) => api.userByName(req.params.name)));
app.get('/api/user/:id/timeline', wrap((req) => api.userTimeline(req.params.id, req.query.tab, cur(req))));
app.get('/api/tweet/:id', wrap((req) => api.thread(req.params.id, cur(req))));
app.get('/api/tweet/:id/retweeters', wrap((req) => api.retweeters(req.params.id, cur(req))));
app.get('/api/tweet/:id/quotes', wrap((req) => api.quotes(req.params.id, cur(req))));
app.get('/api/multi', wrap((req) => api.multi(req.query.users, req.query.media === '1', cur(req))));

// Custom groups (multi-user timelines): [{ name, users: [...] }]
app.get('/api/groups', wrap(() => getSetting('groups', [])));
app.put('/api/groups', wrap((req) => {
    const list = (Array.isArray(req.body) ? req.body : [])
        .map((g) => ({ name: String(g.name || '').trim().slice(0, 50), users: api.cleanNames((g.users || []).join(',')).slice(0, 25) }))
        .filter((g) => g.name && g.users.length);
    setSetting('groups', list);
    return list;
}));

// ---- RSS (for local RSS readers; fetched with the active account) ----
const sendRss = (key, load) => (req, res) => {
    rss.serve(`${accounts.active() ? accounts.active().key : ''}|${key(req)}`, () => load(req))
        .then((xml) => res.type('application/rss+xml; charset=utf-8').send(xml))
        .catch((e) => res.status(e.code === 'NO_AUTH' || e.code === 'AUTH' ? 401 : 502).type('text/plain; charset=utf-8').send(e.message));
};
const USER_TAB_NAMES = { tweets: '貼文', replies: '貼文與回覆', media: '媒體' };
app.get('/rss/user/:name', sendRss((req) => `user/${req.params.name}/${req.query.tab || ''}`, async (req) => {
    const tab = USER_TAB_NAMES[req.query.tab] ? req.query.tab : 'tweets';
    const p = await api.userByName(req.params.name);
    const t = await api.userTimeline(p.id, tab);
    return { meta: { title: `${p.name}（@${p.screen_name}）的${USER_TAB_NAMES[tab]}`, link: `https://x.com/${p.screen_name}` }, tweets: t.tweets };
}));
app.get('/rss/multi', sendRss((req) => `multi/${req.query.users}/${req.query.media || ''}`, async (req) => {
    const names = api.cleanNames(req.query.users);
    const t = await api.multi(req.query.users, req.query.media === '1');
    return { meta: { title: `${req.query.name || names.map((n) => `@${n}`).join('、')}${req.query.media === '1' ? '（媒體）' : ''}`, link: 'https://x.com/' }, tweets: t.tweets };
}));
app.get('/rss/search', sendRss((req) => `search/${req.query.q}/${req.query.product || ''}`, async (req) => {
    if (!String(req.query.q || '').trim()) throw new Error('缺少 q');
    const t = await api.search(req.query.q, req.query.product || 'latest');
    return { meta: { title: `X 搜尋：${req.query.q}`, link: `https://x.com/search?q=${encodeURIComponent(req.query.q)}&f=live` }, tweets: t.tweets };
}));
app.get('/rss/list/:id', sendRss((req) => `list/${req.params.id}`, async (req) => {
    const [l, t] = await Promise.all([api.listInfo(req.params.id), api.listTimeline(req.params.id)]);
    return { meta: { title: `X 列表：${l.name}`, link: `https://x.com/i/lists/${req.params.id}` }, tweets: t.tweets };
}));
app.get('/rss/home', sendRss(() => 'home', async () => {
    const t = await api.home('following');
    return { meta: { title: 'X 追蹤中（最新）', link: 'https://x.com/home' }, tweets: t.tweets };
}));
app.get('/api/search', wrap((req) => {
    if (!String(req.query.q || '').trim()) throw new Error('請輸入搜尋文字');
    return api.search(req.query.q, req.query.product, cur(req));
}));
app.get('/api/bookmarks', wrap((req) => api.bookmarks(cur(req))));
app.get('/api/following', wrap((req) => api.following(cur(req))));
app.get('/api/lists', wrap(() => api.lists()));
app.get('/api/list/:id', wrap((req) => api.listInfo(req.params.id)));
app.get('/api/list/:id/timeline', wrap((req) => api.listTimeline(req.params.id, cur(req))));

// ---- Downloads ----
app.post('/api/download', wrap((req) => ({ queued: downloader.enqueue(req.body.items) })));
// Whether these media were already downloaded (shown as ✓); returns booleans in the same order as items
app.post('/api/downloaded', wrap((req) => (req.body.items || []).slice(0, 500).map((it) => {
    try {
        return !!it && downloader.exists(it);
    } catch {
        return false;
    }
})));

function listen(port) {
    return new Promise((resolve, reject) => {
        const server = app.listen(port, '127.0.0.1', () => resolve(server));
        server.once('error', reject);
    });
}

// Start the server. opts.fallback: if the port is taken, use any free port instead (desktop app)
async function start(opts = {}) {
    let server;
    try {
        server = await listen(DEFAULT_PORT);
    } catch (e) {
        if (e.code !== 'EADDRINUSE' || !opts.fallback) throw e;
        log(`連接埠 ${DEFAULT_PORT} 被占用，改用其他連接埠（RSS 網址會跟平常不同）`);
        server = await listen(0);
    }
    const port = server.address().port;
    const url = `http://127.0.0.1:${port}`;
    portInfo = { current: port, usual: DEFAULT_PORT, fallback: port !== DEFAULT_PORT };
    log(`Web 介面：${url}`);
    x.init().catch((e) => log(`解析 X 前端失敗：${e.message}`));
    if (accounts.active()) checkAuth();
    else log('尚未設定 X 登入 cookie');
    return { server, port, url };
}

if (IS_CLI) {
    const url = `http://127.0.0.1:${DEFAULT_PORT}`;
    start()
        .then(({ port }) => {
            // "pid port": npm run stop needs to know which port to send the stop request to
            fs.writeFileSync(PID_FILE, `${process.pid} ${port}`);
            if (process.argv.includes('--open')) openBrowser(url);
        })
        .catch((e) => {
            if (e.code !== 'EADDRINUSE') throw e;
            // One is already running: just open that one instead of starting another
            console.log(`連接埠 ${DEFAULT_PORT} 已經有程式在用（多半是 Perch 已經開著了）：${url}`);
            if (process.argv.includes('--open')) openBrowser(url);
            process.exit(0);
        });
}

module.exports = { start, addAccount };
