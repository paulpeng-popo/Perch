// Multiple X accounts: each has its own cookies; remembers which one is active. Stored as accounts / active in settings.json.
const crypto = require('node:crypto');
const { getSetting, setSetting } = require('./store');

// Older versions stored a single auth_token / ct0: migrate it into the first account
(function migrate() {
    const auth = getSetting('auth_token');
    const ct0 = getSetting('ct0');
    if (auth && ct0 && !(getSetting('accounts') || []).length) {
        const key = crypto.randomUUID().slice(0, 8);
        setSetting('accounts', [{ key, auth_token: auth, ct0, user: null, added: new Date().toISOString() }]);
        setSetting('active', key);
    }
    if (getSetting('auth_token') !== null || getSetting('ct0') !== null) {
        setSetting('auth_token', null);
        setSetting('ct0', null);
    }
})();

const all = () => getSetting('accounts') || [];
const save = (list) => setSetting('accounts', list);

function active() {
    const list = all();
    return list.find((a) => a.key === getSetting('active')) || list[0] || null;
}

function get(key) {
    return all().find((a) => a.key === key) || null;
}

function add(authToken, ct0) {
    const list = all();
    // Don't add the same auth_token twice; just refresh its ct0
    const same = list.find((a) => a.auth_token === authToken);
    if (same) {
        same.ct0 = ct0;
        save(list);
        return same;
    }
    const acct = { key: crypto.randomUUID().slice(0, 8), auth_token: authToken, ct0, user: null, added: new Date().toISOString() };
    save([...list, acct]);
    return acct;
}

function update(key, patch) {
    const list = all();
    const a = list.find((x) => x.key === key);
    if (!a) return;
    Object.assign(a, patch);
    save(list);
}

function remove(key) {
    const list = all().filter((a) => a.key !== key);
    save(list);
    if (getSetting('active') === key) setSetting('active', list.length ? list[0].key : null);
}

function activate(key) {
    if (!get(key)) throw new Error('找不到這個帳號');
    setSetting('active', key);
}

// Version for the frontend: no cookies
const publicList = () => {
    const cur = active();
    return all().map((a) => ({ key: a.key, user: a.user, ok: a.ok !== false, active: !!cur && cur.key === a.key }));
};

module.exports = { all, active, get, add, update, remove, activate, publicList };
