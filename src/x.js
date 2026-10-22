// Client for X (Twitter)'s internal web API: calls GraphQL with the user's own login cookies (auth_token, ct0).
// queryIds and features change with X's releases, so they are parsed from x.com's frontend bundle and cached in data/ops.json.
const { parseHTML } = require('linkedom');
const { ClientTransaction } = require('x-client-transaction-id');
const { readJson, writeJson } = require('./store');
const accounts = require('./accounts');
const { log } = require('./log');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const HOME_URL = 'https://x.com/i/jf/';
const CHUNK_BASE = 'https://abs.twimg.com/responsive-web/client-web/';
// Operations this app uses; some are not in main.js and must be found in lazy-loaded chunks
const WANTED = [
    'Viewer', 'HomeTimeline', 'HomeLatestTimeline', 'UserByScreenName', 'UserTweets', 'UserTweetsAndReplies',
    'UserMedia', 'Likes', 'TweetDetail', 'SearchTimeline', 'Bookmarks', 'Following',
    'ListsManagementPageTimeline', 'ListLatestTweetsTimeline', 'ListByRestId', 'Retweeters',
];
// Chunk scan order: matching names first; stop once everything is found
const CHUNK_HINT = /Home|Bookmark|List|Jetfuel|UserProfile|Following|Timeline/;
const TRANSACTION_TTL = 60 * 60 * 1000;

let defs = readJson('ops.json', null); // { main, bearer, ops: { name: { id, features, toggles } }, featureDefaults }
let transaction = null;
let transactionAt = 0;
let initPromise = null;
const rateLimits = {}; // account key -> operation -> { limit, remaining, reset }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url, headers = {}) {
    const res = await fetch(url, { headers: { 'user-agent': UA, ...headers } });
    if (!res.ok) throw new Error(`下載 ${url.split('?')[0]} 失敗：HTTP ${res.status}`);
    return res.text();
}

function parseOps(js, into) {
    const re = /queryId:"([^"]+)",operationName:"([^"]+)",operationType:"[^"]+",metadata:\{featureSwitches:\[([^\]]*)\],fieldToggles:\[([^\]]*)\]/g;
    const list = (s) => [...s.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    for (const m of js.matchAll(re)) {
        if (!into[m[2]]) into[m[2]] = { id: m[1], features: list(m[3]), toggles: list(m[4]) };
    }
}

// Parse webpack's chunk map out of the home page HTML (name → URL)
function chunkList(html) {
    const m = html.match(/\(\{([^}]*)\}\)\[e\]\|\|e\)\+"\."\+\(\{([^}]*)\}\)\[e\]\+"a\.js"/);
    if (!m) return [];
    const parse = (s) => Object.fromEntries([...s.matchAll(/(\d+):"([^"]+)"/g)].map((x) => [x[1], x[2]]));
    const names = parse(m[1]);
    const hashes = parse(m[2]);
    return Object.keys(hashes)
        .map((k) => ({ name: names[k] || k, url: `${CHUNK_BASE}${names[k] || k}.${hashes[k]}a.js` }))
        .filter((c) => !/countries|i18n|icons\.|emoji|Lottie/i.test(c.name));
}

