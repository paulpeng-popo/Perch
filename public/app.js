const $ = (s) => document.querySelector(s);

async function api(method, url, body) {
    const res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { fromServer: true, code: data.code });
    return data;
}

function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 3500);
}

// Some embedded browsers block native confirm / prompt / alert, so we always use our own dialog
function ask(title, html, buttons) {
    const d = $('#ask-dialog');
    $('#ask-title').textContent = title;
    $('#ask-body').innerHTML = html;
    const box = $('#ask-buttons');
    box.innerHTML = '<span class="spacer"></span>';
    return new Promise((resolve) => {
        const done = (v) => {
            d.close();
            resolve(v);
        };
        for (const b of buttons) {
            const el = document.createElement('button');
            el.textContent = b.label;
            if (b.cls) el.className = b.cls;
            el.addEventListener('click', () => done(b.value));
            box.appendChild(el);
        }
        d.onclose = () => resolve(null);
        d.showModal();
    });
}
async function confirmBox(message, { ok = '確定', danger = false, title = '請確認' } = {}) {
    const r = await ask(title, `<p style="white-space:pre-wrap">${esc(message)}</p>`, [{ label: '取消', value: false }, { label: ok, value: true, cls: danger ? 'danger' : 'primary' }]);
    return r === true;
}

