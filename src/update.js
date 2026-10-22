// Check GitHub for a newer release. The repo comes from package.json's repository; no repo, no check.
// Uses GitHub's public API (no login), at most once every 6 hours. A private repo can't be checked.
const pkg = require('../package.json');

const CACHE_MS = 6 * 60 * 60 * 1000;
let cached = null; // { at, result }

function repoSlug() {
    const r = typeof pkg.repository === 'string' ? pkg.repository : (pkg.repository && pkg.repository.url) || '';
    const m = /github(?:\.com[/:]|:)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(r);
    return m ? `${m[1]}/${m[2]}` : null;
}

// Version compare: 1.10.0 > 1.9.2; ignores a leading v and suffixes like -beta
function newer(a, b) {
    const parse = (v) => String(v).replace(/^v/i, '').split('-')[0].split('.').map((n) => Number(n) || 0);
    const [x, y] = [parse(a), parse(b)];
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
        if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
    }
    return false;
}

async function check(force = false) {
    const current = pkg.version;
    const repo = repoSlug();
    if (!repo) return { current, repo: null, error: '還沒設定 GitHub repo，無法檢查更新' };
    if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.result;
    let result;
    try {
        const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
            headers: { 'user-agent': `Perch/${current}`, accept: 'application/vnd.github+json' },
            signal: AbortSignal.timeout(10000),
        });
        if (res.status === 404) {
            result = { current, repo, latest: null, newer: false, note: '找不到已發布的版本（還沒發布，或 repo 是私人的）' };
        } else if (!res.ok) {
            result = { current, repo, error: `GitHub 回應 HTTP ${res.status}` };
        } else {
            const r = await res.json();
            const latest = String(r.tag_name || '').replace(/^v/i, '');
            result = { current, repo, latest, newer: newer(latest, current), url: r.html_url, published: r.published_at };
        }
    } catch (e) {
        result = { current, repo, error: `連不上 GitHub：${e.message}` };
    }
    // Failures are cached for only 30 minutes so we retry sooner once the network is back
    cached = { at: result.error ? Date.now() - CACHE_MS + 30 * 60 * 1000 : Date.now(), result };
    return result;
}

module.exports = { check, newer };