async function discover(html, mainUrl) {
    const started = Date.now();
    const mainJs = await fetchText(mainUrl);
    const bearer = (mainJs.match(/"(AAAAAAAAAAAAAAAAAAAAA[^"]+)"/) || [])[1];
    if (!bearer) throw new Error('在 main.js 找不到 bearer token，X 可能改版了');
    const ops = {};
    parseOps(mainJs, ops);
    const missing = () => WANTED.filter((w) => !ops[w]);
    const chunks = chunkList(html);
    const queue = [...chunks.filter((c) => CHUNK_HINT.test(c.name)), ...chunks.filter((c) => !CHUNK_HINT.test(c.name))];
    let scanned = 0;
    // Fetch 8 in parallel; stop once nothing is missing
    await Promise.all(Array.from({ length: 8 }, async () => {
        while (queue.length && missing().length) {
            const c = queue.shift();
            try {
                const js = await fetchText(c.url);
                scanned++;
                if (js.includes('operationName:"')) parseOps(js, ops);
            } catch { /* skip chunks that fail */ }
        }
    }));
    let featureDefaults = {};
    const st = html.match(/window\.__INITIAL_STATE__=(\{.*?\});window\./s);
    if (st) {
        try {
            const cfg = JSON.parse(st[1]).featureSwitch?.defaultConfig || {};
            const used = new Set(Object.values(ops).flatMap((o) => o.features));
            for (const [k, v] of Object.entries(cfg)) if (used.has(k) && typeof v.value === 'boolean') featureDefaults[k] = v.value;
        } catch { featureDefaults = {}; }
    }
    const keep = Object.fromEntries(Object.entries(ops).filter(([k]) => WANTED.includes(k)));
    defs = { main: mainUrl, bearer, ops: keep, featureDefaults, updated: new Date().toISOString() };
    writeJson('ops.json', defs);
    const lack = missing();
    log(`已解析 X 前端：${Object.keys(keep).length}/${WANTED.length} 個 API（掃了 ${scanned} 個 chunk，${((Date.now() - started) / 1000).toFixed(1)} 秒）${lack.length ? `；找不到：${lack.join('、')}` : ''}`);
}

// Load the home page: refresh the transaction id generator; re-parse the API only when main.js changed
async function init(force = false) {
    if (!force && transaction && Date.now() - transactionAt < TRANSACTION_TTL) return;
    if (initPromise) return initPromise;
    initPromise = (async () => {
        const html = await fetchText(HOME_URL, { accept: 'text/html' });
        const mainUrl = (html.match(/src="(https:\/\/abs\.twimg\.com\/responsive-web\/client-web\/main\.[^"]+\.js)"/) || [])[1];
        if (!mainUrl) throw new Error('在 x.com 首頁找不到 main.js');
        if (force || !defs || defs.main !== mainUrl || WANTED.some((w) => !defs.ops[w])) await discover(html, mainUrl);
        transaction = await ClientTransaction.create(parseHTML(html).document);
        transactionAt = Date.now();
    })().finally(() => {
        initPromise = null;
    });
    return initPromise;
}

// Use the active account unless one is given
function account(acct) {
    const a = acct || accounts.active();
    if (!a || !a.auth_token || !a.ct0) throw Object.assign(new Error('尚未設定登入 cookie（到「設定」新增帳號，貼上 auth_token 和 ct0）'), { code: 'NO_AUTH' });
    return a;
}

// X sometimes rotates ct0; save the new one when a response carries it
function captureCt0(res, acct) {
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of sc) {
        const m = /^ct0=([^;]+)/.exec(c);
        if (m && m[1] !== acct.ct0) {
            acct.ct0 = m[1];
            accounts.update(acct.key, { ct0: m[1] });
        }
    }
}

// Rate limits are tracked per account
const limitsOf = (acct) => (rateLimits[acct.key] ||= {});

function noteRate(name, res, acct) {
    const limit = res.headers.get('x-rate-limit-limit');
    if (!limit) return;
    limitsOf(acct)[name] = {
        limit: Number(limit),
        remaining: Number(res.headers.get('x-rate-limit-remaining')),
        reset: Number(res.headers.get('x-rate-limit-reset')) * 1000,
    };
}

// toggleOn: fieldToggles to switch on (e.g. full article content); everything else is off
function buildUrl(name, variables, toggleOn = {}) {
    const op = defs.ops[name];
    if (!op) throw new Error(`找不到 X 的 ${name} API，可能改版了（到「設定」按「重新解析 X 前端」再試）`);
    const features = Object.fromEntries(op.features.map((f) => [f, defs.featureDefaults[f] ?? false]));
    const toggles = Object.fromEntries(op.toggles.map((f) => [f, !!toggleOn[f]]));
    const path = `/i/api/graphql/${op.id}/${name}`;
    const qs = new URLSearchParams({ variables: JSON.stringify(variables), features: JSON.stringify(features) });
    if (op.toggles.length) qs.set('fieldToggles', JSON.stringify(toggles));
    return { path, url: `https://x.com${path}?${qs}` };
}

