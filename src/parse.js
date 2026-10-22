// Turn X GraphQL responses into frontend-friendly shapes (posts, users, lists, cursors)

const decode = (s) => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// Split text into segments: plain text, links, @mentions, #hashtags.
// X's indices don't agree with how HTML entities are counted, so instead of indices we search the strings in order.
function segments(text, entities = {}, range = null) {
    // display_text_range drops the auto-added leading @reply targets and the trailing media link
    // X's ranges count characters after decoding &amp;
    const all = Array.from(decode(text));
    const [from, to] = range || [0, all.length];
    const raw = all.slice(from, to).join('');
    const marks = [];
    const add = (list, kind) => (list || []).forEach((e) => marks.push({ ...e, kind, start: e.indices ? e.indices[0] : 0 }));
    add(entities.urls, 'url');
    add(entities.user_mentions, 'mention');
    add(entities.hashtags, 'tag');
    add(entities.symbols, 'cashtag');
    add(entities.media, 'media');
    marks.sort((a, b) => a.start - b.start);

    const out = [];
    let pos = 0;
    const pushText = (s) => {
        if (!s) return;
        const v = s;
        const last = out[out.length - 1];
        if (last && last.t === 'text') last.v += v;
        else out.push({ t: 'text', v });
    };
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const e of marks) {
        let re;
        if (e.kind === 'url' || e.kind === 'media') re = new RegExp(esc(e.url || ''), 'g');
        else if (e.kind === 'mention') re = new RegExp(`[@＠]${esc(e.screen_name || '')}`, 'gi');
        else if (e.kind === 'tag') re = new RegExp(`[#＃]${esc(e.text || '')}`, 'g');
        else re = new RegExp(`\\$${esc(e.text || '')}`, 'g');
        re.lastIndex = pos;
        const m = re.exec(raw);
        if (!m || (e.kind !== 'media' && !m[0].slice(1))) continue;
        pushText(raw.slice(pos, m.index));
        pos = m.index + m[0].length;
        if (e.kind === 'media') continue; // don't show the media's t.co link
        if (e.kind === 'url') out.push({ t: 'url', v: e.display_url || e.expanded_url || e.url, href: e.expanded_url || e.url });
        else if (e.kind === 'mention') out.push({ t: 'mention', v: m[0], user: e.screen_name });
        else out.push({ t: 'tag', v: m[0], q: m[0].replace(/^＃/, '#').replace(/^\$/, '$') });
    }
    pushText(raw.slice(pos));
    // Trim trailing whitespace (often left after removing the media link)
    const last = out[out.length - 1];
    if (last && last.t === 'text') {
        last.v = last.v.replace(/\s+$/, '');
        if (!last.v) out.pop();
    }
    return out;
}

