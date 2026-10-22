// Browsing: sources on the left, posts on the right. Routes live in #/..., so the browser's Back works.

const feedEl = $('#b-feed');
const listEl = $('#b-list');
const footEl = $('#b-foot');
const states = new Map(); // hash -> each page's loaded content and scroll position
let state = null;

const HOME_TABS = [['following', '追蹤中'], ['foryou', '為你推薦']];

function parseRoute(hash) {
    const parts = (hash || '').replace(/^#\/?/, '').split('/');
    const [kind, a, ...rest] = parts;
    if (kind === 'home') return { kind, sub: a === 'foryou' ? 'foryou' : 'following' };
    return null;
}

// ---- Loading ----
async function fetchPage(st, cursor) {
    const r = st.route;
    const c = cursor ? `cursor=${encodeURIComponent(cursor)}` : '';
    const q = (base, extra = '') => {
        const qs = [extra, c].filter(Boolean).join('&');
        return api('GET', qs ? `${base}?${qs}` : base);
    };
    if (r.kind === 'home') return q('/api/home', `kind=${r.sub}`);
    throw new Error('不認得的頁面');
}

async function loadMore() {
    const st = state;
    if (!st || st.loading || st.done) return;
    st.loading = true;
    st.error = null;
    renderFoot();
    try {
        const page = await fetchPage(st, st.cursor);
        if (st !== state) return;
        const seen = new Set(st.tweets.map((t) => t.rt_id || t.id));
        const fresh = page.tweets.filter((t) => !seen.has(t.rt_id || t.id));
        const seenU = new Set(st.users.map((u) => u.id));
        const freshU = (page.users || []).filter((u) => !seenU.has(u.id));
        st.tweets.push(...fresh);
        st.users.push(...freshU);
        // X's cursors almost never end: two pages in a row with nothing new means we're at the end
        st.empty = fresh.length || freshU.length ? 0 : st.empty + 1;
        if (!page.cursor || page.cursor === st.cursor || st.empty >= 2) st.done = true;
        st.cursor = page.cursor;
        appendRender(fresh, freshU);
    } catch (e) {
        if (st !== state) return;
        st.error = e.message;
        if (e.code === 'NO_AUTH' || e.code === 'AUTH') st.done = true;
    } finally {
        st.loading = false;
        if (st === state) {
            renderFoot();
            // Keep loading until the content fills the screen
            requestAnimationFrame(() => {
                if (st === state && !st.done && !st.error && feedEl.scrollHeight <= feedEl.clientHeight + 200) loadMore();
            });
        }
    }
}

new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) loadMore();
}, { root: feedEl, rootMargin: '800px 0px' }).observe(footEl);

// ---- Rendering ----
function newState(hash, route) {
    return { hash, route, tweets: [], users: [], cursor: null, done: false, loading: false, empty: 0, error: null, scroll: 0, media: [] };
}

async function openRoute(hash) {
    if (state) state.scroll = feedEl.scrollTop;
    const route = parseRoute(hash);
    highlightSide(hash);
    if (!route) {
        state = null;
        $('#b-empty').classList.remove('hidden');
        $('#b-view').classList.add('hidden');
        return;
    }
    $('#b-empty').classList.add('hidden');
    $('#b-view').classList.remove('hidden');
    $('.browse').classList.add('open');
    state = states.get(hash) || newState(hash, route);
    states.set(hash, state);
    if (pendingFromSide && pendingFromSide === hash) state.fromSide = true;
    pendingFromSide = null;
    // Keep only the 30 most recent pages
    if (states.size > 30) states.delete(states.keys().next().value);
    renderHead();
    rerenderFeed();
    feedEl.scrollTop = state.scroll;
    if (!state.tweets.length && !state.users.length && !state.done) loadMore();
}

function renderHead() {
    const st = state;
    const r = st.route;
    let title = '';
    let sub = '';
    let avatar = '';
    let xUrl = 'https://x.com/home';
    let tabs = null;
    let cur = null;
    if (r.kind === 'home') {
        title = '首頁';
        sub = r.sub === 'foryou' ? '為你推薦' : '追蹤中・依時間排序';
        avatar = `<span class="avatar big icon-avatar">${ico(r.sub === 'foryou' ? 'sparkle' : 'home')}</span>`;
        tabs = HOME_TABS.map(([k, v]) => [`#/home/${k}`, v]);
        cur = `#/home/${r.sub}`;
    }
    $('#b-title').textContent = title;
    $('#b-sub').textContent = sub;
    $('#b-avatar').outerHTML = avatar.replace('<span class="avatar', '<span id="b-avatar" class="avatar');
    $('#b-open-x').href = xUrl;
    const tabsEl = $('#b-tabs');
    tabsEl.classList.toggle('hidden', !tabs);
    if (tabs) tabsEl.innerHTML = tabs.map(([h, v]) => `<a href="${esc(h)}" class="${h === cur ? 'active' : ''}">${esc(v)}</a>`).join('');
}

// Register media in this page's list; returns its index
function register(m, t, i) {
    state.media.push({ m, t, i });
    return state.media.length - 1;
}

function visible(t) {
    const r = state.route;
    if (prefs.hideRt && t.retweeted_by && !(r.kind === 'user' && r.tab !== 'tweets')) return false;
    if (prefs.hideReplies && t.reply_to && r.kind !== 'user') return false;
    return true;
}

function tweetsHtml(list, all) {
    return list.filter(visible).map((t) => renderTweet(t, register)).join('');
}

function rerenderFeed() {
    if (!state) return;
    state.media = [];
    listEl.innerHTML = tweetsHtml(state.tweets, state.tweets);
    renderFoot();
    afterRender();
}

