// Perch desktop app (Electron). The server runs inside this process; the window loads http://127.0.0.1:<port>.
// Portable by design: all data (settings, the built-in browser's cache and cookies, window position) lives in one folder; delete it and nothing is left.
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, Menu, dialog, ipcMain, session, shell } = require('electron');

// ---- Data folder: must be decided before app ready ----
function writable(dir) {
    try {
        fs.mkdirSync(dir, { recursive: true });
        fs.accessSync(dir, fs.constants.W_OK);
        return true;
    } catch {
        return false;
    }
}

function pickDataDir() {
    // In development (npm run app): share the project's data folder with the CLI version
    if (!app.isPackaged) return path.join(__dirname, '..', 'data');
    // A macOS .app can't write next to itself (it would break the signature): use the system location
    if (process.platform === 'darwin') return path.join(app.getPath('appData'), 'Perch');
    // Linux AppImage: the app itself is a read-only mount, so use a folder next to the AppImage file
    if (process.env.APPIMAGE) {
        const dir = path.join(path.dirname(process.env.APPIMAGE), 'Perch-data');
        if (writable(dir)) return dir;
    }
    // Unpacked Windows / Linux build: the data folder next to the executable
    const portable = path.join(path.dirname(process.execPath), 'data');
    if (writable(portable)) return portable;
    // Installed somewhere read-only (e.g. Program Files): fall back to the user's app data folder
    return path.join(app.getPath('appData'), 'Perch');
}

const DATA_DIR = pickDataDir();
const CHROMIUM_DIR = path.join(DATA_DIR, 'chromium');
fs.mkdirSync(CHROMIUM_DIR, { recursive: true });
process.env.PERCH_DATA_DIR = DATA_DIR;
// Redirect the built-in browser's (Chromium) cache, cookies, GPU cache and crash dumps here
app.setPath('userData', CHROMIUM_DIR);
app.setPath('sessionData', CHROMIUM_DIR);
app.setPath('crashDumps', path.join(CHROMIUM_DIR, 'Crashpad'));

// Single instance: opening it again brings the existing window to the front
if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    main();
}

// Strip Electron from the User-Agent so X's login page doesn't call the browser unsupported
const plainUA = () => app.userAgentFallback.replace(/\s(Electron|perch)\/\S+/gi, '');

