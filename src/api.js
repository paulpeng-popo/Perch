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
    }, cursor));
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

module.exports = { viewer, resetViewer, userByName, home, userTimeline, thread, retweeters, quotes, search, bookmarks };
