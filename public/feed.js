// Browsing: sources on the left (timelines, bookmarks, lists, followed accounts), posts on the right. Routes live in #/..., so the browser's Back works.

const feedEl = $('#b-feed');
const listEl = $('#b-list');
const footEl = $('#b-foot');
const states = new Map(); // hash -> each page's loaded content and scroll position
let state = null;
let me = null; // the logged-in account { screen_name, id }

const USER_TABS = [['tweets', '貼文'], ['replies', '回覆'], ['media', '媒體'], ['likes', '喜歡']];
const SEARCH_TABS = [['latest', '最新'], ['top', '熱門'], ['media', '媒體'], ['people', '使用者']];
const HOME_TABS = [['following', '追蹤中'], ['foryou', '為你推薦']];

function parseRoute(hash) {
    const parts = (hash || '').replace(/^#\/?/, '').split('/');
    const [kind, a, ...rest] = parts;
    if (kind === 'home') return { kind, sub: a === 'foryou' ? 'foryou' : 'following' };
    if (kind === 'bookmarks') return { kind };
    if (kind === 'me') return { kind };
    if (kind === 'user' && a) return { kind, name: a, tab: USER_TABS.some(([k]) => k === rest[0]) ? rest[0] : 'tweets' };
    if (kind === 'tweet' && /^\d+$/.test(a || '')) {
        if (rest[0] === 'retweets') return { kind: 'retweets', id: a };
        if (rest[0] === 'quotes') return { kind: 'quotes', id: a };
        return { kind, id: a };
    }
    if (kind === 'multi' && a) {
        const users = decodeURIComponent(a).split(',').filter((u) => /^\w{1,15}$/.test(u));
        if (users.length) return { kind, users, media: rest[0] === 'media' };
    }
    if (kind === 'search' && rest.length) return { kind, product: SEARCH_TABS.some(([k]) => k === a) ? a : 'latest', q: decodeURIComponent(rest.join('/')) };
    if (kind === 'list' && a) return { kind, id: a };
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
    if (r.kind === 'bookmarks') return q('/api/bookmarks');
    if (r.kind === 'user') {
        if (!st.profile) {
            st.profile = await api('GET', `/api/user/${encodeURIComponent(r.name)}`);
            renderHead();
        }
        return q(`/api/user/${st.profile.id}/timeline`, `tab=${r.tab}`);
    }
    if (r.kind === 'tweet') return q(`/api/tweet/${r.id}`);
    if (r.kind === 'retweets') return q(`/api/tweet/${r.id}/retweeters`);
    if (r.kind === 'quotes') return q(`/api/tweet/${r.id}/quotes`);
    if (r.kind === 'multi') return q('/api/multi', `users=${encodeURIComponent(r.users.join(','))}${r.media ? '&media=1' : ''}`);
    if (r.kind === 'search') return q('/api/search', `q=${encodeURIComponent(r.q)}&product=${r.product}`);
    if (r.kind === 'list') {
        if (!st.list) {
            st.list = await api('GET', `/api/list/${r.id}`);
            renderHead();
        }
        return q(`/api/list/${r.id}/timeline`);
    }
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
    const wall = (route.kind === 'user' && route.tab === 'media') || (route.kind === 'search' && route.product === 'media') || (route.kind === 'multi' && route.media);
    return { hash, route, tweets: [], users: [], cursor: null, done: false, loading: false, empty: 0, error: null, scroll: 0, wall, media: [] };
}

async function openRoute(hash) {
    if (state) state.scroll = feedEl.scrollTop;
    if (selecting && (!state || state.hash !== hash)) setSelecting(false);
    let route = parseRoute(hash);
    if (route && route.kind === 'me') {
        if (!me) {
            $('#b-empty').classList.remove('hidden');
            $('#b-view').classList.add('hidden');
            return;
        }
        location.replace(`#/user/${me.screen_name}`);
        return;
    }
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
    if (pendingFromSide && (pendingFromSide === hash || pendingFromSide === '#/me')) state.fromSide = true;
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
    } else if (r.kind === 'bookmarks') {
        title = '書籤';
        avatar = `<span class="avatar big icon-avatar">${ico('bookmark')}</span>`;
        xUrl = 'https://x.com/i/bookmarks';
    } else if (r.kind === 'user') {
        const p = st.profile;
        title = p ? p.name : `@${r.name}`;
        sub = p ? `@${p.screen_name}・${fmtNum(p.tweets)} 則貼文` : '載入中…';
        avatar = p ? avatarHtml(p, 'big') : '<span class="avatar big"></span>';
        xUrl = `https://x.com/${r.name}`;
        const isMe = me && p && p.id === me.id;
        tabs = USER_TABS.filter(([k]) => k !== 'likes' || isMe).map(([k, v]) => [`#/user/${r.name}${k === 'tweets' ? '' : `/${k}`}`, v]);
        cur = `#/user/${r.name}${r.tab === 'tweets' ? '' : `/${r.tab}`}`;
    } else if (r.kind === 'tweet') {
        title = '推文';
        sub = '對話串';
        avatar = `<span class="avatar big icon-avatar">${ico('chat')}</span>`;
        const focal = st.tweets.find((t) => t.id === r.id);
        xUrl = `https://x.com/${focal && focal.user ? focal.user.screen_name : 'i'}/status/${r.id}`;
    } else if (r.kind === 'search') {
        title = `搜尋：${r.q}`;
        avatar = `<span class="avatar big icon-avatar">${ico('search')}</span>`;
        xUrl = `https://x.com/search?q=${encodeURIComponent(r.q)}&f=live`;
        tabs = SEARCH_TABS.map(([k, v]) => [`#/search/${k}/${encodeURIComponent(r.q)}`, v]);
        cur = `#/search/${r.product}/${encodeURIComponent(r.q)}`;
    } else if (r.kind === 'list') {
        const l = st.list;
        title = l ? l.name : '列表';
        sub = l ? `${fmtNum(l.members)} 位成員` : '載入中…';
        avatar = `<span class="avatar big icon-avatar">${ico('list')}</span>`;
        xUrl = `https://x.com/i/lists/${r.id}`;
    } else if (r.kind === 'retweets' || r.kind === 'quotes') {
        title = r.kind === 'retweets' ? '轉推名單' : '引用推文';
        sub = '回到推文按左上返回';
        avatar = `<span class="avatar big icon-avatar">${ico(r.kind === 'retweets' ? 'retweet' : 'quote')}</span>`;
        xUrl = `https://x.com/i/status/${r.id}/${r.kind}`;
    } else if (r.kind === 'multi') {
        const g = groupFor(r.users);
        title = g ? g.name : r.users.map((u) => `@${u}`).join('、');
        sub = `多人時間軸・${r.users.length} 個帳號`;
        avatar = `<span class="avatar big icon-avatar">${ico('topics')}</span>`;
        xUrl = `https://x.com/search?q=${encodeURIComponent(r.users.map((u) => `from:${u}`).join(' OR '))}&f=live`;
        const base = `#/multi/${r.users.join(',')}`;
        tabs = [[base, '全部'], [`${base}/media`, '媒體']];
        cur = r.media ? `${base}/media` : base;
    }
    $('#b-rss').classList.toggle('hidden', !rssUrl(r));
    $('#b-title').textContent = title;
    $('#b-sub').textContent = sub;
    $('#b-avatar').outerHTML = avatar.replace('<span class="avatar', '<span id="b-avatar" class="avatar');
    $('#b-open-x').href = xUrl;
    $('#b-wall').classList.toggle('on', st.wall);
    $('#b-wall').classList.toggle('hidden', r.kind === 'search' && r.product === 'people');
    const tabsEl = $('#b-tabs');
    tabsEl.classList.toggle('hidden', !tabs);
    if (tabs) tabsEl.innerHTML = tabs.map(([h, v]) => `<a href="${esc(h)}" class="${h === cur ? 'active' : ''}">${esc(v)}</a>`).join('');
}

