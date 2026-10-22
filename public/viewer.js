// Viewer: ← → to flip, Space slideshow, Z zoom, D download, Esc close; swipe on touch screens

const viewer = $('#viewer');
const vBody = $('#viewer-body');
let vIndex = 0;
let vTimer = null;

function openViewer(mi) {
    if (!state || !state.media[mi]) return;
    vIndex = mi;
    if (!viewer.open) viewer.showModal();
    showViewer();
}

function showViewer() {
    const list = state.media;
    const it = list[vIndex];
    if (!it) return;
    const { m, t } = it;
    vBody.classList.remove('zoomed');
    $('#viewer-zoom').classList.remove('on');
    vBody.innerHTML = '<span class="v-loading">載入中…</span>';
    let el;
    if (m.type === 'photo') {
        el = document.createElement('img');
        el.src = m.url;
        el.alt = m.alt || '';
        el.addEventListener('load', () => vBody.querySelector('.v-loading')?.remove(), { once: true });
        el.addEventListener('click', toggleZoom);
    } else {
        el = document.createElement('video');
        Object.assign(el, { src: m.url || '', controls: true, autoplay: true, playsInline: true, poster: m.preview, loop: m.type === 'gif' });
        if (m.type === 'gif') el.muted = true;
        el.addEventListener('loadeddata', () => vBody.querySelector('.v-loading')?.remove(), { once: true });
        // In a slideshow, wait for a video to finish before moving on
        el.addEventListener('ended', () => {
            if (vTimer) step(1);
        });
    }
    el.addEventListener('error', () => {
        const l = vBody.querySelector('.v-loading');
        if (l) l.textContent = '載入失敗';
    }, { once: true });
    vBody.appendChild(el);
    $('#viewer-count').textContent = `${vIndex + 1} / ${list.length}`;
    $('#viewer-name').textContent = t.user ? `@${t.user.screen_name}・${fmtTime(t.created_at)}` : '';
    $('#viewer-save').href = m.url || '#';
    const cap = plainText(t.text);
    $('#viewer-caption').textContent = cap;
    $('#viewer-caption').classList.toggle('hidden', !cap);
    $('#viewer-prev').disabled = vIndex === 0;
    $('#viewer-next').disabled = vIndex >= list.length - 1 && (state.done || state.loading);
    // Thumbnail strip at the bottom: 7 on each side
    const from = Math.max(0, vIndex - 7);
    const to = Math.min(list.length, vIndex + 8);
    $('#viewer-strip').innerHTML = list.slice(from, to).map((x, k) => `<img src="${esc(x.m.thumb)}" data-vi="${from + k}" class="${from + k === vIndex ? 'current' : ''}" alt="">`).join('');
    // Preload the next image
    const next = list[vIndex + 1];
    if (next && next.m.type === 'photo') new Image().src = next.m.url;
    // Load more when nearing the end
    if (vIndex >= list.length - 3 && !state.done) loadMore();
}

function step(d) {
    const n = vIndex + d;
    if (n < 0) return;
    if (n >= state.media.length) {
        if (!state.done) {
            loadMore();
            toast('載入更多中…');
        } else if (vTimer) stopSlides();
        return;
    }
    vIndex = n;
    showViewer();
}

function toggleZoom() {
    if (!vBody.querySelector('img')) return;
    vBody.classList.toggle('zoomed');
    $('#viewer-zoom').classList.toggle('on', vBody.classList.contains('zoomed'));
}

function stopSlides() {
    clearInterval(vTimer);
    vTimer = null;
    $('#viewer-play').classList.remove('on');
    $('#viewer-play').innerHTML = ico('play');
}
function toggleSlides() {
    if (vTimer) return stopSlides();
    $('#viewer-play').classList.add('on');
    $('#viewer-play').innerHTML = ico('pause');
    vTimer = setInterval(() => {
        // Don't advance while a video is playing
        const v = vBody.querySelector('video');
        if (v && !v.paused && !v.loop) return;
        step(1);
    }, 3500);
}

function viewerDownload() {
    const it = state.media[vIndex];
    if (!it) return;
    guard(download)([{ url: it.m.url, user: it.t.user && it.t.user.screen_name, tweetId: it.t.id, idx: it.i + 1, ext: it.m.ext }]);
}

$('#viewer-prev').addEventListener('click', () => step(-1));
$('#viewer-next').addEventListener('click', () => step(1));
$('#viewer-zoom').addEventListener('click', toggleZoom);
$('#viewer-play').addEventListener('click', toggleSlides);
$('#viewer-download').addEventListener('click', viewerDownload);
$('#viewer-close').addEventListener('click', () => viewer.close());
$('#viewer-goto').addEventListener('click', () => {
    const it = state.media[vIndex];
    viewer.close();
    if (it) location.hash = `#/tweet/${it.t.id}`;
});
$('#viewer-strip').addEventListener('click', (e) => {
    const img = e.target.closest('[data-vi]');
    if (!img) return;
    vIndex = Number(img.dataset.vi);
    showViewer();
});
vBody.addEventListener('click', (e) => {
    if (e.target === vBody) viewer.close();
});
viewer.addEventListener('close', () => {
    stopSlides();
    vBody.innerHTML = '';
});
viewer.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === ' ') toggleSlides();
    else if (e.key === 'z' || e.key === 'Z') toggleZoom();
    else if (e.key === 'd' || e.key === 'D') viewerDownload();
    else return;
    e.preventDefault();
});
// Mouse wheel flips images: down = next, up = previous. When zoomed or over the caption, the wheel scrolls as usual.
// A mouse wheel notch is large (about 100): one notch, one image; spin fast to flip several.
// A touchpad sends many small events (with inertia): one swipe flips one image; pause and swipe again for the next.
let wheelSum = 0;
let wheelLock = 0;
let gestureEnd = null;
let gestureUsed = false;
viewer.addEventListener('wheel', (e) => {
    if (vBody.classList.contains('zoomed') || e.target.closest('#viewer-caption')) return;
    e.preventDefault();
    const raw = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    // deltaMode 1 = lines (Firefox mouse wheels); convert to pixels
    const delta = e.deltaMode === 1 ? raw * 40 : raw;
    if (Math.abs(delta) >= 50) {
        // Mouse: one image per notch; only block events too close together (one notch split in two)
        if (Date.now() < wheelLock) return;
        wheelLock = Date.now() + 60;
        step(delta > 0 ? 1 : -1);
        return;
    }
    // Touchpad: a swipe ends after 150ms without events
    clearTimeout(gestureEnd);
    gestureEnd = setTimeout(() => {
        wheelSum = 0;
        gestureUsed = false;
    }, 150);
    if (gestureUsed) return;
    wheelSum += delta;
    if (Math.abs(wheelSum) < 50) return;
    step(wheelSum > 0 ? 1 : -1);
    gestureUsed = true;
}, { passive: false });

let touchX = null;
vBody.addEventListener('touchstart', (e) => {
    touchX = e.touches[0].clientX;
}, { passive: true });
vBody.addEventListener('touchend', (e) => {
    if (touchX == null || vBody.classList.contains('zoomed')) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
    touchX = null;
});
