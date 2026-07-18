Ankiportable — offline, zero-install Anki-compatible study app
==============================================================

WHAT THIS IS
  A browser-based study tool that opens Anki .apkg files, replicates the core
  study experience (rendering + audio/images + SM-2 scheduling + persistent
  progress), and runs entirely from a folder on disk. No install, no admin
  rights required — everything is HTML + JS + WASM inside this folder.

HOW TO OPEN IT
  Double-click index.html — it opens in your default browser via file://.
  Nothing else to do. The SQLite WASM binary is base64-inlined in
  vendor/sql-wasm-inline.js so no fetch() is needed, sidestepping the
  Chrome/Edge file:// CORS restriction.

  The app runs 100% locally. It makes NO network requests at runtime.

DEPLOYING (this repo → GitHub Pages)
  This repo ships with .github/workflows/pages.yml that auto-deploys every
  push to `main` to GitHub Pages. First-time setup, one-time only:
    1. Push this repo to GitHub.
    2. In the repo → Settings → Pages → "Build and deployment" →
       Source: "GitHub Actions".
    3. Push a commit (or re-run the workflow) — the Actions tab shows the
       deploy, and prints the live URL.
  Your site lives at https://<user>.github.io/Ankiportable/. Open that URL
  on your phone to install the PWA (below).

RUNNING ON DIFFERENT WEBSITES / MOBILE (iPhone, Android)
  Because everything is relative-pathed and self-contained, you can drop
  this folder into any static-file host and it will Just Work:
    - GitHub Pages: push the folder as a repo, enable Pages on main branch
    - Netlify/Vercel/Cloudflare Pages: drag-and-drop the folder
    - Your own server: serve the folder — no build step, no runtime deps

  On your PHONE, once it's hosted:
    - iPhone (Safari): open the URL → Share → "Add to Home Screen".
      Launch it from the home screen — it runs fullscreen, offline-capable,
      and progress persists across launches.
    - Android (Chrome): open the URL → menu (⋮) → "Install app" or
      "Add to Home screen". Same result — a real app icon.

  Service worker (sw.js) caches the app shell on first visit, so
  subsequent launches work offline. Progress lives in the browser's
  IndexedDB, keyed to the site origin — each host is a separate
  "profile". Use Export/Restore Progress to move between them.

USING IT
  1. Open index.html. First run shows an empty deck list.
  2. Click "Import .apkg" (or drag a .apkg file onto the window).
  3. Once imported, the deck appears on the home screen with due counts.
  4. Click "Study N" to start a session.
  5. Keyboard: Space/Enter to flip, then 1 (Again), 2 (Hard),
     3 (Good, also Space/Enter), 4 (Easy). R replay · C color · Z undo
     · Esc end.
  6. Touch (phone/tablet):
       - Question side: tap OR swipe up to flip.
       - Answer side:  ← Again · → Good · ↓ Hard · ↑ Easy.
  7. Close the browser tab, reopen index.html — your progress is still there.
  8. Session ends → a summary toast appears with reviewed count, correct %,
     time, and grade breakdown.

AUDIO
  Sidebar → Audio → "Auto-play" controls when [sound:] clips play:
    - Answer side only (default) — front-side silence for language decks
    - Both sides
    - Off (tap the audio controls or press R to play manually)

ORGANIZING YOUR DECKS
  Sidebar (left) has:
    - Folders: create folders for topics, drag decks onto a folder, or use
      the 📁 button on a deck card. Rename/delete via the icons that show
      on hover. Click a folder to filter to just its decks.
    - Color filter: click a color chip to show only decks tagged with it.
    - Sort: Manual (drag-to-reorder), Name, Date added, Card count,
      Last studied, or Due count.
    - Progress: Export/Restore JSON backup.

  Per deck (icons on each deck card):
    - ✎  color-code the deck (a topic tag)
    - 📁  move to folder
    - ⋮⋮  drag handle (only visible in Manual sort mode)
    - ✕  delete

  While studying, tap the ✎ pencil (or press C) to color-code the current
  card. The color persists with the card.

BACKUP
  Use "Export progress" in the sidebar to download a JSON file that
  contains every card's SR state, folders, colors, and library metadata.
  "Restore progress" reads it back in. Media/deck contents are NOT in the
  JSON (they're too big) — restoring only re-applies SR state to decks that
  are already imported.

WHAT'S SUPPORTED
  - .apkg files with collection.anki2, collection.anki21, or
    collection.anki21b (zstd-compressed)
  - Basic, Basic+reverse, and simple Cloze deletion note types
  - Images and audio (autoplay on flip; R to replay)
  - Card templates ({{Field}}, {{#Field}}...{{/Field}}, {{^Field}}...{{/}},
    {{FrontSide}})
  - Per-note-type CSS

WHAT'S NOT SUPPORTED (by design)
  - AnkiWeb sync
  - FSRS algorithm (uses simplified SM-2 instead)
  - Image Occlusion masking (base image will render; masks won't)
  - Note editing / creation
  - Add-ons

MIGRATION FROM ANKICLAUDE
  On first launch, Ankiportable automatically copies your existing library
  from the old "ankiclaude" IndexedDB (if present) and then deletes it.
  No action required — your decks and progress carry over.
