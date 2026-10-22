// HTML for posts, users and profiles. All content goes through esc().

const RESERVED = new Set(['home', 'search', 'i', 'explore', 'settings', 'notifications', 'messages', 'compose', 'hashtag', 'intent', 'share', 'tos', 'privacy']);

// x.com links open inside Perch, everything else in a new tab
function internalHref(url) {
    const m = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/(\w{1,15})\/status(?:es)?\/(\d+)/i.exec(url || '');
    if (m) return `#/tweet/${m[2]}`;
    const u = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/(\w{1,15})\/?(?:[?#].*)?$/i.exec(url || '');
    if (u && !RESERVED.has(u[1].toLowerCase())) return `#/user/${u[1]}`;
    const s = /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/hashtag\/([^/?#]+)/i.exec(url || '');
    if (s) return `#/search/latest/${encodeURIComponent(`#${decodeURIComponent(s[1])}`)}`;
    return null;
}

function linkHtml(href, text) {
    const inner = internalHref(href);
    if (inner) return `<a href="${esc(inner)}">${esc(text)}</a>`;
    return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`;
}

function renderText(segs) {
    return (segs || []).map((s) => {
        if (s.t === 'url') return linkHtml(s.href, s.v);
        if (s.t === 'mention') return `<a href="#/user/${esc(s.user)}">${esc(s.v)}</a>`;
        if (s.t === 'tag') return `<a class="tag" href="#/search/latest/${esc(encodeURIComponent(s.q))}">${esc(s.v)}</a>`;
        return esc(s.v);
    }).join('');
}
const plainText = (segs) => (segs || []).map((s) => s.v).join('');

const verifiedIcon = (u) => (u && u.verified ? `<span class="verified" title="已認證">${ico('verified')}</span>` : '');
const lockIcon = (u) => (u && u.protected ? `<span class="mark" title="私密帳號">${ico('lock')}</span>` : '');

function avatarHtml(u, cls = '') {
    if (!u) return `<span class="avatar ${cls}"></span>`;
    const letter = esc(Array.from(u.name || u.screen_name || '?')[0] || '?');
    return `<span class="avatar ${cls}">${letter}${u.avatar ? `<img src="${esc(u.avatar)}" loading="lazy" alt="" onerror="this.remove()">` : ''}</span>`;
}

const fmtDur = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// reg(media, tweet) returns this media's index in the viewer list
function renderMedia(t, reg, compact = false) {
    const list = t.media || [];
    if (!list.length) return '';
    const blur = prefs.blurSensitive && (t.sensitive || list.some((m) => m.sensitive));
    const cls = list.length === 1 ? 'single' : `n${Math.min(list.length, 4)}`;
    const items = list.map((m, i) => {
        const mi = reg(m, t, i);
        const ratio = list.length === 1 && m.w && m.h ? ` style="aspect-ratio:${m.w}/${m.h}"` : '';
        let badge = '';
        if (m.type === 'video') badge = `<span class="media-badge">${ico('play')} ${m.duration ? fmtDur(m.duration) : '影片'}</span>`;
        if (m.type === 'gif') badge = '<span class="media-badge">GIF</span>';
        const play = m.type !== 'photo' ? `<span class="play-btn">${ico('play')}</span>` : '';
        return `<div class="media${blur ? ' spoiler' : ''}" data-mi="${mi}"${ratio} title="${esc(m.alt || '')}">
            <img src="${esc(compact || list.length > 1 ? m.thumb : m.preview)}" loading="lazy" alt="">${play}${badge}
            <button class="media-dl" data-dl-mi="${mi}" title="下載到資料夾">${ico('download')}</button>
        </div>`;
    }).join('');
    return `<div class="media-grid ${cls}">${items}</div>`;
}

function renderCard(c) {
    if (!c) return '';
    if (c.kind === 'poll') {
        const total = c.choices.reduce((a, b) => a + b.count, 0) || 1;
        return `<div class="poll">${c.choices.map((ch) => {
            const pct = Math.round((ch.count / total) * 100);
            return `<div class="poll-row"><span class="poll-bar" style="width:${pct}%"></span><span class="poll-label">${esc(ch.label)}</span><span class="poll-pct">${pct}%</span></div>`;
        }).join('')}<div class="muted small-text">${fmtNum(total)} 票${c.final ? '・已結束' : ''}</div></div>`;
    }
    const href = c.url || '#';
    return `<a class="link-card" href="${esc(href)}" target="_blank" rel="noopener noreferrer">
        ${c.image ? `<img src="${esc(c.image)}" loading="lazy" alt="">` : ''}
        <div class="lc-body"><div class="muted small-text">${esc(c.domain)}</div><div class="lc-title">${esc(c.title)}</div>${c.description ? `<div class="muted lc-desc">${esc(c.description)}</div>` : ''}</div>
    </a>`;
}

// Articles: a card in timelines; the full text on the focal post of a thread
function renderArticleCard(a, tid) {
    return `<a class="art-card" href="#/tweet/${esc(tid)}">
        ${a.cover ? `<img src="${esc(a.cover)}" loading="lazy" alt="">` : ''}
        <div class="art-card-body"><div class="art-tag">${ico('file')} 長文</div><div class="art-title">${esc(a.title)}</div>${a.preview ? `<div class="muted art-preview">${esc(a.preview)}</div>` : ''}</div>
    </a>`;
}

function articleSegsHtml(segs) {
    return (segs || []).map((s) => {
        let h = esc(s.v);
        if (s.b) h = `<b>${h}</b>`;
        if (s.i) h = `<i>${h}</i>`;
        if (s.s) h = `<s>${h}</s>`;
        if (s.href) h = linkHtml(s.href, s.v).replace(`>${esc(s.v)}<`, `>${h}<`);
        return h;
    }).join('');
}

function renderArticleFull(a, reg, t) {
    const out = [];
    let list = null; // consecutive list items are merged into one ul / ol
    const flush = () => {
        if (list) out.push(`<${list.tag}>${list.items.join('')}</${list.tag}>`);
        list = null;
    };
    let mediaIdx = 100; // article images are numbered from 101 so file names don't clash with the post's own media
    for (const b of a.blocks || []) {
        const tag = b.type === 'unordered-list-item' ? 'ul' : (b.type === 'ordered-list-item' ? 'ol' : null);
        if (tag) {
            if (!list || list.tag !== tag) {
                flush();
                list = { tag, items: [] };
            }
            list.items.push(`<li>${articleSegsHtml(b.segs)}</li>`);
            continue;
        }
        flush();
        if (b.type === 'media') {
            out.push(`<div class="art-media">${b.media.map((m) => {
                const mi = reg(m, t, mediaIdx++);
                return `<div class="media" data-mi="${mi}"><img src="${esc(m.preview)}" loading="lazy" alt="">${m.type !== 'photo' ? `<span class="play-btn">${ico('play')}</span>` : ''}</div>`;
            }).join('')}</div>`);
        } else if (b.type === 'divider') out.push('<hr>');
        else if (b.type === 'tweet') out.push(`<a class="art-embed" href="#/tweet/${esc(b.id)}">${ico('chat')} 嵌入的推文</a>`);
        else if (b.type === 'header-one') out.push(`<h2>${articleSegsHtml(b.segs)}</h2>`);
        else if (b.type === 'header-two' || b.type === 'header-three') out.push(`<h3>${articleSegsHtml(b.segs)}</h3>`);
        else if (b.type === 'blockquote') out.push(`<blockquote>${articleSegsHtml(b.segs)}</blockquote>`);
        else if (b.type === 'code-block') out.push(`<pre>${b.segs.map((s) => esc(s.v)).join('')}</pre>`);
        else {
            const html = articleSegsHtml(b.segs);
            out.push(html.trim() ? `<p>${html}</p>` : '');
        }
    }
    flush();
    return `<div class="article">
        ${a.cover ? `<img class="art-cover" src="${esc(a.cover)}" alt="">` : ''}
        <h1 class="art-h1">${esc(a.title)}</h1>
        ${out.join('')}
    </div>`;
}

function tweetHead(t, full = false) {
    const u = t.user || {};
    const time = full
        ? `<span class="muted">${esc(fmtTime(t.created_at))}</span>`
        : `<a class="muted tw-time" href="#/tweet/${esc(t.id)}" title="${esc(fmtTime(t.created_at))}">${esc(fmtAgo(t.created_at))}</a>`;
    return `<div class="tw-head">
        <a class="tw-name" href="#/user/${esc(u.screen_name)}"><b>${esc(u.name)}</b>${verifiedIcon(u)}${lockIcon(u)}</a>
        <span class="muted tw-handle">@${esc(u.screen_name)}</span><span class="muted">·</span>${time}
    </div>`;
}

function renderQuote(q, reg) {
    if (!q) return '';
    if (q.tombstone) return `<div class="tw-quote muted">${esc(q.tombstone)}</div>`;
    return `<div class="tw-quote" data-open="${esc(q.id)}">
        <div class="tw-quote-head">${avatarHtml(q.user, 'tiny')}${tweetHead(q)}</div>
        ${q.text.length ? `<div class="tw-text clamp">${renderText(q.text)}</div>` : ''}
        ${renderMedia(q, reg, true)}
    </div>`;
}

// on: whether you liked / reposted / bookmarked it yourself; display only
function stat(icon, n, title, on = '') {
    return `<span class="tw-stat${on ? ` on ${on}` : ''}" title="${esc(title)}">${ico(icon)}<span>${n ? fmtNum(n) : ''}</span></span>`;
}

function renderTweet(t, reg, opts = {}) {
    if (t.tombstone) return `<article class="tw tombstone muted">${esc(t.tombstone)}</article>`;
    const u = t.user || {};
    const pre = [];
    if (t.pinned) pre.push(`<div class="tw-pre">${ico('pin')} 置頂</div>`);
    if (t.retweeted_by) pre.push(`<div class="tw-pre">${ico('retweet')} <a href="#/user/${esc(t.retweeted_by.screen_name)}">${esc(t.retweeted_by.name)}</a> 已轉推</div>`);
    const focal = opts.focal;
    const s = t.stats || {};
    const hasMedia = (t.media || []).length > 0;
    return `<article class="tw${focal ? ' focal' : ''}${opts.threadLine ? ' thread-line' : ''}" data-id="${esc(t.id)}">
        ${pre.join('')}
        <div class="tw-row">
            <a class="tw-avatar" href="#/user/${esc(u.screen_name)}">${avatarHtml(u)}</a>
            <div class="tw-body">
                ${tweetHead(t, focal)}
                ${t.reply_to && !opts.inThread ? `<div class="muted tw-reply">回覆 <a href="#/user/${esc(t.reply_to)}">@${esc(t.reply_to)}</a></div>` : ''}
                ${t.text.length ? `<div class="tw-text${focal ? ' big' : ''}">${renderText(t.text)}</div>` : ''}
                ${renderMedia(t, reg)}
                ${t.article ? (focal && t.article.blocks ? renderArticleFull(t.article, reg, t) : renderArticleCard(t.article, t.id)) : ''}
                ${renderCard(t.card)}
                ${renderQuote(t.quote, reg)}
                ${focal && (s.retweet || s.quote) ? `<div class="tw-links">
                    ${s.retweet ? `<a href="#/tweet/${esc(t.id)}/retweets"><b>${fmtNum(s.retweet)}</b> 轉推</a>` : ''}
                    ${s.quote ? `<a href="#/tweet/${esc(t.id)}/quotes"><b>${fmtNum(s.quote)}</b> 引用</a>` : ''}
                </div>` : ''}
                <div class="tw-stats">
                    ${stat('reply', s.reply, '回覆')}
                    ${stat('retweet', s.retweet + (s.quote || 0), `轉推 ${fmtNum(s.retweet)}・引用 ${fmtNum(s.quote)}${t.retweeted ? '（你轉推過）' : ''}`, t.retweeted ? 'rt' : '')}
                    ${stat('heart', s.like, t.liked ? '喜歡（你按過讚）' : '喜歡', t.liked ? 'like' : '')}
                    ${stat('views', s.view, '觀看')}
                    ${stat('bookmark', s.bookmark, t.bookmarked ? '書籤（你加過書籤）' : '書籤', t.bookmarked ? 'bm' : '')}
                    <span class="spacer"></span>
                    ${hasMedia ? `<button class="icon tw-act" data-act="dl" title="下載這則的全部媒體">${ico('download')}</button>` : ''}
                    <button class="icon tw-act" data-act="copy" title="複製連結">${ico('link')}</button>
                    <a class="icon tw-act icon-link" href="https://x.com/${esc(u.screen_name)}/status/${esc(t.id)}" target="_blank" rel="noopener noreferrer" title="在 x.com 開啟">${ico('external')}</a>
                </div>
            </div>
        </div>
    </article>`;
}

function renderUserRow(u) {
    return `<div class="user-row" data-user="${esc(u.screen_name)}">
        ${avatarHtml(u)}
        <div class="c-body">
            <div class="c-title">${esc(u.name)}${verifiedIcon(u)}${lockIcon(u)}</div>
            <div class="muted small-text">@${esc(u.screen_name)}${u.follows_you ? ' <span class="c-tag">跟隨你</span>' : ''}</div>
            ${u.bio && u.bio.length ? `<div class="user-bio clamp">${renderText(u.bio)}</div>` : ''}
        </div>
    </div>`;
}

function renderProfile(p) {
    const joined = p.created_at ? `${new Date(p.created_at).getFullYear()}年${new Date(p.created_at).getMonth() + 1}月加入` : '';
    const tags = [];
    if (p.followed) tags.push('<span class="c-tag">追蹤中</span>');
    if (p.follows_you) tags.push('<span class="c-tag">跟隨你</span>');
    // Old-format banner URLs need a size appended; new-format ones may already have it
    const bannerUrl = p.banner && (/\/\d+x\d+$/.test(p.banner) || /\?/.test(p.banner) ? p.banner : `${p.banner}/1500x500`);
    const banner = bannerUrl ? `<img class="pf-banner-img" src="${esc(bannerUrl)}" alt="" onerror="this.remove()">` : '';
    return `<div class="profile">
        <div class="pf-banner">${banner}</div>
        <div class="pf-main">
            <span class="avatar pf-avatar" data-avatar="${esc(p.avatar_large)}">${p.avatar_large ? `<img src="${esc(p.avatar_large)}" alt="">` : ''}</span>
            <div class="pf-name"><b>${esc(p.name)}</b>${verifiedIcon(p)}${lockIcon(p)}</div>
            <div class="muted">@${esc(p.screen_name)} ${tags.join(' ')}</div>
            ${p.bio.length ? `<div class="pf-bio">${renderText(p.bio)}</div>` : ''}
            <div class="pf-meta muted">
                ${p.location ? `<span>${ico('home')} ${esc(p.location)}</span>` : ''}
                ${p.url ? `<span>${ico('link')} ${linkHtml(p.url.href, p.url.v)}</span>` : ''}
                ${joined ? `<span>${ico('calendar')} ${esc(joined)}</span>` : ''}
            </div>
            <div class="pf-counts">
                <span><b>${fmtNum(p.following_count)}</b> <span class="muted">追蹤中</span></span>
                <span><b>${fmtNum(p.followers)}</b> <span class="muted">跟隨者</span></span>
                <span><b>${fmtNum(p.tweets)}</b> <span class="muted">貼文</span></span>
                <span><b>${fmtNum(p.media_count)}</b> <span class="muted">媒體</span></span>
            </div>
        </div>
    </div>`;
}

function renderListHead(l) {
    return `<div class="profile list-head">
        <div class="pf-main">
            <div class="pf-name"><b>${esc(l.name)}</b>${l.private ? lockIcon({ protected: true }) : ''}</div>
            ${l.owner ? `<div class="muted">由 <a href="#/user/${esc(l.owner.screen_name)}">@${esc(l.owner.screen_name)}</a> 建立・${fmtNum(l.members)} 位成員</div>` : ''}
            ${l.description ? `<div class="pf-bio">${esc(l.description)}</div>` : ''}
        </div>
    </div>`;
}