// opts.account: use this account (e.g. verifying a new one); defaults to the active account
// opts.toggles: fieldToggles to switch on
async function gql(name, variables, opts = {}) {
    const acct = account(opts.account);
    const { auth_token: auth, ct0 } = acct;
    const retried = !!opts.retried;
    const retry = () => gql(name, variables, { ...opts, account: acct, retried: true });
    await init();
    const { path, url } = buildUrl(name, variables, opts.toggles);
    const rl = limitsOf(acct)[name];
    if (rl && rl.remaining === 0 && rl.reset > Date.now()) {
        throw new Error(`${name} 已達 X 的次數上限，${new Date(rl.reset).toLocaleTimeString('zh-TW', { hour12: false })} 後恢復`);
    }
    const res = await fetch(url, {
        headers: {
            'user-agent': UA,
            accept: '*/*',
            'accept-language': 'zh-TW,zh;q=0.9,en;q=0.8',
            authorization: `Bearer ${defs.bearer}`,
            'content-type': 'application/json',
            cookie: `auth_token=${auth}; ct0=${ct0}`,
            'x-csrf-token': ct0,
            'x-twitter-active-user': 'yes',
            'x-twitter-auth-type': 'OAuth2Session',
            'x-twitter-client-language': 'zh-tw',
            'x-client-transaction-id': await transaction.generateTransactionId('GET', path),
            referer: 'https://x.com/',
            origin: 'https://x.com',
        },
    });
    captureCt0(res, acct);
    noteRate(name, res, acct);
    if (res.status === 429) {
        const lim = limitsOf(acct)[name];
        const reset = lim ? new Date(lim.reset).toLocaleTimeString('zh-TW', { hour12: false }) : '稍後';
        throw new Error(`${name} 已達 X 的次數上限，${reset} 後恢復`);
    }
    if (res.status === 401 || res.status === 403) {
        const body = await res.text().catch(() => '');
        // A 403 may also mean a stale transaction id: reload the home page and retry once
        if (!retried && res.status === 403) {
            await init(true);
            return retry();
        }
        throw Object.assign(new Error(`X 拒絕存取（HTTP ${res.status}），cookie 可能已失效，請重新貼上 auth_token / ct0${/"code":\s*(\d+)/.test(body) ? `（錯誤碼 ${RegExp.$1}）` : ''}`), { code: 'AUTH' });
    }
    if (res.status === 404 && !retried) {
        // Stale queryId: re-parse the frontend and retry
        log(`${name} 回 404，重新解析 X 前端`);
        await init(true);
        return retry();
    }
    const text = await res.text();
    let json;
    try {
        json = JSON.parse(text);
    } catch {
        throw new Error(`${name} 回應不是 JSON（HTTP ${res.status}）`);
    }
    if (json.errors && json.errors.length && !json.data) {
        const msg = json.errors.map((e) => e.message).join('；');
        if (!retried && /query: unspecified|PersistedQueryNotFound/i.test(msg)) {
            await init(true);
            return retry();
        }
        throw new Error(`X 回傳錯誤：${msg}`);
    }
    if (!res.ok) throw new Error(`${name} 失敗：HTTP ${res.status}`);
    return json.data || {};
}

// Download media (pbs.twimg.com / video.twimg.com are public CDNs, no cookies needed)
async function fetchMedia(url) {
    const u = new URL(url);
    if (!/(^|\.)twimg\.com$/.test(u.hostname)) throw new Error('只能下載 twimg.com 的媒體');
    for (let i = 0; ; i++) {
        const res = await fetch(url, { headers: { 'user-agent': UA } });
        if (res.ok) return res;
        if (i >= 2 || res.status < 500) throw new Error(`下載失敗：HTTP ${res.status}`);
        await sleep(1000 * (i + 1));
    }
}

const status = () => {
    const a = accounts.active();
    return {
        hasCookies: !!a,
        ops: defs ? Object.keys(defs.ops).length : 0,
        wanted: WANTED.length,
        opsUpdated: defs ? defs.updated : null,
        rateLimits: a ? limitsOf(a) : {},
    };
};

// For debugging: the current API definitions
const debugDefs = () => defs;

module.exports = { init, gql, fetchMedia, status, debugDefs, UA };