function appendRender(tweets, users) {
    listEl.insertAdjacentHTML('beforeend', tweetsHtml(tweets, state.tweets));
    afterRender();
}

function afterRender() {
    listEl.querySelectorAll('img:not([data-bound])').forEach((img) => {
        img.dataset.bound = '1';
        img.addEventListener('error', () => img.classList.add('broken'), { once: true });
    });
}

function renderFoot() {
    const st = state;
    if (!st) return;
    const count = st.tweets.length + st.users.length;
    if (st.error) {
        const authErr = /cookie|登入/.test(st.error);
        footEl.innerHTML = `<div class="feed-error">${esc(st.error)}</div>${authErr ? '<button class="small primary" data-go-settings>到設定</button>' : '<button class="small" data-retry>重試</button>'}`;
    } else if (st.loading) {
        footEl.innerHTML = `<span class="muted">${count ? '載入中…' : '載入中…（第一次開啟要解析 X 前端，稍等一下）'}</span>`;
    } else if (st.done) {
        footEl.innerHTML = `<span class="muted">${count ? '沒有更多了' : '這裡沒有內容'}</span>`;
    } else {
        footEl.innerHTML = '<button class="small" data-more>載入更多</button>';
    }
}
footEl.addEventListener('click', (e) => {
    if (e.target.closest('[data-retry]')) {
        state.error = null;
        state.done = false;
        loadMore();
    }
    if (e.target.closest('[data-more]')) loadMore();
    if (e.target.closest('[data-go-settings]')) showTab('settings');
});

// ---- Clicks ----
function tweetById(id) {
    if (!state) return null;
    for (const t of state.tweets) {
        if (t.id === id) return t;
        if (t.quote && t.quote.id === id) return t.quote;
    }
    return null;
}

listEl.addEventListener('click', guard(async (e) => {
    const media = e.target.closest('[data-mi]');
    if (media) {
        if (media.classList.contains('spoiler')) {
            media.classList.remove('spoiler');
            return;
        }
    }
    const act = e.target.closest('[data-act]');
    if (act) {
        const art = act.closest('.tw');
        const t = tweetById(art && art.dataset.id);
        if (!t) return;
        if (act.dataset.act === 'copy') {
            await navigator.clipboard.writeText(`https://x.com/${t.user.screen_name}/status/${t.id}`);
            return toast('已複製連結');
        }
        return;
    }
}));

$('#b-reload').addEventListener('click', () => {
    if (!state) return;
    const fresh = newState(state.hash, state.route);
    states.set(state.hash, fresh);
    state = fresh;
    renderHead();
    rerenderFeed();
    feedEl.scrollTop = 0;
    loadMore();
});
// Narrow screens: show either the sidebar or the posts (.browse.open = posts)
const narrow = () => window.matchMedia('(max-width: 860px)').matches;
const showList = () => $('.browse').classList.remove('open');
let pendingFromSide = null; // page opened from the sidebar: on narrow screens, Back returns to the sidebar

$('#b-menu').addEventListener('click', showList);
$('#b-back').addEventListener('click', () => {
    if (narrow() && state && state.fromSide) return showList();
    if (history.length > 1) history.back();
    else if (narrow()) showList();
    else location.hash = '#/home/following';
});

// j / k next / previous post, r refresh
document.addEventListener('keydown', (e) => {
    if ((e.target.closest && e.target.closest('input, textarea, select')) || e.ctrlKey || e.altKey || e.metaKey) return;
    if ($('#tab-browse').classList.contains('hidden') || !state) return;
    if (e.key === 'j' || e.key === 'k') {
        const items = [...listEl.querySelectorAll('.tw')];
        const top = feedEl.getBoundingClientRect().top;
        const idx = items.findIndex((el) => el.getBoundingClientRect().top - top > 4);
        let target;
        if (e.key === 'j') target = items[idx === -1 ? items.length - 1 : idx];
        else target = items[Math.max(0, (idx === -1 ? items.length : idx) - 2)];
        if (target) target.scrollIntoView({ block: 'start' });
    } else if (e.key === 'r') $('#b-reload').click();
    else return;
    e.preventDefault();
});

function highlightSide(hash) {
    document.querySelectorAll('#b-side li[data-route]').forEach((li) => {
        const r = li.dataset.route;
        li.classList.toggle('active', hash === r || (hash || '').startsWith(`${r}/`));
    });
}

$('#b-side').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-route]');
    if (!li) return;
    if (e.ctrlKey || e.metaKey) return window.open(li.dataset.route, '_blank');
    // Clicked the current page: the hash won't change, so switch back to the posts directly
    if (li.classList.contains('active') && state) {
        state.fromSide = true;
        $('.browse').classList.add('open');
        return;
    }
    pendingFromSide = li.dataset.route;
    location.hash = li.dataset.route;
});

window.addEventListener('hashchange', () => {
    showTab('browse');
    openRoute(location.hash);
});

// After login or an account switch: reload the timeline with the new account
function onLogin(switched = false) {
    // Pages loaded earlier belong to another account (or failed before login): drop them all and refetch
    states.clear();
    state = null;
    const target = '#/home/following';
    if (switched || !location.hash || location.hash === '#') {
        if (location.hash === target) openRoute(target);
        else location.replace(target);
    } else openRoute(location.hash);
}

(function start() {
    let tab = 'browse';
    try { tab = localStorage.getItem('tab') || 'browse'; } catch { /* private browsing */ }
    showTab(location.hash ? 'browse' : tab);
    if (location.hash) openRoute(location.hash);
})();