// Register media in the viewer's list; returns its index
function register(m, t, i) {
    state.media.push({ m, t, i });
    return state.media.length - 1;
}

// This page's RSS URL; null for pages without RSS
function rssUrl(r) {
    const base = `${location.origin}/rss`;
    if (r.kind === 'home' && r.sub === 'following') return `${base}/home`;
    if (r.kind === 'user' && r.tab !== 'likes') return `${base}/user/${encodeURIComponent(r.name)}${r.tab === 'tweets' ? '' : `?tab=${r.tab}`}`;
    if (r.kind === 'search' && r.product !== 'people') return `${base}/search?q=${encodeURIComponent(r.q)}${r.product === 'latest' ? '' : `&product=${r.product}`}`;
    if (r.kind === 'list') return `${base}/list/${encodeURIComponent(r.id)}`;
    if (r.kind === 'multi') {
        const g = groupFor(r.users);
        return `${base}/multi?users=${encodeURIComponent(r.users.join(','))}${r.media ? '&media=1' : ''}${g ? `&name=${encodeURIComponent(g.name)}` : ''}`;
    }
    return null;
}

function visible(t) {
    const r = state.route;
    if (r.kind === 'tweet' || r.kind === 'search' || r.kind === 'quotes' || r.kind === 'multi') return true;
    if (prefs.hideRt && t.retweeted_by && !(r.kind === 'user' && r.tab !== 'tweets')) return false;
    if (prefs.hideReplies && t.reply_to && r.kind !== 'user') return false;
    return true;
}

