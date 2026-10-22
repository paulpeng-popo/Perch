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

module.exports = { viewer, resetViewer, home };
