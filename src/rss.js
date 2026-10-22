// Turn timelines into RSS 2.0. Results are cached for 10 minutes so frequent polling by readers doesn't eat X's rate limit.
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map(); // key -> { at, xml }

const xmlEsc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const htmlEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const plain = (segs) => (segs || []).map((s) => s.v).join('');

function textHtml(segs) {
    return (segs || []).map((s) => {
        if (s.t === 'url') return `<a href="${htmlEsc(s.href)}">${htmlEsc(s.v)}</a>`;
        if (s.t === 'mention') return `<a href="https://x.com/${htmlEsc(s.user)}">${htmlEsc(s.v)}</a>`;
        if (s.t === 'tag') return `<a href="https://x.com/search?q=${encodeURIComponent(s.q)}">${htmlEsc(s.v)}</a>`;
        return htmlEsc(s.v);
    }).join('').replace(/\n/g, '<br>');
}

function mediaHtml(t) {
    return (t.media || []).map((m) => {
        if (m.type === 'photo') return `<p><img src="${htmlEsc(m.url)}" alt="${htmlEsc(m.alt)}"></p>`;
        // Video: the poster image links to the mp4
        return `<p><a href="${htmlEsc(m.url || '')}"><img src="${htmlEsc(m.preview)}" alt="${m.type === 'gif' ? 'GIF' : '影片'}"></a></p>`;
    }).join('');
}

const link = (t) => `https://x.com/${t.user ? t.user.screen_name : 'i'}/status/${t.id}`;

function itemXml(t) {
    if (t.tombstone || !t.user) return '';
    const who = `@${t.user.screen_name}`;
    const prefix = t.retweeted_by ? `RT ${who}：` : (t.reply_to ? `回覆 @${t.reply_to}：` : '');
    const body = plain(t.text) || (t.article ? t.article.title : '') || ((t.media || []).length ? `（${t.media.length} 個媒體）` : '');
    const title = `${t.retweeted_by ? `@${t.retweeted_by.screen_name}` : who}：${prefix}${body}`.replace(/\s+/g, ' ').slice(0, 140);
    let html = '';
    if (t.retweeted_by) html += `<p>🔁 @${htmlEsc(t.retweeted_by.screen_name)} 轉推了 ${htmlEsc(t.user.name)}（${htmlEsc(who)}）</p>`;
    html += `<p>${textHtml(t.text)}</p>${mediaHtml(t)}`;
    if (t.article) {
        html += `<p><b>${htmlEsc(t.article.title)}</b></p>${t.article.cover ? `<p><img src="${htmlEsc(t.article.cover)}"></p>` : ''}<p>${htmlEsc(t.article.preview)}</p>`;
    }
    if (t.card && t.card.kind === 'link') html += `<p><a href="${htmlEsc(t.card.url)}">${htmlEsc(t.card.title)}</a></p>`;
    if (t.quote && !t.quote.tombstone && t.quote.user) {
        html += `<blockquote><p>${htmlEsc(t.quote.user.name)}（@${htmlEsc(t.quote.user.screen_name)}）</p><p>${textHtml(t.quote.text)}</p>${mediaHtml(t.quote)}<p><a href="${htmlEsc(link(t.quote))}">原推文</a></p></blockquote>`;
    }
    const date = t.created_at ? new Date(t.created_at).toUTCString() : new Date().toUTCString();
    return `<item>
    <title>${xmlEsc(title)}</title>
    <link>${xmlEsc(link(t))}</link>
    <guid isPermaLink="false">${xmlEsc(t.rt_id || t.id)}</guid>
    <pubDate>${date}</pubDate>
    <dc:creator>${xmlEsc(who)}</dc:creator>
    <description>${xmlEsc(html)}</description>
</item>`;
}

function feedXml({ title, link: home, description }, tweets) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
<title>${xmlEsc(title)}</title>
<link>${xmlEsc(home)}</link>
<description>${xmlEsc(description || title)}</description>
<lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${tweets.map(itemXml).filter(Boolean).join('\n')}
</channel>
</rss>
`;
}

// load() returns { meta, tweets }; the same URL within 10 minutes is served from cache
async function serve(key, load) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.xml;
    const { meta, tweets } = await load();
    const xml = feedXml(meta, tweets);
    cache.set(key, { at: Date.now(), xml });
    if (cache.size > 100) cache.delete(cache.keys().next().value);
    return xml;
}

const clear = () => cache.clear();

module.exports = { serve, clear };
