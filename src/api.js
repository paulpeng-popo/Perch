// Browsing queries: build GraphQL variables, call, shape for the frontend. All read-only.
const x = require('./x');
const parse = require('./parse');
const accounts = require('./accounts');

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

module.exports = { viewer, resetViewer };
