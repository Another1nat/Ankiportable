<div align="center">

# 📚 Ankiportable

**A free, offline, zero-install `.apkg` file reader and Anki-compatible flashcard study app that runs entirely in your browser.**

Open an `.apkg`. Study. That's it — no account, no sync server, no install.

### 🌐 **Live site → [another1nat.github.io/Ankiportable](https://another1nat.github.io/Ankiportable/)**

[📱 Install on iPhone](#-install-on-your-phone) · [🤖 Install on Android](#-install-on-your-phone) · [💻 Run locally](#-run-it-locally) · [☁️ Deploy your own](#-deploy)

</div>

---

## ✨ What it is

**Ankiportable is a browser-based `.apkg` file reader and free Anki alternative** that gives you the full flashcard study loop — card rendering, images, audio, spaced repetition, persistent progress — with **no install, no account, no sync server, no admin rights, and zero cost**. Everything is HTML + JS + WASM in a single folder. Drop it on your desktop, host it on GitHub Pages, install it on your phone's home screen as a PWA. It just works — on iPhone, Android, Windows, Mac, and Linux.

> 🎯 **Why it exists:** the official Anki apps require installation, and the iOS app costs $25. Ankiportable is the free, portable, install-free escape hatch: any `.apkg` file + any browser = you're studying spaced repetition flashcards in seconds.

**Keywords:** open Anki apkg online · free apkg file reader · Anki without install · Anki iPhone free · Anki web app · browser flashcards · offline spaced repetition · Anki PWA

---

## 🚀 Features

### 📖 Study
- 🃏 **Reads any `.apkg`** — Basic, Basic+reverse, and Cloze note types, including modern `collection.anki21b` (zstd) format
- 🖼️ **Images + 🔊 audio + 🎨 per-note-type CSS** all rendered faithfully
- 🧠 **SM-2 spaced repetition** with learning steps and lapse relearn
- ⌨️ **Full keyboard controls** — Space to flip, 1–4 to grade, R to replay, C to color, Z to undo, Esc to end
- 📱 **Swipe gestures** on mobile — swipe up to flip, then ← Again · → Good · ↓ Hard · ↑ Easy
- ↶ **Undo last grade** — because everyone hits the wrong button eventually
- 🎚️ **Session scrubber slider** — drag to jump to any card in the queue (something Anki proper doesn't have). Close the tab mid-session and the app auto-resumes at the same card next time you open the deck.
- ⏱️ **Session timer** with optional auto-end after N minutes
- 🎯 **Configurable daily new-card cap**

### 🗂️ Organize
- 📁 **Folders** — group decks by topic, drag decks between them
- 🎨 **Color coding** — tag decks *and* individual cards with 7 colors (topics, difficulty, whatever you want)
- 🔍 **Deck search + live filter** by folder and color
- 🔀 **Sort** by name / date added / card count / last studied / due count — or drag-to-reorder manually
- ✎ **Pencil per card** in study to mark cards for later review

### 💾 Data
- 🗄️ **Everything persists locally** in IndexedDB — close the tab, come back a week later, right where you were
- ⬇️ **Export progress** as JSON — every card's SR state + folders + colors
- ⬆️ **Restore progress** from a JSON backup
- 🔥 **Streaks + daily review stats** across all decks

### 📱 Mobile & PWA
- 🏠 **Add to Home Screen** on iPhone and Android → runs fullscreen like a native app
- 📴 **Fully offline** after first load (service worker caches the app shell)
- 👆 **Big touch targets** (≥44 px) throughout
- 📐 **Safe-area insets** for notched iPhones

### 🎧 UX polish
- 🔉 **Audio auto-play control** — answer side only (default), both sides, or off
- 🎉 **Session summary toast** — reviewed count, correct %, time, and A/H/G/E breakdown
- 📜 **Compact study header** collapses when you scroll on small screens
- 🌙 **Dark theme** tuned for long study sessions

---

## 📱 Install on your phone

Once the site is live at [`another1nat.github.io/Ankiportable`](https://another1nat.github.io/Ankiportable/):

### 🍎 iPhone (Safari)
1. Open the URL in **Safari** (not Chrome — iOS PWA install only works in Safari).
2. Tap the **Share** button (square with ↑).
3. Scroll and tap **Add to Home Screen** → **Add**.
4. Launch it from the home screen — fullscreen, offline-capable.

### 🤖 Android (Chrome / Edge)
1. Open the URL in **Chrome** or **Edge**.
2. Tap the **⋮** menu.
3. Tap **Install app** (or **Add to Home screen**).
4. Launch from the app drawer — real app icon, standalone window.

> 💡 **Progress lives in the browser's IndexedDB per origin.** So the phone install and your laptop's install are independent profiles. Use **Export / Restore Progress** to move between them.

---

## 💻 Run it locally

### The zero-effort way
Double-click `index.html`. It opens in your default browser via `file://`. SQLite WASM is base64-inlined so no `fetch()` is needed — this sidesteps the Chrome/Edge `file://` CORS restriction that would otherwise break loading. **No install, no server, no build step.**

### The proper way (for phones and PWA install)
Serve the folder over HTTP so the service worker can register:
```bash
# Python
python -m http.server 8080

# Node
npx serve .
```
Then open `http://localhost:8080` in a browser.

---

## ☁️ Deploy

### GitHub Pages (auto-deploy is already wired up)
This repo ships with `.github/workflows/pages.yml` — every push to `main` deploys automatically. **One-time setup:**

1. Go to **Settings → Pages** (in this repo).
2. Under **Build and deployment → Source**, pick **GitHub Actions**.
3. Push a commit (or re-run the workflow from the **Actions** tab).

That's it. Live at `https://<your-user>.github.io/Ankiportable/`.

### Other static hosts
Because everything is relative-pathed and self-contained, drag the folder into:
- **Netlify Drop** — [netlify.com/drop](https://app.netlify.com/drop)
- **Cloudflare Pages** — connect the repo
- **Vercel** — connect the repo
- **Your own server** — just serve the folder

No build step. No runtime dependencies. Nothing to configure.

---

## 🎮 How to study

### Import a deck
Click **Import .apkg** on the home screen (or drop a `.apkg` file onto the window). Reads it, parses, saves. From then on the deck just lives in your library.

### Keyboard
| Key | Action |
|-----|--------|
| `Space` / `Enter` | Flip the card (then again = Good) |
| `1` | Again |
| `2` | Hard |
| `3` | Good |
| `4` | Easy |
| `R` | Replay audio |
| `C` | Color-code the current card |
| `Z` | Undo last grade |
| `Esc` | End session |

### Touch (phone / tablet)
- **Question side:** tap or swipe up to flip.
- **Answer side:** ← Again · → Good · ↓ Hard · ↑ Easy. Live directional hints show while you drag.

---

## 🏗️ Architecture

```
Ankiportable/
├── index.html         # Entry point + PWA meta
├── styles.css         # Dark theme, mobile-first responsive
├── manifest.json      # PWA manifest
├── sw.js              # Service worker (cache-first)
├── icon.svg           # App icon
├── js/
│   ├── app.js         # Routing, home, study, sidebar, gestures, undo, toast
│   ├── parser.js      # .apkg → SQLite → notes/cards/media
│   ├── renderer.js    # Mustache-lite template rendering + media rewriting
│   ├── scheduler.js   # Simplified SM-2 with learning steps
│   └── storage.js     # IndexedDB persistence (decks, media, library, folders)
└── vendor/            # jszip, fzstd (zstd), sql.js (SQLite WASM)
```

**Storage layout** (IndexedDB, DB `ankiportable`):
- `decks` — deck body: notes, cards, models, SR state per card
- `media` — media blobs keyed by `[deckId, filename]`
- `library` — deck metadata + cached due counts + folder/color/order
- `folders` — user-created topic folders
- `meta` — settings, streak, UI prefs

---

## ✅ What's supported

- ✅ `.apkg` files with `collection.anki2`, `collection.anki21`, or `collection.anki21b` (zstd)
- ✅ Basic, Basic+reverse, simple Cloze note types
- ✅ Images and audio (autoplay on answer by default; `R` to replay)
- ✅ Card templates — `{{Field}}`, `{{#Field}}...{{/Field}}`, `{{^Field}}...{{/}}`, `{{FrontSide}}`
- ✅ Per-note-type CSS (scoped to the card)

## ❌ Not supported (by design)

- ❌ AnkiWeb sync — this is a local-first app, not a sync client
- ❌ FSRS algorithm — uses simplified SM-2 instead
- ❌ Image Occlusion masking — base image renders, masks won't
- ❌ Note editing / creation — read-only study
- ❌ Add-ons

---

## 🔒 Privacy

- 🛜 **Zero network requests** at runtime after the initial page load
- 🔐 **No account, no telemetry, no analytics**
- 💾 **All data stays in your browser's IndexedDB**, keyed to the site origin
- 📤 **You own your data** — Export Progress dumps everything to a JSON file whenever you want

---

## 🛠️ Contributing

PRs welcome. The codebase is intentionally small (~1500 LOC of app code across 5 files) and dependency-free. Read the source, tweak what you want.

## 📄 License

MIT — do what you want.

---

<div align="center">

Built with ❤️ for people who just want to study without an install screen.

### 🌐 Try it now → [another1nat.github.io/Ankiportable](https://another1nat.github.io/Ankiportable/)

</div>
