const $ = (s) => document.querySelector(s);

function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 3500);
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
    try { localStorage.setItem('tab', name); } catch { /* private browsing */ }
}
document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

applyIcons();
applyPrefs();