function tweetsHtml(list, all) {
    const r = state.route;
    if (state.wall) {
        return list.filter(visible).flatMap((t) => (t.media || []).map((m, i) => {
            const mi = register(m, t, i);
            const badge = m.type === 'video' ? `<span class="media-badge">${ico('play')} ${m.duration ? fmtDur(m.duration) : ''}</span>` : (m.type === 'gif' ? '<span class="media-badge">GIF</span>' : '');
            const blur = prefs.blurSensitive && (t.sensitive || m.sensitive) ? ' spoiler' : '';
            return `<div class="wall-item${blur}" data-mi="${mi}"><img src="${esc(m.thumb)}" loading="lazy" alt="">${badge}</div>`;
        })).join('');
    }
    const shown = list.filter(visible);
    return shown.map((t) => {
        const idx = all.indexOf(t);
        const next = all[idx + 1];
        const opts = {};
        if (r.kind === 'tweet') {
            opts.inThread = true;
            opts.focal = t.id === r.id;
            const focalIdx = all.findIndex((x) => x.id === r.id);
            // Link ancestors before the focal post, and replies in the same thread
            opts.threadLine = (focalIdx > -1 && idx < focalIdx) || (t.group && next && next.group === t.group);
        }
        return renderTweet(t, register, opts);
    }).join('');
}

function rerenderFeed() {
    if (!state) return;
    state.media = [];
    const top = [];
    if (state.route.kind === 'user' && state.profile) top.push(renderProfile(state.profile));
    if (state.route.kind === 'list' && state.list) top.push(renderListHead(state.list));
    $('#b-top').innerHTML = top.join('');
    listEl.className = state.wall ? 'wall' : '';
    listEl.innerHTML = tweetsHtml(state.tweets, state.tweets) + state.users.map(renderUserRow).join('');
    renderFoot();
    afterRender();
}

function appendRender(tweets, users) {
    if (state.route.kind === 'user' && state.profile && !$('#b-top').innerHTML) $('#b-top').innerHTML = renderProfile(state.profile);
    if (state.route.kind === 'list' && state.list && !$('#b-top').innerHTML) $('#b-top').innerHTML = renderListHead(state.list);
    // Thread lines depend on neighbours, so re-rendering everything is simpler
    if (state.route.kind === 'tweet') {
        const keep = feedEl.scrollTop;
        rerenderFeed();
        const focal = listEl.querySelector('.tw.focal');
        if (!keep && focal && !state.scrolledToFocal) {
            state.scrolledToFocal = true;
            focal.scrollIntoView({ block: 'start' });
            feedEl.scrollTop -= 8;
        } else feedEl.scrollTop = keep;
        return;
    }
    listEl.insertAdjacentHTML('beforeend', tweetsHtml(tweets, state.tweets) + users.map(renderUserRow).join(''));
    afterRender();
}

function afterRender() {
    listEl.querySelectorAll('img:not([data-bound])').forEach((img) => {
        img.dataset.bound = '1';
        img.addEventListener('error', () => img.classList.add('broken'), { once: true });
    });
    markSelected();
    markDownloaded();
}

