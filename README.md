# Perch

**English** ｜ [繁體中文](README.zh-TW.md)

A desktop app for browsing X (Twitter) with your own account — look, don't touch: it never likes, reposts, follows, or marks anything as read. Save the images and videos you like in original quality with one click, but please respect the creators' copyright.

> ⚠️ Built on X's web API. This may violate X's Terms of Service, and browsing too aggressively can get your account rate-limited or locked. Use at your own risk.

The interface is in Traditional Chinese.

## Features

- Following, For you, Bookmarks, Lists, profiles, threads, search
- Multi-user timelines: read several accounts' posts together
- Media wall and viewer, one-click download of original images and videos
- Multiple accounts, RSS feeds, dark/light theme

## Download

Get the version for your system from [Releases](../../releases), unzip it (on Mac, open the dmg) and run it — no installation needed.

If you get a security warning the first time: on Windows click "More info" → "Run anyway"; on Mac right-click Perch → "Open".

## Getting started

Open Perch → Settings (設定) → Log in to X (登入 X), sign in, and you're ready.

To remove Perch, just delete its folder — nothing else is left on your computer.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `j` / `k` | Next / previous post |
| `g` | Toggle the media wall |
| `s` | Multi-select download (`Esc` to cancel) |
| `r` | Refresh |
| `Ctrl` + `K` | Jump to the search box |
| `←` `→` or wheel | Flip images in the viewer |
| Space | Slideshow in the viewer |
| `Z` | Zoom in the viewer |
| `D` | Download the current image in the viewer |

## Running from source

Requires Node.js 20 or newer.

```
npm install
npm run app      # desktop app
npm start        # or open it in your browser
npm run dist     # package
```

## License

[MIT](LICENSE)
