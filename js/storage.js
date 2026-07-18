// IndexedDB persistence layer.
//
// Object stores:
//   decks       — keyPath 'id': { id, name, importedAt, deckJson, cardStates, todayCounts, settings }
//   media       — keyPath ['deckId','name']: { deckId, name, blob (Uint8Array), mime }
//   library     — keyPath 'id': { id, name, cardCount, lastStudiedAt, importedAt, historyByDay,
//                                 folderId, color, order, counts }
//   folders     — keyPath 'id': { id, name, color, order, createdAt }
//   meta        — keyPath 'key': { key, value }

const DB_NAME = 'ankiportable';
const DB_VERSION = 2;
const LEGACY_DB_NAME = 'ankiclaude';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    await maybeMigrateLegacyDb();
    return await openTarget();
  })();
  return dbPromise;
}

function openTarget() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('decks')) db.createObjectStore('decks', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('media')) db.createObjectStore('media', { keyPath: ['deckId', 'name'] });
      if (!db.objectStoreNames.contains('library')) db.createObjectStore('library', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('folders')) db.createObjectStore('folders', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// One-time migration from the old "ankiclaude" DB. Copies all records over then
// deletes the legacy DB so we never do this again.
async function maybeMigrateLegacyDb() {
  if (!indexedDB.databases) return;
  let dbs;
  try { dbs = await indexedDB.databases(); } catch (_) { return; }
  const hasLegacy = dbs.some((d) => d.name === LEGACY_DB_NAME);
  const hasTarget = dbs.some((d) => d.name === DB_NAME);
  if (!hasLegacy || hasTarget) return;

  const legacy = await new Promise((resolve, reject) => {
    const req = indexedDB.open(LEGACY_DB_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  const legacyStores = Array.from(legacy.objectStoreNames);
  const dump = {};
  await new Promise((resolve, reject) => {
    const t = legacy.transaction(legacyStores, 'readonly');
    t.oncomplete = resolve; t.onerror = () => reject(t.error);
    for (const s of legacyStores) {
      const req = t.objectStore(s).getAll();
      req.onsuccess = () => { dump[s] = req.result; };
    }
  });
  legacy.close();

  const target = await openTarget();
  await new Promise((resolve, reject) => {
    const t = target.transaction(['decks', 'media', 'library', 'meta'], 'readwrite');
    t.oncomplete = resolve; t.onerror = () => reject(t.error);
    for (const s of ['decks', 'media', 'library', 'meta']) {
      if (!dump[s]) continue;
      const store = t.objectStore(s);
      for (const rec of dump[s]) store.put(rec);
    }
  });
  target.close();
  dbPromise = null;
  indexedDB.deleteDatabase(LEGACY_DB_NAME);
}

function tx(storeNames, mode = 'readonly') {
  return openDb().then((db) => db.transaction(storeNames, mode));
}

function pRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Stable deck ID from parsed content.
async function deckHash(parsed, fallbackName) {
  const cardIds = parsed.cards.map((c) => c.id).sort().join(',');
  const source = (fallbackName || '') + '|' + cardIds;
  const enc = new TextEncoder().encode(source);
  const digest = await crypto.subtle.digest('SHA-256', enc);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes.slice(0, 12)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function guessMime(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml',
    mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4',
    mp4: 'video/mp4', webm: 'video/webm',
  }[ext] || 'application/octet-stream';
}

async function saveDeck({ id, name, parsed, cardStates, settings }) {
  const t = await tx(['decks', 'media', 'library'], 'readwrite');
  const deckStore = t.objectStore('decks');
  const mediaStore = t.objectStore('media');
  const libStore = t.objectStore('library');

  const deckRecord = {
    id, name,
    importedAt: new Date().toISOString(),
    deckJson: {
      models: parsed.models,
      decks: parsed.decks,
      notes: parsed.notes,
      cards: parsed.cards,
    },
    cardStates,
    todayCounts: { date: todayKey(), newIntroduced: 0, reviewed: 0 },
    settings: settings || { newDailyCap: 20 },
  };
  await pRequest(deckStore.put(deckRecord));

  const existing = await pRequest(mediaStore.getAllKeys());
  for (const key of existing) {
    if (Array.isArray(key) && key[0] === id) {
      await pRequest(mediaStore.delete(key));
    }
  }
  for (const [filename, bytes] of Object.entries(parsed.mediaBlobs || {})) {
    await pRequest(mediaStore.put({
      deckId: id, name: filename, blob: bytes, mime: guessMime(filename),
    }));
  }

  // Preserve existing library metadata (folder/color/order) if re-importing.
  const priorLib = await pRequest(libStore.get(id));
  const libEntry = {
    id, name,
    cardCount: parsed.cards.length,
    lastStudiedAt: priorLib?.lastStudiedAt || null,
    importedAt: priorLib?.importedAt || deckRecord.importedAt,
    historyByDay: priorLib?.historyByDay || {},
    folderId: priorLib?.folderId || null,
    color: priorLib?.color || null,
    order: priorLib?.order ?? Date.now(),
    counts: computeCountsFromStates(cardStates),
  };
  await pRequest(libStore.put(libEntry));

  return deckRecord;
}

// Full deck + media — used only when starting a study session.
// Media is looked up by bounded key range on the compound [deckId, name] key,
// so we scan only this deck's rows instead of every media row in the DB.
async function loadDeck(id, onProgress) {
  const t = await tx(['decks', 'media'], 'readonly');
  onProgress?.('Reading deck…');
  const deck = await pRequest(t.objectStore('decks').get(id));
  if (!deck) return null;
  onProgress?.('Reading media…');
  const range = IDBKeyRange.bound([id, ''], [id, '￿￿']);
  const mediaAll = await pRequest(t.objectStore('media').getAll(range));
  const blobs = {};
  for (const m of mediaAll) blobs[m.name] = { bytes: m.blob, mime: m.mime };
  return { deck, mediaBlobs: blobs };
}

// Lightweight — just the SR state + today counts, no media, no notes/models.
// Used by the home screen so redrawing after a session is instant.
async function loadDeckState(id) {
  const t = await tx(['decks'], 'readonly');
  const rec = await pRequest(t.objectStore('decks').get(id));
  if (!rec) return null;
  return {
    id: rec.id,
    name: rec.name,
    cardStates: rec.cardStates,
    todayCounts: rec.todayCounts,
    settings: rec.settings,
  };
}

async function listLibrary() {
  const t = await tx(['library'], 'readonly');
  return await pRequest(t.objectStore('library').getAll());
}

async function updateDeckState(id, mutator) {
  const t = await tx(['decks'], 'readwrite');
  const store = t.objectStore('decks');
  const rec = await pRequest(store.get(id));
  if (!rec) return null;
  const updated = mutator(rec) || rec;
  await pRequest(store.put(updated));
  return updated;
}

async function updateLibraryEntry(id, mutator) {
  const t = await tx(['library'], 'readwrite');
  const store = t.objectStore('library');
  const rec = await pRequest(store.get(id));
  if (!rec) return null;
  const updated = mutator(rec) || rec;
  await pRequest(store.put(updated));
  return updated;
}

async function deleteDeck(id) {
  const t = await tx(['decks', 'media', 'library'], 'readwrite');
  await pRequest(t.objectStore('decks').delete(id));
  await pRequest(t.objectStore('library').delete(id));
  const mediaKeys = await pRequest(t.objectStore('media').getAllKeys());
  for (const key of mediaKeys) {
    if (Array.isArray(key) && key[0] === id) {
      await pRequest(t.objectStore('media').delete(key));
    }
  }
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function getMeta(key) {
  const t = await tx(['meta'], 'readonly');
  const rec = await pRequest(t.objectStore('meta').get(key));
  return rec ? rec.value : null;
}

async function setMeta(key, value) {
  const t = await tx(['meta'], 'readwrite');
  await pRequest(t.objectStore('meta').put({ key, value }));
}

// ---- folders ----
async function listFolders() {
  const t = await tx(['folders'], 'readonly');
  return await pRequest(t.objectStore('folders').getAll());
}

async function createFolder({ name, color }) {
  const id = 'f_' + Math.random().toString(36).slice(2, 10);
  const rec = {
    id,
    name: (name || 'Untitled').trim(),
    color: color || null,
    order: Date.now(),
    createdAt: new Date().toISOString(),
  };
  const t = await tx(['folders'], 'readwrite');
  await pRequest(t.objectStore('folders').put(rec));
  return rec;
}

async function updateFolder(id, patch) {
  const t = await tx(['folders'], 'readwrite');
  const store = t.objectStore('folders');
  const rec = await pRequest(store.get(id));
  if (!rec) return null;
  const updated = { ...rec, ...patch };
  await pRequest(store.put(updated));
  return updated;
}

async function deleteFolder(id) {
  const t = await tx(['folders', 'library'], 'readwrite');
  await pRequest(t.objectStore('folders').delete(id));
  const libStore = t.objectStore('library');
  const entries = await pRequest(libStore.getAll());
  for (const e of entries) {
    if (e.folderId === id) {
      e.folderId = null;
      await pRequest(libStore.put(e));
    }
  }
}

// ---- helper: recompute cached counts ----
function computeCountsFromStates(cardStates) {
  const now = Date.now();
  let newC = 0, learning = 0, review = 0;
  for (const st of Object.values(cardStates || {})) {
    if (st.state === 'new') newC += 1;
    else if (new Date(st.dueAt).getTime() <= now) {
      if (st.state === 'learning') learning += 1; else review += 1;
    }
  }
  return { new: newC, learning, review };
}

async function refreshLibraryCounts(id) {
  const state = await loadDeckState(id);
  if (!state) return null;
  return await updateLibraryEntry(id, (rec) => {
    rec.counts = computeCountsFromStates(state.cardStates);
    return rec;
  });
}

// ---- progress JSON ----
async function exportProgressJson() {
  const t = await tx(['decks', 'library', 'folders', 'meta'], 'readonly');
  const decks = await pRequest(t.objectStore('decks').getAll());
  const library = await pRequest(t.objectStore('library').getAll());
  const folders = await pRequest(t.objectStore('folders').getAll());
  const metaAll = await pRequest(t.objectStore('meta').getAll());

  const slim = decks.map((d) => ({
    id: d.id,
    name: d.name,
    importedAt: d.importedAt,
    cardStates: d.cardStates,
    todayCounts: d.todayCounts,
    settings: d.settings,
  }));

  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    decks: slim,
    library,
    folders,
    meta: metaAll,
  };
}

async function importProgressJson(payload) {
  if (!payload || (payload.version !== 1 && payload.version !== 2)) {
    throw new Error('Unsupported progress file');
  }
  const t = await tx(['decks', 'library', 'folders', 'meta'], 'readwrite');
  const deckStore = t.objectStore('decks');
  const libStore = t.objectStore('library');
  const folderStore = t.objectStore('folders');
  const metaStore = t.objectStore('meta');

  for (const d of payload.decks || []) {
    const existing = await pRequest(deckStore.get(d.id));
    if (existing) {
      existing.cardStates = d.cardStates;
      existing.todayCounts = d.todayCounts;
      existing.settings = d.settings;
      await pRequest(deckStore.put(existing));
    }
  }
  for (const l of payload.library || []) {
    const existing = await pRequest(libStore.get(l.id));
    if (existing) {
      Object.assign(existing, l);
      await pRequest(libStore.put(existing));
    }
  }
  for (const f of payload.folders || []) {
    await pRequest(folderStore.put(f));
  }
  for (const m of payload.meta || []) {
    await pRequest(metaStore.put(m));
  }
}

window.Storage = {
  deckHash, saveDeck, loadDeck, loadDeckState, listLibrary,
  updateDeckState, updateLibraryEntry, deleteDeck,
  listFolders, createFolder, updateFolder, deleteFolder,
  refreshLibraryCounts, computeCountsFromStates,
  todayKey, getMeta, setMeta,
  exportProgressJson, importProgressJson,
  guessMime,
};