// ---- Downloaded marks (✓) ----
// Remember by media URL whether it was downloaded; re-renders reuse this instead of asking the server again
const gotCache = new Map();
let gotBusy = false;
function applyGot() {
    if (!state) return;
    listEl.querySelectorAll('[data-mi]').forEach((el) => {
        const it = state.media[Number(el.dataset.mi)];
        el.classList.toggle('got', !!(it && gotCache.get(it.m.url)));
    });
}
async function markDownloaded() {
    applyGot();
    if (gotBusy || !state) return;
    const todo = [];
    const seen = new Set();
    state.media.forEach((it, mi) => {
        if (it.m.url && !gotCache.has(it.m.url) && !seen.has(it.m.url)) {
            seen.add(it.m.url);
            todo.push(mi);
        }
    });
    if (!todo.length) return;
    gotBusy = true;
    try {
        for (let i = 0; i < todo.length; i += 400) {
            const part = todo.slice(i, i + 400);
            const r = await api('POST', '/api/downloaded', { items: part.map(mediaItem) });
            part.forEach((mi, k) => gotCache.set(state.media[mi].m.url, !!r[k]));
        }
    } catch { /* can't check: leave unmarked for now */ }
    gotBusy = false;
    applyGot();
}
// Called by app.js when the download queue finishes: re-check the ones not yet downloaded
function refreshDownloaded() {
    for (const [k, v] of gotCache) if (!v) gotCache.delete(k);
    markDownloaded();
}

// ---- Multi-select download ----
let selecting = false;
const selected = new Set(); // media URLs

function markSelected() {
    if (!state) return;
    listEl.querySelectorAll('[data-mi]').forEach((el) => {
        const it = state.media[Number(el.dataset.mi)];
        el.classList.toggle('selected', !!(selecting && it && selected.has(it.m.url)));
    });
    $('#b-sel-count').textContent = selected.size;
}
function setSelecting(on) {
    selecting = on;
    if (!on) selected.clear();
    $('#b-selbar').classList.toggle('hidden', !on);
    $('#b-select').classList.toggle('on', on);
    listEl.classList.toggle('selecting', on);
    markSelected();
}
// Selected URLs → download items (each URL once)
function selectedItems() {
    const seen = new Set();
    const out = [];
    state.media.forEach((it, mi) => {
        if (selected.has(it.m.url) && !seen.has(it.m.url)) {
            seen.add(it.m.url);
            out.push(mediaItem(mi));
        }
    });
    return out;
}
$('#b-select').addEventListener('click', () => setSelecting(!selecting));
$('#b-sel-cancel').addEventListener('click', () => setSelecting(false));
$('#b-sel-all').addEventListener('click', () => {
    state.media.forEach((it) => it.m.url && selected.add(it.m.url));
    markSelected();
});
$('#b-sel-new').addEventListener('click', () => {
    state.media.forEach((it) => it.m.url && !gotCache.get(it.m.url) && selected.add(it.m.url));
    markSelected();
});
$('#b-sel-dl').addEventListener('click', guard(async () => {
    if (!selected.size) return toast('還沒有選任何媒體');
    await download(selectedItems());
    setSelecting(false);
}));

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
function mediaItem(mi) {
    const it = state.media[mi];
    if (!it) return null;
    return { url: it.m.url, user: it.t.user && it.t.user.screen_name, tweetId: it.t.id, idx: it.i + 1, ext: it.m.ext };
}
async function download(items) {
    const list = items.filter((i) => i && i.url);
    if (!list.length) return toast('沒有可以下載的媒體');
    const r = await api('POST', '/api/download', { items: list });
    toast(`已加入下載：${r.queued} 個`);
    pollStatus();
}

function tweetById(id) {
    if (!state) return null;
    for (const t of state.tweets) {
        if (t.id === id) return t;
        if (t.quote && t.quote.id === id) return t.quote;
    }
    return null;
}