function main() {
    // The real location of the system Downloads folder (may have been moved to another drive or OneDrive)
    try {
        process.env.PERCH_DOWNLOADS_DIR = app.getPath('downloads');
    } catch { /* if unavailable, use Downloads in the home folder */ }
    // Load the server only after PERCH_DATA_DIR is set
    const server = require('../src/server');
    const downloader = require('../src/downloader');
    let win = null;
    let origin = '';

    // ---- Window position ----
    const WIN_FILE = path.join(DATA_DIR, 'window.json');
    const loadBounds = () => {
        try {
            return JSON.parse(fs.readFileSync(WIN_FILE, 'utf8'));
        } catch {
            return { width: 1280, height: 860 };
        }
    };
    const saveBounds = () => {
        if (!win || win.isDestroyed()) return;
        const b = { ...win.getNormalBounds(), maximized: win.isMaximized() };
        try {
            fs.writeFileSync(WIN_FILE, `${JSON.stringify(b, null, 4)}\n`);
        } catch { /* can't write it: never mind */ }
    };

    const isApp = (url) => url.startsWith(`${origin}/`) || url === origin;
    const openOutside = (url) => {
        if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    };

    function guard(w) {
        // New windows: Perch's own pages (Ctrl+click) open a new app window; everything else goes to the system browser
        w.webContents.setWindowOpenHandler(({ url }) => {
            if (isApp(url)) return { action: 'allow', overrideBrowserWindowOptions: windowOptions() };
            openOutside(url);
            return { action: 'deny' };
        });
        // Don't let the app window navigate to outside sites
        w.webContents.on('will-navigate', (e, url) => {
            if (!isApp(url)) {
                e.preventDefault();
                openOutside(url);
            }
        });
        // F12 / Ctrl+Shift+I open DevTools (for debugging)
        w.webContents.on('before-input-event', (e, input) => {
            if (input.type === 'keyDown' && (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'))) {
                w.webContents.toggleDevTools();
            }
        });
        // Windows opened from this one (Ctrl+click) get the same rules; the login window is not opened from here, so it is unaffected
        w.webContents.on('did-create-window', (child) => guard(child));
    }

    function windowOptions() {
        return {
            backgroundColor: '#0f1216',
            autoHideMenuBar: true,
            icon: path.join(__dirname, '..', 'build', 'icon.png'),
            webPreferences: {
                preload: path.join(__dirname, 'preload.js'),
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
            },
        };
    }

    async function createWindow() {
        const { url } = await server.start({ fallback: true });
        origin = url;
        const b = loadBounds();
        win = new BrowserWindow({ ...windowOptions(), x: b.x, y: b.y, width: b.width || 1280, height: b.height || 860, show: false });
        if (b.maximized) win.maximize();
        guard(win);
        win.once('ready-to-show', () => win.show());
        win.on('close', saveBounds);
        win.on('closed', () => {
            win = null;
        });
        await win.loadURL(url);
    }

    // ---- Log in to X inside the app ----
    // Uses a temporary in-memory session (partition name without persist:) that is thrown away after login.
    // Since we never log out on x.com, the cookies we get stay valid.
    let loginBusy = false;
    ipcMain.handle('login-x', async () => {
        if (loginBusy) return { error: '登入視窗已經開著了' };
        loginBusy = true;
        const ses = session.fromPartition(`xlogin-${Date.now()}`);
        ses.setUserAgent(plainUA());
        const lw = new BrowserWindow({
            parent: win || undefined,
            modal: false,
            width: 520,
            height: 760,
            title: '登入 X',
            autoHideMenuBar: true,
            backgroundColor: '#000000',
            webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false, sandbox: true },
        });
        // Links to other sites inside the login window open in the system browser
        lw.webContents.setWindowOpenHandler(({ url }) => {
            openOutside(url);
            return { action: 'deny' };
        });
        const getCookie = async (name) => {
            const list = await ses.cookies.get({ name });
            const c = list.find((x) => /(^|\.)x\.com$/.test(x.domain.replace(/^\./, '')) || /twitter\.com$/.test(x.domain));
            return c ? c.value : null;
        };
        try {
            const result = await new Promise((resolve) => {
                let done = false;
                const finish = (r) => {
                    if (done) return;
                    done = true;
                    clearInterval(timer);
                    resolve(r);
                };
                lw.on('closed', () => finish({ cancelled: true }));
                const timer = setInterval(async () => {
                    const auth = await getCookie('auth_token');
                    if (!auth) return;
                    clearInterval(timer);
                    // X rotates ct0 right after login; wait for that before reading it
                    await new Promise((r) => setTimeout(r, 2000));
                    const ct0 = await getCookie('ct0');
                    if (!ct0) return finish({ error: '登入成功但拿不到 ct0，請再試一次' });
                    try {
                        finish(await server.addAccount(auth, ct0));
                    } catch (e) {
                        finish({ error: e.message });
                    }
                }, 1000);
                lw.loadURL('https://x.com/i/flow/login');
            });
            return result;
        } finally {
            loginBusy = false;
            if (!lw.isDestroyed()) lw.close();
            ses.clearStorageData().catch(() => {});
        }
    });

    ipcMain.handle('pick-folder', async () => {
        const r = await dialog.showOpenDialog(win, { title: '選擇下載資料夾', properties: ['openDirectory', 'createDirectory'] });
        return r.canceled ? null : r.filePaths[0];
    });
    ipcMain.handle('open-downloads', async () => {
        const dir = downloader.root();
        fs.mkdirSync(dir, { recursive: true });
        const err = await shell.openPath(dir);
        return err ? { error: err } : { ok: true };
    });
    ipcMain.handle('open-data', async () => {
        const err = await shell.openPath(DATA_DIR);
        return err ? { error: err } : { ok: true };
    });
    ipcMain.handle('app-info', () => ({ version: app.getVersion(), dataDir: DATA_DIR, platform: process.platform }));

    app.on('second-instance', () => {
        if (!win) return;
        if (win.isMinimized()) win.restore();
        win.focus();
    });

    app.whenReady().then(() => {
        // macOS needs a menu (for copy/paste and Cmd+Q); Windows / Linux show no menu bar
        if (process.platform === 'darwin') {
            Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]));
        } else {
            Menu.setApplicationMenu(null);
        }
        session.defaultSession.setUserAgent(plainUA());
        createWindow().catch((e) => {
            dialog.showErrorBox('Perch 無法啟動', String(e && e.stack ? e.stack : e));
            app.quit();
        });
    });

    app.on('window-all-closed', () => app.quit());
}
