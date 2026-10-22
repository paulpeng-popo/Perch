// HTML for users. All content goes through esc().

function avatarHtml(u, cls = '') {
    if (!u) return `<span class="avatar ${cls}"></span>`;
    const letter = esc(Array.from(u.name || u.screen_name || '?')[0] || '?');
    return `<span class="avatar ${cls}">${letter}${u.avatar ? `<img src="${esc(u.avatar)}" loading="lazy" alt="" onerror="this.remove()">` : ''}</span>`;
}
