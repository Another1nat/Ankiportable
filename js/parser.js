// .apkg parser: zip → SQLite DB + media manifest + media blobs
// Handles both collection.anki2/21 (uncompressed) and collection.anki21b (zstd)

const FIELD_SEPARATOR = '\x1f';

async function loadSqlJs(onProgress) {
  if (!window.SQL) {
    if (typeof window.initSqlJs !== 'function') {
      throw new Error('sql.js failed to load (vendor/sql-wasm.js missing or blocked)');
    }
    onProgress && onProgress('Decoding inlined SQLite WASM…');
    let wasmBinary;
    if (window.SQL_WASM_BINARY_B64) {
      const b64 = window.SQL_WASM_BINARY_B64;
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      wasmBinary = bytes;
    }
    onProgress && onProgress('Initializing SQLite runtime…');
    try {
      const cfg = wasmBinary
        ? { wasmBinary }              // avoid fetch entirely (needed for file://)
        : { locateFile: (f) => 'vendor/' + f };
      window.SQL = await window.initSqlJs(cfg);
    } catch (e) {
      throw new Error(
        'SQLite WASM failed to initialize. Original error: ' + (e && e.message || e)
      );
    }
  }
  return window.SQL;
}

async function parseApkg(file, onProgress = () => {}) {
  onProgress('Opening zip…');
  const zip = await JSZip.loadAsync(file);

  // Prefer newest collection format available
  onProgress('Locating collection database…');
  let dbBytes = null;
  let dbSource = null;
  const candidates = ['collection.anki21b', 'collection.anki21', 'collection.anki2'];
  for (const name of candidates) {
    const entry = zip.file(name);
    if (entry) {
      onProgress(`Extracting ${name}…`);
      const raw = await entry.async('uint8array');
      if (name.endsWith('b')) {
        onProgress(`Decompressing ${name} (zstd)…`);
        if (typeof fzstd === 'undefined' || typeof fzstd.decompress !== 'function') {
          throw new Error('fzstd failed to load (vendor/fzstd.js missing)');
        }
        dbBytes = fzstd.decompress(raw);
      } else {
        dbBytes = raw;
      }
      dbSource = name;
      break;
    }
  }
  if (!dbBytes) throw new Error('No collection.anki2/21/21b found in .apkg');

  // Media manifest — plain JSON: {"0":"photo.jpg", ...}
  onProgress('Reading media manifest…');
  const mediaEntry = zip.file('media');
  let mediaManifest = {};
  if (mediaEntry) {
    const text = await mediaEntry.async('string');
    try {
      mediaManifest = JSON.parse(text);
    } catch (_) {
      mediaManifest = {};
    }
  }

  // Extract each media blob keyed by real filename
  const entries = Object.entries(mediaManifest);
  const total = entries.length;
  const mediaBlobs = {};
  let done = 0;
  let lastReport = 0;
  for (const [key, filename] of entries) {
    const f = zip.file(key);
    if (f) {
      const bytes = await f.async('uint8array');
      mediaBlobs[filename] = bytes;
    }
    done++;
    const now = Date.now();
    if (now - lastReport > 150) {
      onProgress(`Extracting media ${done}/${total}…`);
      lastReport = now;
    }
  }
  if (total > 0) onProgress(`Extracted ${done}/${total} media files`);

  onProgress('Initializing SQLite…');
  const SQL = await loadSqlJs(onProgress);
  onProgress('Reading collection…');
  const db = new SQL.Database(dbBytes);

  const parsed = readCollection(db);
  db.close();

  onProgress(`Parsed ${parsed.cards.length} cards, ${Object.keys(parsed.notes).length} notes`);
  return {
    dbSource,
    ...parsed,
    mediaBlobs, // { filename: Uint8Array }
  };
}

function readCollection(db) {
  // col row: id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags
  const colRes = db.exec('SELECT models, decks FROM col LIMIT 1');
  if (!colRes.length) throw new Error('col table empty');
  const [modelsJson, decksJson] = colRes[0].values[0];
  const models = JSON.parse(modelsJson);
  const decks = JSON.parse(decksJson);

  // notes: id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data
  const noteRes = db.exec('SELECT id, mid, flds, tags FROM notes');
  const notesById = {};
  if (noteRes.length) {
    for (const row of noteRes[0].values) {
      const [id, mid, flds, tags] = row;
      notesById[String(id)] = {
        id: String(id),
        mid: String(mid),
        fields: flds.split(FIELD_SEPARATOR),
        tags: (tags || '').trim(),
      };
    }
  }

  // cards: id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, ...
  const cardRes = db.exec('SELECT id, nid, did, ord FROM cards');
  const cards = [];
  if (cardRes.length) {
    for (const row of cardRes[0].values) {
      const [id, nid, did, ord] = row;
      cards.push({
        id: String(id),
        nid: String(nid),
        did: String(did),
        ord: Number(ord),
      });
    }
  }

  return { models, decks, notes: notesById, cards };
}

window.ApkgParser = { parseApkg, FIELD_SEPARATOR };