// Plain text without entities: find URLs, @handles and #hashtags ourselves
function linkify(text) {
    const out = [];
    const re = /(https?:\/\/[^\s<>"]+)|([@＠]\w{1,15})|([#＃][^\s#＃@＠.,，。!！?？]+)/g;
    let pos = 0;
    let m;
    const raw = decode(text);
    while ((m = re.exec(raw))) {
        if (m.index > pos) out.push({ t: 'text', v: raw.slice(pos, m.index) });
        if (m[1]) out.push({ t: 'url', v: m[1].replace(/^https?:\/\//, ''), href: m[1] });
        else if (m[2]) out.push({ t: 'mention', v: m[2], user: m[2].slice(1) });
        else out.push({ t: 'tag', v: m[3], q: m[3].replace(/^＃/, '#') });
        pos = m.index + m[0].length;
    }
    if (pos < raw.length) out.push({ t: 'text', v: raw.slice(pos) });
    return out;
}

function user(u) {
    if (!u) return null;
    if (u.result) u = u.result;
    if (u.__typename === 'UserUnavailable' || !u.rest_id) return null;
    const l = u.legacy || {};
    const c = u.core || {};
    const avatar = (u.avatar && u.avatar.image_url) || l.profile_image_url_https || '';
    return {
        id: u.rest_id,
        name: c.name ?? l.name ?? '',
        screen_name: c.screen_name ?? l.screen_name ?? '',
        avatar: avatar.replace(/_normal(\.\w+)$/, '_bigger$1'),
        verified: !!(u.is_blue_verified || l.verified || (u.verification && u.verification.verified)),
        protected: !!((u.privacy && u.privacy.protected) ?? l.protected),
    };
}

function profile(u) {
    if (u && u.result) u = u.result;
    const base = user(u);
    if (!base) return null;
    // Since 2026 X uses a new profile format (no legacy; counts in relationship_counts / tweet_counts); both are supported
    const l = u.legacy || {};
    const c = u.core || {};
    const rc = u.relationship_counts || {};
    const tc = u.tweet_counts || {};
    const rp = u.relationship_perspectives || {};
    const bioObj = u.profile_bio || {};
    const desc = (l.entities && l.entities.description) || bioObj.entities || null;
    const bioText = l.description || bioObj.description || '';
    const link = l.entities && l.entities.url && l.entities.url.urls && l.entities.url.urls[0];
    const site = u.website && u.website.url;
    const pinned = l.pinned_tweet_ids_str
        || (Array.isArray(u.pinned_items) ? u.pinned_items.map((p) => (typeof p === 'string' ? p : p && (p.rest_id || p.tweet_id || p.id))).filter(Boolean) : []);
    return {
        ...base,
        avatar_large: base.avatar.replace(/_bigger(\.\w+)$/, '_400x400$1'),
        // The new-format bio has no entities: find URLs ourselves and turn them into links
        bio: desc ? segments(bioText, desc) : linkify(bioText),
        location: (u.location && u.location.location) ?? l.location ?? '',
        url: link ? { v: link.display_url || link.expanded_url, href: link.expanded_url || link.url } : (site ? { v: site.replace(/^https?:\/\//, ''), href: site } : null),
        banner: l.profile_banner_url || (u.banner && u.banner.image_url) || null,
        followers: rc.followers ?? l.followers_count ?? 0,
        following_count: rc.following ?? l.friends_count ?? 0,
        tweets: tc.tweets ?? l.statuses_count ?? 0,
        media_count: tc.media_tweets ?? l.media_count ?? 0,
        created_at: toIso(c.created_at ?? l.created_at),
        followed: !!(rp.following ?? l.following),
        follows_you: !!(rp.followed_by ?? l.followed_by),
        pinned,
    };
}

function toIso(s) {
    if (!s) return null;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function media(m) {
    const base = m.media_url_https || '';
    const dot = base.lastIndexOf('.');
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot + 1) : 'jpg';
    const thumb = (size) => `${stem}?format=${ext === 'png' ? 'png' : 'jpg'}&name=${size}`;
    const info = m.original_info || {};
    const out = {
        key: m.media_key || m.id_str,
        type: m.type === 'animated_gif' ? 'gif' : m.type, // photo / video / gif
        thumb: thumb('small'),
        preview: thumb('medium'),
        w: info.width || (m.sizes && m.sizes.large && m.sizes.large.w) || 0,
        h: info.height || (m.sizes && m.sizes.large && m.sizes.large.h) || 0,
        alt: m.ext_alt_text || '',
        sensitive: !!(m.sensitive_media_warning),
    };
    if (m.type === 'photo') {
        out.url = `${stem}?format=${ext}&name=orig`;
        out.ext = ext;
    } else {
        const variants = ((m.video_info && m.video_info.variants) || []).filter((v) => v.content_type === 'video/mp4');
        variants.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
        out.url = variants.length ? variants[0].url : null;
        out.ext = 'mp4';
        out.duration = m.video_info && m.video_info.duration_millis ? Math.round(m.video_info.duration_millis / 1000) : 0;
    }
    return out;
}

function card(c) {
    const l = c && (c.legacy || c);
    if (!l || !Array.isArray(l.binding_values)) return null;
    const v = Object.fromEntries(l.binding_values.map((b) => [b.key, b.value]));
    const str = (k) => (v[k] && v[k].string_value) || '';
    const img = (k) => (v[k] && v[k].image_value && v[k].image_value.url) || '';
    const name = l.name || '';
    if (/poll\dchoice/.test(name)) {
        const n = Number(name.match(/poll(\d)/)[1]);
        const choices = [];
        for (let i = 1; i <= n; i++) choices.push({ label: str(`choice${i}_label`), count: Number(str(`choice${i}_count`)) || 0 });
        return { kind: 'poll', choices, ends: str('end_datetime_utc'), final: str('counts_are_final') === 'true' };
    }
    const title = str('title');
    if (!title) return null;
    return {
        kind: 'link',
        title,
        description: str('description'),
        domain: str('vanity_url') || str('domain'),
        url: str('card_url') || l.url || '',
        image: img('summary_photo_image_large') || img('thumbnail_image_large') || img('photo_image_full_size_large') || img('player_image_large') || img('summary_photo_image') || img('thumbnail_image') || '',
    };
}

function unwrap(r) {
    if (!r) return null;
    if (r.result) r = r.result;
    if (r.__typename === 'TweetWithVisibilityResults' && r.tweet) r = r.tweet;
    return r;
}

function tweet(r, depth = 0) {
    r = unwrap(r);
    if (!r) return null;
    if (r.__typename === 'TweetTombstone' || r.__typename === 'TweetUnavailable' || !r.legacy) {
        const text = r.tombstone && r.tombstone.text && r.tombstone.text.text;
        return { id: r.rest_id || null, tombstone: text || '這則推文無法顯示' };
    }
    const l = r.legacy;
    const author = user(r.core && r.core.user_results);
    const rtInner = l.retweeted_status_result && unwrap(l.retweeted_status_result);
    if (rtInner && depth === 0) {
        const inner = tweet(rtInner, 0);
        if (inner && !inner.tombstone) return { ...inner, retweeted_by: author, rt_id: r.rest_id };
    }
    const note = r.note_tweet && r.note_tweet.note_tweet_results && r.note_tweet.note_tweet_results.result;
    const text = note
        ? segments(note.text, note.entity_set || {})
        : segments(l.full_text, l.entities, l.display_text_range);
    const mediaList = ((l.extended_entities && l.extended_entities.media) || (l.entities && l.entities.media) || []).map(media);
    const quoted = depth === 0 && r.quoted_status_result ? tweet(r.quoted_status_result, 1) : null;
    // The quoted post is shown separately, so drop the quote link at the end of the text
    const qLink = l.quoted_status_permalink && l.quoted_status_permalink.expanded;
    const shown = text.filter((s) => !(s.t === 'url' && quoted && qLink && s.href === qLink));
    return {
        id: r.rest_id,
        user: author,
        created_at: toIso(l.created_at),
        text: shown,
        lang: l.lang,
        media: mediaList,
        card: card(r.card),
        quote: quoted,
        reply_to: l.in_reply_to_screen_name || null,
        reply_to_id: l.in_reply_to_status_id_str || null,
        conversation_id: l.conversation_id_str || r.rest_id,
        sensitive: !!l.possibly_sensitive,
        stats: {
            reply: l.reply_count || 0,
            retweet: l.retweet_count || 0,
            quote: l.quote_count || 0,
            like: l.favorite_count || 0,
            bookmark: l.bookmark_count || 0,
            view: r.views && r.views.count ? Number(r.views.count) : null,
        },
        liked: !!l.favorited,
        retweeted: !!l.retweeted,
        bookmarked: !!l.bookmarked,
    };
}

// Recursively find the instructions array in a response
function findInstructions(o, depth = 0) {
    if (!o || typeof o !== 'object' || depth > 8) return null;
    if (Array.isArray(o.instructions)) return o.instructions;
    for (const v of Object.values(o)) {
        const r = findInstructions(v, depth + 1);
        if (r) return r;
    }
    return null;
}

function timeline(data) {
    const out = { tweets: [], users: [], lists: [], cursor: null, top: null };
    const seen = new Set();
    const handleItem = (ic, entryId, extra = {}) => {
        if (!ic) return;
        const type = ic.itemType || ic.__typename;
        if (type === 'TimelineTweet') {
            if (ic.promotedMetadata || /^promoted|promoted-tweet/.test(entryId || '')) return; // ad
            const t = tweet(ic.tweet_results);
            if (!t) return;
            const key = t.rt_id || t.id;
            if (key && seen.has(key)) return;
            if (key) seen.add(key);
            out.tweets.push({ ...t, ...extra });
        } else if (type === 'TimelineUser') {
            const u = profile(ic.user_results);
            if (u) out.users.push(u);
        } else if (type === 'TimelineTwitterList') {
            const li = ic.list;
            if (li) {
                out.lists.push({
                    id: li.id_str || li.id_string,
                    name: li.name,
                    description: li.description || '',
                    members: li.member_count || 0,
                    private: li.mode === 'Private',
                    owner: user(li.user_results),
                    banner: (li.custom_banner_media || li.default_banner_media || {}).media_info?.original_img_url || '',
                });
            }
        } else if (type === 'TimelineTimelineCursor') {
            if (ic.cursorType === 'Bottom' || ic.cursorType === 'ShowMore' || ic.cursorType === 'ShowMoreThreads') out.cursor = out.cursor || ic.value;
            if (ic.cursorType === 'Top') out.top = ic.value;
        }
    };
    const handleEntry = (e) => {
        if (!e || !e.content) return;
        const c = e.content;
        const type = c.entryType || c.__typename;
        if (type === 'TimelineTimelineItem') handleItem(c.itemContent, e.entryId);
        else if (type === 'TimelineTimelineModule') {
            // Skip "who to follow" and similar modules; keep conversation threads, media grids and lists
            if (/who-to-follow|who-to-subscribe|tweetdetailrelatedtweets|trends|explore-|cursor-showmore/.test(e.entryId || '')) return;
            const group = /conversationthread|homeConversation|profile-conversation/.test(e.entryId || '') ? e.entryId : null;
            (c.items || []).forEach((it) => handleItem(it.item && it.item.itemContent, it.entryId, group ? { group } : {}));
        } else if (type === 'TimelineTimelineCursor') {
            if (c.cursorType === 'Bottom') out.cursor = c.value;
            if (c.cursorType === 'Top') out.top = c.value;
        }
    };
    for (const ins of findInstructions(data) || []) {
        const type = ins.type || ins.__typename;
        if (type === 'TimelineAddEntries') (ins.entries || []).forEach(handleEntry);
        else if (type === 'TimelinePinEntry' && ins.entry) {
            const before = out.tweets.length;
            handleEntry(ins.entry);
            for (let i = before; i < out.tweets.length; i++) out.tweets[i].pinned = true;
        } else if (type === 'TimelineReplaceEntry' && ins.entry) handleEntry(ins.entry);
        else if (type === 'TimelineAddToModule') (ins.moduleItems || []).forEach((it) => handleItem(it.item && it.item.itemContent, it.entryId));
    }
    // Pinned posts first
    out.tweets.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    return out;
}

module.exports = { tweet, user, profile, timeline, segments };