const guard = (fn) => async (...args) => {
    try {
        await fn(...args);
    } catch (e) {
        if (!e.fromServer) console.error(e);
        toast(`錯誤：${e.message}`);
    }
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtSize = (n) => {
    if (!n) return '-';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
};
const fmtTime = (s) => (s ? new Date(s).toLocaleString('zh-TW', { hour12: false }) : '-');
// 1234 → 1,234; 12345 → 1.2萬; 1.2億 (Chinese units)
function fmtNum(n) {
    if (n == null) return '';
    if (n >= 1e8) return `${(n / 1e8).toFixed(n >= 1e9 ? 0 : 1).replace(/\.0$/, '')}億`;
    if (n >= 1e4) return `${(n / 1e4).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/, '')}萬`;
    return n.toLocaleString('zh-TW');
}
// Post time: just now / N min / N h / M月D日 / YYYY年M月D日
function fmtAgo(s) {
    if (!s) return '';
    const d = new Date(s);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return '剛剛';
    if (diff < 3600) return `${Math.floor(diff / 60)} 分`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小時`;
    if (d.getFullYear() === new Date().getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

// ---- UI preferences (stored in this browser only) ----
const prefs = (() => {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('prefs') || '{}'); } catch { /* private browsing */ }
    return { fontSize: 16, theme: 'auto', blur: false, blurSensitive: true, hideRt: false, hideReplies: false, ...saved };
})();
function savePrefs() {
    try { localStorage.setItem('prefs', JSON.stringify(prefs)); } catch { /* private browsing */ }
}
function applyPrefs() {
    document.documentElement.style.setProperty('--fs', `${prefs.fontSize}px`);
    if (prefs.theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.dataset.theme = prefs.theme;
    document.body.classList.toggle('blur-media', prefs.blur);
    $('#theme-toggle').innerHTML = ico({ auto: 'auto', light: 'sun', dark: 'moon' }[prefs.theme]);
    $('#theme-toggle').title = `深淺色：${{ auto: '跟隨系統', light: '淺色', dark: '深色' }[prefs.theme]}（點一下切換）`;
    $('#set-blur').checked = prefs.blur;
    $('#set-blur-sensitive').checked = prefs.blurSensitive;
    $('#set-hide-rt').checked = prefs.hideRt;
    $('#set-hide-replies').checked = prefs.hideReplies;
}
function setFont(delta) {
    prefs.fontSize = Math.min(24, Math.max(12, prefs.fontSize + delta));
    savePrefs();
    applyPrefs();
    toast(`字體大小 ${prefs.fontSize}px`);
}
$('#font-up').addEventListener('click', () => setFont(1));
$('#font-down').addEventListener('click', () => setFont(-1));
$('#theme-toggle').addEventListener('click', () => {
    prefs.theme = { auto: 'light', light: 'dark', dark: 'auto' }[prefs.theme];
    savePrefs();
    applyPrefs();
});
const bindPref = (sel, key, rerender) => $(sel).addEventListener('change', (e) => {
    prefs[key] = e.target.checked;
    savePrefs();
    applyPrefs();
    if (rerender && typeof rerenderFeed === 'function') rerenderFeed();
});
bindPref('#set-blur', 'blur');
bindPref('#set-blur-sensitive', 'blurSensitive', true);
bindPref('#set-hide-rt', 'hideRt', true);
bindPref('#set-hide-replies', 'hideReplies', true);
document.addEventListener('keydown', (e) => {
    if (!e.ctrlKey || e.altKey) return;
    if (e.key === '=' || e.key === '+') { e.preventDefault(); setFont(1); }
    if (e.key === '-') { e.preventDefault(); setFont(-1); }
});

// ---- Tabs ----
function showTab(name) {
    document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.tab').forEach((s) => s.classList.toggle('hidden', s.id !== `tab-${name}`));
    if (name === 'log') pollStatus();
    if (name === 'settings') guard(loadSettings)();
    try { localStorage.setItem('tab', name); } catch { /* private browsing */ }
}
document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

// ---- Status polling ----
let authState = null;
let accountList = [];

// Called by status polling and account switching: reload the browse view when the account changed (or just logged in)
function applyAuth(auth, list) {
    const prev = authState;
    authState = auth;
    if (list) accountList = list;
    const badge = $('#auth-badge');
    if (auth.ok) {
        badge.textContent = `@${auth.user.screen_name}`;
        badge.className = 'badge acct-btn ok';
    } else {
        badge.textContent = auth.key ? '登入失效' : '未登入';
        badge.className = 'badge acct-btn bad';
    }
    const switched = !!(prev && prev.key && auth.key && prev.key !== auth.key);
    if (auth.ok && (!prev || !prev.ok || switched) && typeof onLogin === 'function') onLogin(switched);
    if (!$('#acct-menu').classList.contains('hidden')) renderAcctMenu();
}

// After adding / switching / removing an account in this window: apply it here, then tell other Perch windows (opened with Ctrl+click) to update now
// instead of waiting for their next poll (up to 4 seconds)
const perchChannel = 'BroadcastChannel' in window ? new BroadcastChannel('perch') : null;
function applyAuthLocal(r) {
    applyAuth(r.auth, r.accounts);
    if (perchChannel) perchChannel.postMessage('auth-changed');
}
if (perchChannel) {
    perchChannel.onmessage = (e) => {
        if (e.data === 'auth-changed') pollStatus();
    };
}

// Not on the usual port this time (taken by another program): RSS feed URLs differ, so warn about it
function renderPortWarn(p) {
    const el = $('#port-warn');
    if (!p || !p.fallback) return el.classList.add('hidden');
    el.textContent = `連接埠 ${p.usual} 被別的程式占用（例如另外開著的 Perch），這次改用 ${p.current}，RSS 訂閱的網址會跟平常不同而收不到更新。關掉占用的程式後重開 Perch 就會恢復。`;
    el.classList.remove('hidden');
}

async function pollStatus() {
    try {
        const s = await api('GET', '/api/status');
        renderPortWarn(s.port);
        applyAuth(s.auth, s.accounts);

        const now = $('#now');
        const d = s.downloading;
        if (d) {
            let text = `下載中：${d.name}　${fmtSize(d.received)} / ${fmtSize(d.size)}`;
            if (d.queued) text += `｜排隊 ${d.queued} 個`;
            text += `｜完成 ${d.done}・略過 ${d.skipped}${d.failed ? `・失敗 ${d.failed}` : ''}`;
            now.querySelector('.now-text').textContent = text;
            now.querySelector('.bar div').style.width = d.size ? `${Math.min(100, (d.received / d.size) * 100)}%` : '0';
            now.classList.remove('hidden');
        } else {
            // Downloads just finished: refresh the ✓ marks
            if (!now.classList.contains('hidden') && typeof refreshDownloaded === 'function') refreshDownloaded();
            now.classList.add('hidden');
        }

        const logEl = $('#log');
        const lastLine = s.log.length ? s.log[s.log.length - 1].time + s.log.length : '';
        if (!$('#tab-log').classList.contains('hidden') && logEl.dataset.last !== lastLine) {
            const atBottom = logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 10;
            logEl.textContent = s.log.map((l) => `${fmtTime(l.time)}  ${l.msg}`).join('\n');
            logEl.dataset.last = lastLine;
            if (atBottom) logEl.scrollTop = logEl.scrollHeight;
        }
        if (!$('#tab-settings').classList.contains('hidden')) renderXState(s);
        pollStatus.fast = !!d;
    } catch {
        $('#auth-badge').textContent = '伺服器離線';
        $('#auth-badge').className = 'badge bad';
    }
}
(function loop() {
    pollStatus().finally(() => setTimeout(loop, pollStatus.fast ? 1000 : 4000));
})();

// ---- Settings ----
function acctLabel(a) {
    return a.user ? `${esc(a.user.name)} <span class="muted">@${esc(a.user.screen_name)}</span>` : '<span class="muted">（還沒檢查）</span>';
}
function renderXState(s) {
    const a = s.auth;
    $('#auth-state').innerHTML = a.ok
        ? '<span class="s-ok">目前的帳號登入正常</span>'
        : (a.error ? `<span class="s-error">${esc(a.error)}</span>` : (s.x.hasCookies ? '檢查中…' : '還沒有帳號，請在下面新增'));
    $('#acct-list').innerHTML = (s.accounts || []).map((x) => `<li data-key="${esc(x.key)}">
        ${x.user ? avatarHtml(x.user) : '<span class="avatar"></span>'}
        <div class="c-body"><div>${acctLabel(x)}</div>
            <div class="small-text">${x.active ? '<span class="s-ok">使用中</span>' : ''}${x.ok ? '' : ' <span class="s-error">登入失效，請重新新增這個帳號的 cookie</span>'}</div></div>
        ${x.active ? '' : '<button class="small" data-acct-use>切換</button>'}
        <button class="small danger" data-acct-del>移除</button>
    </li>`).join('') || '<li class="muted">沒有帳號</li>';
    $('#defs-state').innerHTML = `已解析 <b>${s.x.ops}</b> / ${s.x.wanted} 個 API${s.x.opsUpdated ? `（${esc(fmtTime(s.x.opsUpdated))}）` : ''}`;
    const rl = Object.entries(s.x.rateLimits || {});
    $('#rate-list').innerHTML = rl.length
        ? rl.map(([k, v]) => `<div>${esc(k)}：剩 ${v.remaining} / ${v.limit}，${esc(new Date(v.reset).toLocaleTimeString('zh-TW', { hour12: false }))} 重置</div>`).join('')
        : '還沒有呼叫過';
}
async function loadSettings() {
    const s = await api('GET', '/api/settings');
    $('#set-root').value = s.download_root;
    $('#set-root').placeholder = `留空 = ${s.default_root}`;
    renderXState(await api('GET', '/api/status'));
}

// ---- Accounts ----
async function switchAccount(key) {
    const r = await api('POST', `/api/accounts/${encodeURIComponent(key)}/activate`);
    applyAuthLocal(r);
    toast(r.auth.ok ? `已切換到 @${r.auth.user.screen_name}` : `切換了，但登入失敗：${r.auth.error}`);
    if (!$('#tab-settings').classList.contains('hidden')) loadSettings();
}
async function removeAccount(key) {
    const a = accountList.find((x) => x.key === key);
    const name = a && a.user ? `@${a.user.screen_name}` : '這個帳號';
    if (!await confirmBox(`從這裡移除 ${name}？\n只會刪掉本機存的 cookie，不會登出 x.com。`, { ok: '移除', danger: true })) return;
    const r = await api('DELETE', `/api/accounts/${encodeURIComponent(key)}`);
    applyAuthLocal(r);
    loadSettings();
}
$('#btn-add-acct').addEventListener('click', guard(async () => {
    const body = { auth_token: $('#set-auth').value.trim(), ct0: $('#set-ct0').value.trim() };
    if (!body.auth_token && !body.ct0) return toast('兩格都是空的');
    $('#btn-add-acct').disabled = true;
    try {
        const r = await api('POST', '/api/accounts', body);
        $('#set-auth').value = '';
        $('#set-ct0').value = '';
        applyAuthLocal(r);
        toast(r.auth.ok ? `已新增並切換到 @${r.auth.user.screen_name}` : `新增了，但登入失敗：${r.auth.error}`);
        await loadSettings();
    } finally {
        $('#btn-add-acct').disabled = false;
    }
}));
$('#acct-list').addEventListener('click', guard(async (e) => {
    const li = e.target.closest('li[data-key]');
    if (!li) return;
    if (e.target.closest('[data-acct-use]')) await switchAccount(li.dataset.key);
    if (e.target.closest('[data-acct-del]')) await removeAccount(li.dataset.key);
}));
$('#btn-check-auth').addEventListener('click', guard(async () => {
    $('#auth-state').textContent = '檢查中…';
    await api('POST', '/api/check-auth');
    await loadSettings();
    pollStatus();
}));

// Account menu at the top right
function renderAcctMenu() {
    const menu = $('#acct-menu');
    menu.innerHTML = `<div class="ctx-title">切換帳號</div>${accountList.map((a) => `<button data-key="${esc(a.key)}">
        ${a.user ? avatarHtml(a.user, 'tiny') : '<span class="avatar tiny"></span>'}
        <span class="acct-name">${acctLabel(a)}</span>
        ${a.active ? `<span class="ctx-check">${ico('check')}</span>` : ''}${a.ok ? '' : '<span class="s-error small-text">失效</span>'}
    </button>`).join('')}<hr><button data-add><span class="ctx-icon">${ico('user')}</span>新增帳號…</button>`;
}
$('#auth-badge').addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = $('#acct-menu');
    if (!menu.classList.contains('hidden')) return menu.classList.add('hidden');
    renderAcctMenu();
    const r = $('#auth-badge').getBoundingClientRect();
    menu.style.top = `${r.bottom + 6}px`;
    menu.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
    menu.classList.remove('hidden');
});
$('#acct-menu').addEventListener('click', guard(async (e) => {
    const menu = $('#acct-menu');
    const b = e.target.closest('button');
    if (!b) return;
    menu.classList.add('hidden');
    if (b.dataset.add !== undefined) {
        showTab('settings');
        $('#acct-add').scrollIntoView({ block: 'start' });
        $('#set-auth').focus();
        return;
    }
    const a = accountList.find((x) => x.key === b.dataset.key);
    if (a && !a.active) await switchAccount(a.key);
}));
document.addEventListener('click', (e) => {
    if (!e.target.closest('#acct-menu')) $('#acct-menu').classList.add('hidden');
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') $('#acct-menu').classList.add('hidden');
});
$('#btn-save-root').addEventListener('click', guard(async () => {
    await api('PUT', '/api/settings', { download_root: $('#set-root').value });
    toast('已儲存');
    await loadSettings();
}));
$('#btn-rediscover').addEventListener('click', guard(async () => {
    $('#defs-state').textContent = '解析中…（約 5–20 秒）';
    await api('POST', '/api/rediscover');
    await loadSettings();
    toast('已重新解析');
}));

// ---- Update check (GitHub Releases) ----
// Check once after startup, then every 6 hours; the server caches too, so GitHub isn't hammered
function renderUpdate(u) {
    $('#about-version').textContent = u.current ? `v${u.current}` : '-';
    let note;
    if (u.error) note = `無法檢查更新：${u.error}`;
    else if (u.newer) note = `有新版 v${u.latest}`;
    else if (u.latest) note = '已經是最新版';
    else note = u.note || '';
    $('#about-update').textContent = note;
    let dismissed = '';
    try { dismissed = localStorage.getItem('dismissUpdate') || ''; } catch { /* private browsing */ }
    const show = !!(u.newer && dismissed !== u.latest);
    $('#update-banner').classList.toggle('hidden', !show);
    if (show) {
        $('#update-text').textContent = `Perch 有新版 v${u.latest}（你現在是 v${u.current}）。`;
        $('#update-link').href = u.url;
        $('#update-later').dataset.version = u.latest;
    }
}
async function checkUpdate(force = false) {
    try {
        renderUpdate(await api('GET', `/api/update${force ? '?force=1' : ''}`));
    } catch { /* a failed check shouldn't bother the user */ }
}
$('#update-later').addEventListener('click', (e) => {
    try { localStorage.setItem('dismissUpdate', e.target.dataset.version || ''); } catch { /* private browsing */ }
    $('#update-banner').classList.add('hidden');
});
$('#btn-check-update').addEventListener('click', guard(async () => {
    $('#about-update').textContent = '檢查中…';
    try { localStorage.removeItem('dismissUpdate'); } catch { /* private browsing */ }
    await checkUpdate(true);
}));
setTimeout(() => checkUpdate(), 3000);
setInterval(() => checkUpdate(), 6 * 60 * 60 * 1000);

// ---- Desktop-only features (Electron): window.perch comes from electron/preload.js ----
const desktop = window.perch && window.perch.isApp ? window.perch : null;
if (desktop) {
    document.querySelectorAll('.app-only').forEach((el) => el.classList.remove('hidden'));
    document.body.classList.add('is-app');
    desktop.info().then((i) => {
        $('#app-data-dir').textContent = i.dataDir;
    }).catch(() => {});
    $('#btn-login-x').addEventListener('click', guard(async () => {
        const btn = $('#btn-login-x');
        btn.disabled = true;
        $('#login-x-state').textContent = '請在跳出的視窗登入 X，登入完會自動關閉…';
        try {
            const r = await desktop.loginX();
            if (r.cancelled) {
                $('#login-x-state').textContent = '已取消';
            } else if (r.error) {
                $('#login-x-state').textContent = `失敗：${r.error}`;
            } else {
                applyAuthLocal(r);
                $('#login-x-state').textContent = '';
                toast(r.auth.ok ? `已新增並切換到 @${r.auth.user.screen_name}` : `登入了，但檢查失敗：${r.auth.error}`);
                await loadSettings();
            }
        } finally {
            btn.disabled = false;
        }
    }));
    $('#btn-pick-root').addEventListener('click', guard(async () => {
        const dir = await desktop.pickFolder();
        if (!dir) return;
        await api('PUT', '/api/settings', { download_root: dir });
        toast('已儲存');
        await loadSettings();
    }));
    $('#btn-open-root').addEventListener('click', guard(async () => {
        const r = await desktop.openDownloads();
        if (r.error) toast(`打不開：${r.error}`);
    }));
    $('#btn-open-data').addEventListener('click', guard(async () => {
        const r = await desktop.openData();
        if (r.error) toast(`打不開：${r.error}`);
    }));
} else {
    // The browser version has no login window, so expand manual cookie entry
    $('#manual-cookie').open = true;
}

applyIcons();
applyPrefs();
