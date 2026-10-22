// Browsing queries: build GraphQL variables, call, shape for the frontend. All read-only.
const x = require('./x');
const parse = require('./parse');
const accounts = require('./accounts');

const PAGE = 20;
const viewerCache = {}; // account key -> profile

// Who is logged in for an account (defaults to the active account)
async function viewer(refresh = false, account = null) {
    const a = account || accounts.active();
    if (a && viewerCache[a.key] && !refresh) return viewerCache[a.key];
    const d = await x.gql('Viewer', { withCommunitiesMemberships: true }, { account: a });
    const u = parse.profile(d.viewer && d.viewer.user_results);
    if (!u) throw new Error('讀不到登入的帳號，cookie 可能已失效');
    if (a) viewerCache[a.key] = u;
    return u;
}
const resetViewer = (key) => {
    if (key) delete viewerCache[key];
    else for (const k of Object.keys(viewerCache)) delete viewerCache[k];
};

async function userByName(screenName) {
    const d = await x.gql('UserByScreenName', { screen_name: String(screenName).replace(/^@/, ''), withGrokTranslatedBio: false });
    const u = parse.profile(d.user);
    if (!u) throw new Error(`找不到使用者 @${screenName}`);
    return u;
}

const withCursor = (vars, cursor) => (cursor ? { ...vars, cursor } : vars);

async function home(kind, cursor) {
    const latest = kind !== 'foryou';
    const vars = {
        count: PAGE,
        includePromotedContent: true,
        latestControlAvailable: true,
        requestContext: cursor ? undefined : 'launch',
        withCommunity: true,
        seenTweetIds: [],
    };
    if (!vars.requestContext) delete vars.requestContext;
    return parse.timeline(await x.gql(latest ? 'HomeLatestTimeline' : 'HomeTimeline', withCursor(vars, cursor)));
}

const USER_TABS = {
    tweets: ['UserTweets', { includePromotedContent: true, withQuickPromoteEligibilityTweetFields: true, withVoice: true }],
    replies: ['UserTweetsAndReplies', { includePromotedContent: true, withCommunity: true, withVoice: true }],
    media: ['UserMedia', { includePromotedContent: false, withClientEventToken: false, withBirdwatchNotes: false, withVoice: true }],
    likes: ['Likes', { includePromotedContent: false, withClientEventToken: false, withBirdwatchNotes: false, withVoice: true }],
};

async function userTimeline(userId, tab, cursor) {
    const [op, extra] = USER_TABS[tab] || USER_TABS.tweets;
    return parse.timeline(await x.gql(op, withCursor({ userId: String(userId), count: PAGE, ...extra }, cursor)));
}

async function thread(id, cursor) {
    const d = await x.gql('TweetDetail', withCursor({
        focalTweetId: String(id),
        with_rux_injections: false,
        rankingMode: 'Relevance',
        includePromotedContent: true,
        withCommunity: true,
        withQuickPromoteEligibilityTweetFields: true,
        withBirdwatchNotes: true,
        withVoice: true,
    }, cursor), { toggles: { withArticleRichContentState: true, withArticlePlainText: true } }); // full long-form article content
    return parse.timeline(d);
}

// People who reposted this post
async function retweeters(id, cursor) {
    return parse.timeline(await x.gql('Retweeters', withCursor({ tweetId: String(id), count: 20, includePromotedContent: true }, cursor)));
}

// Posts quoting this one: via search quoted_tweet_id:
async function quotes(id, cursor) {
    return search(`quoted_tweet_id:${String(id).replace(/\D/g, '')}`, 'latest', cursor);
}

// Several people at once: search (from:a OR from:b …), newest first
const cleanNames = (users) => [...new Set(String(users || '').split(/[\s,，]+/).map((u) => u.replace(/^@/, '')).filter((u) => /^\w{1,15}$/.test(u)))];
async function multi(users, media, cursor) {
    const names = cleanNames(users);
    // code: 'USER' = bad input, the server needn't print a stack trace
    if (!names.length) throw Object.assign(new Error('請至少輸入一個帳號'), { code: 'USER' });
    if (names.length > 25) throw Object.assign(new Error('一次最多 25 個帳號（X 的搜尋字數有上限）'), { code: 'USER' });
    const q = `(${names.map((n) => `from:${n}`).join(' OR ')})${media ? ' filter:media' : ''} include:nativeretweets`;
    return search(q, 'latest', cursor);
}

const SEARCH_PRODUCTS = { latest: 'Latest', top: 'Top', media: 'Media', people: 'People' };
async function search(q, product, cursor) {
    const d = await x.gql('SearchTimeline', withCursor({
        rawQuery: String(q),
        count: PAGE,
        querySource: 'typed_query',
        product: SEARCH_PRODUCTS[product] || 'Latest',
        withGrokTranslatedBio: false,
    }, cursor));
    return parse.timeline(d);
}

async function bookmarks(cursor) {
    return parse.timeline(await x.gql('Bookmarks', withCursor({ count: PAGE, includePromotedContent: true }, cursor)));
}

async function following(cursor) {
    const me = await viewer();
    const d = await x.gql('Following', withCursor({ userId: me.id, count: 100, includePromotedContent: false, withGrokTranslatedBio: false }, cursor));
    return parse.timeline(d);
}

async function lists() {
    const d = await x.gql('ListsManagementPageTimeline', { count: 100 });
    const t = parse.timeline(d);
    // The same list can appear under both "pinned" and "your lists"
    const seen = new Set();
    return t.lists.filter((l) => l.id && !seen.has(l.id) && seen.add(l.id));
}

async function listInfo(id) {
    const d = await x.gql('ListByRestId', { listId: String(id) });
    const l = d.list || {};
    return { id: l.id_str || String(id), name: l.name || '', description: l.description || '', members: l.member_count || 0, private: l.mode === 'Private', owner: parse.user(l.user_results) };
}

async function listTimeline(id, cursor) {
    return parse.timeline(await x.gql('ListLatestTweetsTimeline', withCursor({ listId: String(id), count: PAGE }, cursor)));
}

module.exports = { viewer, resetViewer, userByName, home, userTimeline, thread, retweeters, quotes, multi, cleanNames, search, bookmarks, following, lists, listInfo, listTimeline };
