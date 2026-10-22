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

module.exports = { viewer, resetViewer, userByName, home, userTimeline };