listEl.addEventListener('click', guard(async (e) => {
    const dl = e.target.closest('[data-dl-mi]');
    if (dl) {
        e.stopPropagation();
        return download([mediaItem(Number(dl.dataset.dlMi))]);
    }
    const media = e.target.closest('[data-mi]');
    if (media && selecting) {
        const it = state.media[Number(media.dataset.mi)];
        if (it && it.m.url) {
            if (selected.has(it.m.url)) selected.delete(it.m.url);
            else selected.add(it.m.url);
            markSelected();
        }
        return;
    }
    if (media) {
        if (media.classList.contains('spoiler')) {
            media.classList.remove('spoiler');
            return;
        }
        return openViewer(Number(media.dataset.mi));
    }
    const act = e.target.closest('[data-act]');
    if (act) {
        const art = act.closest('.tw');
        const t = tweetById(art && art.dataset.id);
        if (!t) return;
        if (act.dataset.act === 'dl') {
            return download(t.media.map((m, i) => ({ url: m.url, user: t.user.screen_name, tweetId: t.id, idx: i + 1, ext: m.ext })));
        }
        if (act.dataset.act === 'copy') {
            await navigator.clipboard.writeText(`https://x.com/${t.user.screen_name}/status/${t.id}`);
            return toast('已複製連結');
        }
        return;
    }
    if (e.target.closest('a, button, input, video, .poll')) return;
    // Don't navigate while selecting text
    if (String(window.getSelection())) return;
    const quote = e.target.closest('[data-open]');
    if (quote) {
        location.hash = `#/tweet/${quote.dataset.open}`;
        return;
    }
    const row = e.target.closest('.user-row');
    if (row) {
        location.hash = `#/user/${row.dataset.user}`;
        return;
    }
    const art = e.target.closest('.tw[data-id]');
    if (art && !art.classList.contains('focal')) {
        const id = art.dataset.id;
        if (e.ctrlKey || e.metaKey) window.open(`#/tweet/${id}`, '_blank');
        else location.hash = `#/tweet/${id}`;
    }
}));

// Play GIFs on hover (muted)
listEl.addEventListener('mouseover', (e) => {
    const media = e.target.closest('.media[data-mi], .wall-item[data-mi]');
    if (!media || media.querySelector('video') || media.classList.contains('spoiler')) return;
    const it = state.media[Number(media.dataset.mi)];
    if (!it || it.m.type !== 'gif' || !it.m.url) return;
    const v = document.createElement('video');
    Object.assign(v, { src: it.m.url, muted: true, loop: true, autoplay: true, playsInline: true });
    v.className = 'hover-video';
    media.appendChild(v);
    media.addEventListener('mouseleave', () => v.remove(), { once: true });
});

$('#b-wall').addEventListener('click', () => {
    if (!state) return;
    state.wall = !state.wall;
    $('#b-wall').classList.toggle('on', state.wall);
    rerenderFeed();
    feedEl.scrollTop = 0;
});
$('#b-reload').addEventListener('click', () => {
    if (!state) return;
    const fresh = newState(state.hash, state.route);
    fresh.wall = state.wall;
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

// j / k next / previous post, r refresh, g media wall
document.addEventListener('keydown', (e) => {
    if ((e.target.closest && e.target.closest('input, textarea, select')) || e.ctrlKey || e.altKey || e.metaKey || $('#viewer').open) return;
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
    else if (e.key === 'g') $('#b-wall').click();
    else if (e.key === 's') $('#b-select').click();
    else if (e.key === 'Escape' && selecting) setSelecting(false);
    else return;
    e.preventDefault();
});

// ---- Sidebar: lists, followed accounts ----
let follows = [];
let followCursor = null;
let followDone = false;
let followLoading = false;

function highlightSide(hash) {
    document.querySelectorAll('#b-side li[data-route]').forEach((li) => {
        const r = li.dataset.route;
        const meHash = me ? `#/user/${me.screen_name}` : null;
        li.classList.toggle('active', hash === r || (hash || '').startsWith(`${r}/`) || (r === '#/me' && meHash && (hash === meHash || (hash || '').startsWith(`${meHash}/`))));
    });
}

function renderFollows() {
    const q = $('#b-q').value.trim().toLowerCase().replace(/^@/, '');
    const list = q ? follows.filter((u) => u.name.toLowerCase().includes(q) || u.screen_name.toLowerCase().includes(q)) : follows;
    $('#b-follow').innerHTML = list.map((u) => `<li data-route="#/user/${esc(u.screen_name)}">
        ${avatarHtml(u)}
        <div class="c-body"><div class="c-title">${esc(u.name)}${verifiedIcon(u)}${lockIcon(u)}</div><div class="muted small-text">@${esc(u.screen_name)}</div></div>
    </li>`).join('') || (followLoading ? '' : '<li class="muted empty-li">沒有符合的帳號</li>');
    $('#b-follow-count').textContent = follows.length ? `${follows.length}${followDone ? '' : '+'}` : '';
    $('#b-follow-more').classList.toggle('hidden', followDone || followLoading || !follows.length);
    highlightSide(location.hash);
}

async function loadFollows(reset = false) {
    if (followLoading) return;
    if (reset) {
        follows = [];
        followCursor = null;
        followDone = false;
    }
    if (followDone) return;
    followLoading = true;
    if (!follows.length) $('#b-follow').innerHTML = Array.from({ length: 6 }, () => '<li class="skeleton"><span class="avatar sk"></span><div class="c-body"><div class="sk" style="height:.9rem;width:60%"></div></div></li>').join('');
    try {
        const r = await api('GET', `/api/following${followCursor ? `?cursor=${encodeURIComponent(followCursor)}` : ''}`);
        const seen = new Set(follows.map((u) => u.id));
        const fresh = r.users.filter((u) => !seen.has(u.id));
        follows.push(...fresh);
        if (!r.cursor || r.cursor === followCursor || !fresh.length) followDone = true;
        followCursor = r.cursor;
    } catch (e) {
        followDone = true;
        $('#b-follow').innerHTML = `<li class="muted empty-li">${esc(e.message)}</li>`;
        followLoading = false;
        return;
    }
    followLoading = false;
    renderFollows();
}

async function loadLists() {
    try {
        const lists = await api('GET', '/api/lists');
        $('#b-lists').innerHTML = lists.map((l) => `<li data-route="#/list/${esc(l.id)}"><span class="side-icon">${ico('list')}</span><div class="c-body"><div class="c-title">${esc(l.name)}${l.private ? lockIcon({ protected: true }) : ''}</div><div class="muted small-text">${fmtNum(l.members)} 位成員</div></div></li>`).join('') || '<li class="muted empty-li">沒有列表</li>';
        highlightSide(location.hash);
    } catch (e) {
        $('#b-lists').innerHTML = `<li class="muted empty-li">${esc(e.message)}</li>`;
    }
}

// ---- Custom groups for multi-user timelines (stored on the server in data/settings.json) ----
let groups = [];
const sameUsers = (a, b) => a.length === b.length && a.every((u) => b.some((v) => v.toLowerCase() === u.toLowerCase()));
const groupFor = (users) => groups.find((g) => sameUsers(g.users, users)) || null;

function renderGroups() {
    $('#b-groups').innerHTML = groups.map((g, i) => `<li data-route="#/multi/${esc(g.users.join(','))}">
        <span class="side-icon">${ico('topics')}</span>
        <div class="c-body"><div class="c-title">${esc(g.name)}</div><div class="muted small-text">${g.users.length} 個帳號</div></div>
        <button class="icon side-act" data-group-edit="${i}" title="編輯">${ico('edit')}</button>
        <button class="icon side-act" data-group-del="${i}" title="刪除">${ico('trash')}</button>
    </li>`).join('') || '<li class="muted empty-li">按 ＋ 建立，把幾個帳號的推文合在一起看</li>';
    highlightSide(location.hash);
}
async function loadGroups() {
    try {
        groups = await api('GET', '/api/groups');
    } catch {
        groups = [];
    }
    renderGroups();
}
async function saveGroups() {
    groups = await api('PUT', '/api/groups', groups);
    renderGroups();
    if (state && state.route.kind === 'multi') renderHead();
}
// Add or edit a group; preset is a list of handles to pre-fill
async function editGroup(idx = -1, preset = []) {
    const g = idx >= 0 ? groups[idx] : { name: '', users: preset };
    const html = `<label>名稱 <input id="grp-name" value="${esc(g.name)}" placeholder="例如：繪師"></label>
        <label>帳號（空白、逗號或換行分隔，最多 25 個） <textarea id="grp-users" rows="5" placeholder="@user1 @user2">${esc(g.users.map((u) => `@${u}`).join('\n'))}</textarea></label>`;
    const ok = await ask(idx >= 0 ? '編輯群組' : '新增多人時間軸', html, [{ label: '取消', value: false }, { label: '儲存', value: true, cls: 'primary' }]);
    if (!ok) return;
    const name = $('#grp-name').value.trim();
    const users = [...new Set($('#grp-users').value.split(/[\s,，]+/).map((u) => u.replace(/^@/, '')).filter((u) => /^\w{1,15}$/.test(u)))];
    if (!users.length) return toast('沒有有效的帳號');
    if (users.length > 25) return toast('最多 25 個帳號');
    const item = { name: name || users.map((u) => `@${u}`).join('、').slice(0, 50), users };
    if (idx >= 0) groups[idx] = item;
    else groups.push(item);
    await saveGroups();
    location.hash = `#/multi/${users.join(',')}`;
}
$('#b-groups-add').addEventListener('click', guard(() => {
    // Pressing ＋ on someone's profile pre-fills that person
    const preset = state && state.route.kind === 'user' && state.profile ? [state.profile.screen_name] : (state && state.route.kind === 'multi' ? state.route.users : []);
    return editGroup(-1, preset);
}));
$('#b-groups').addEventListener('click', guard(async (e) => {
    const ed = e.target.closest('[data-group-edit]');
    const del = e.target.closest('[data-group-del]');
    if (!ed && !del) return;
    e.stopPropagation();
    if (ed) return editGroup(Number(ed.dataset.groupEdit));
    const g = groups[Number(del.dataset.groupDel)];
    if (!await confirmBox(`刪除群組「${g.name}」？`, { ok: '刪除', danger: true })) return;
    groups.splice(Number(del.dataset.groupDel), 1);
    await saveGroups();
}));

$('#b-rss').addEventListener('click', guard(async () => {
    const url = state && rssUrl(state.route);
    if (!url) return;
    await navigator.clipboard.writeText(url);
    toast('已複製 RSS 網址，貼到 RSS 閱讀器訂閱（閱讀器要在這台電腦上）');
}));

$('#b-side').addEventListener('click', (e) => {
    if (e.target.closest('.side-act')) return;
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
$('#b-side').addEventListener('scroll', () => {
    const s = $('#b-side');
    if (s.scrollTop + s.clientHeight > s.scrollHeight - 300 && !followDone && follows.length) loadFollows();
});
$('#b-follow-more').addEventListener('click', () => loadFollows());
$('#b-follow-refresh').addEventListener('click', () => loadFollows(true));
$('#b-lists-refresh').addEventListener('click', () => loadLists());
$('#b-q').addEventListener('input', renderFollows);
$('#b-q').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const v = $('#b-q').value.trim();
    if (!v) return;
    const inner = internalHref(v);
    let target;
    if (inner) target = inner;
    else if (/^@\w{1,15}$/.test(v)) target = `#/user/${v.slice(1)}`;
    else target = `#/search/latest/${encodeURIComponent(v)}`;
    pendingFromSide = target;
    if (location.hash === target) {
        if (state) state.fromSide = true;
        $('.browse').classList.add('open');
    } else location.hash = target;
    showTab('browse');
});
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        showTab('browse');
        $('#b-q').focus();
        $('#b-q').select();
    }
});

window.addEventListener('hashchange', () => {
    showTab('browse');
    openRoute(location.hash);
});

// After login or an account switch: reload the sidebar and timeline with the new account
function onLogin(switched = false) {
    me = authState && authState.user;
    // Pages loaded earlier belong to another account (or failed before login): drop them all and refetch
    states.clear();
    state = null;
    loadLists();
    loadFollows(true);
    const target = '#/home/following';
    if (switched || !location.hash || location.hash === '#') {
        if (location.hash === target) openRoute(target);
        else location.replace(target);
    } else openRoute(location.hash);
}

(function start() {
    loadGroups();
    let tab = 'browse';
    try { tab = localStorage.getItem('tab') || 'browse'; } catch { /* private browsing */ }
    showTab(location.hash ? 'browse' : tab);
    if (location.hash) openRoute(location.hash);
})();
