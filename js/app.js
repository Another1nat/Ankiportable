// App entry: routing between Home / Study screens, keyboard handling,
// media URL lifecycle, streaks/session stats, persisted user settings,
// folders/colors/sort/filter, drag-to-reorder, per-card color coding.

const state = {
  screen: 'home', // 'home' | 'study'
  currentDeck: null,      // full deck record from IndexedDB
  mediaUrlMap: {},        // { filename: blobURL } — always release when leaving study
  session: null,
  settings: {
    volume: 1.0,
    newDailyCap: 0,
    sessionLengthMin: 0,
    audioAutoplay: 'answer',  // 'answer' | 'both' | 'off'
  },
  ui: {
    sort: 'manual',
    filterFolderId: null,   // null = all, 'none' = uncategorized
    filterColor: null,      // null = all, 'none' = uncolored, or color name
    sidebarOpen: false,     // mobile only; desktop always shows
    search: '',
  },
  library: [],   // cached library entries
  folders: [],   // cached folders
};

const SETTINGS_KEY = 'user-settings';
const UI_KEY = 'ui-prefs';
const COLORS = [
  { name: 'red',    var: '--tag-red' },
  { name: 'orange', var: '--tag-orange' },
  { name: 'yellow', var: '--tag-yellow' },
  { name: 'green',  var: '--tag-green' },
  { name: 'blue',   var: '--tag-blue' },
  { name: 'purple', var: '--tag-purple' },
  { name: 'pink',   var: '--tag-pink' },
];

function colorVar(name) {
  const c = COLORS.find((c) => c.name === name);
  return c ? `var(${c.var})` : 'transparent';
}

// -------- boot --------
window.addEventListener('DOMContentLoaded', async () => {
  installErrorReporter();
  await loadSettings();
  await loadUiPrefs();
  bindGlobalKeys();
  bindHomeControls();
  bindSettingsControls();
  bindSidebarControls();
  bindStudyTouchGestures();
  bindStudyScrollCompact();
  registerServiceWorker();
  await refreshHome();
});

function registerServiceWorker() {
  // Only meaningful when hosted over http/https. On file:// there's no SW.
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW registration failed:', err));
}

function installErrorReporter() {
  const show = (label, err) => {
    console.error(label, err);
    const status = document.getElementById('import-status');
    const msg = err?.message || String(err);
    if (status) status.textContent = `${label}: ${msg}`;
  };
  window.addEventListener('error', (e) => show('Uncaught error', e.error || e.message));
  window.addEventListener('unhandledrejection', (e) => show('Unhandled promise', e.reason));
}

// -------- settings --------
async function loadSettings() {
  const stored = await Storage.getMeta(SETTINGS_KEY);
  if (stored && typeof stored === 'object') {
    state.settings = { ...state.settings, ...stored };
  }
  applySettingsToInputs();
  updateVolumeIcon();
}

async function saveSettings() {
  await Storage.setMeta(SETTINGS_KEY, state.settings);
}

async function loadUiPrefs() {
  const stored = await Storage.getMeta(UI_KEY);
  if (stored && typeof stored === 'object') {
    state.ui = { ...state.ui, ...stored };
  }
  document.getElementById('sort-select').value = state.ui.sort || 'manual';
}
async function saveUiPrefs() {
  await Storage.setMeta(UI_KEY, {
    sort: state.ui.sort,
    filterFolderId: state.ui.filterFolderId,
    filterColor: state.ui.filterColor,
  });
}

function applySettingsToInputs() {
  const capEl = document.getElementById('setting-new-cap');
  const sesEl = document.getElementById('setting-session-min');
  const volEl = document.getElementById('volume-slider');
  if (capEl) capEl.value = state.settings.newDailyCap > 0 ? state.settings.newDailyCap : '';
  if (sesEl) sesEl.value = state.settings.sessionLengthMin > 0 ? state.settings.sessionLengthMin : '';
  if (volEl) volEl.value = Math.round(state.settings.volume * 100);
}

function bindSettingsControls() {
  document.getElementById('setting-new-cap').addEventListener('change', async (e) => {
    const v = parseInt(e.target.value, 10);
    state.settings.newDailyCap = (isNaN(v) || v <= 0) ? 0 : v;
    await saveSettings();
    if (state.screen === 'home') await refreshHome();
  });
  document.getElementById('setting-session-min').addEventListener('change', async (e) => {
    const v = parseInt(e.target.value, 10);
    state.settings.sessionLengthMin = (isNaN(v) || v <= 0) ? 0 : v;
    await saveSettings();
    updateSessionRemainingDisplay();
  });
  const volSlider = document.getElementById('volume-slider');
  volSlider.addEventListener('input', (e) => {
    state.settings.volume = (parseInt(e.target.value, 10) || 0) / 100;
    applyVolumeToAudio();
    updateVolumeIcon();
  });
  volSlider.addEventListener('change', saveSettings);
  document.getElementById('volume-icon').addEventListener('click', async () => {
    if (state.settings.volume > 0) {
      state.settings._preMuteVolume = state.settings.volume;
      state.settings.volume = 0;
    } else {
      state.settings.volume = state.settings._preMuteVolume || 1.0;
    }
    document.getElementById('volume-slider').value = Math.round(state.settings.volume * 100);
    applyVolumeToAudio();
    updateVolumeIcon();
    await saveSettings();
  });
}

function applyVolumeToAudio() {
  document.querySelectorAll('audio,video').forEach((a) => { a.volume = state.settings.volume; });
}

function updateVolumeIcon() {
  const btn = document.getElementById('volume-icon');
  if (!btn) return;
  const v = state.settings.volume;
  btn.textContent = v === 0 ? '🔇' : v < 0.5 ? '🔉' : '🔊';
}

// -------- media URL lifecycle --------
function buildMediaUrlMap(mediaBlobs) {
  releaseMediaUrls();
  const out = {};
  for (const [name, entry] of Object.entries(mediaBlobs)) {
    const bytes = entry.bytes || entry;
    const mime = entry.mime || Storage.guessMime(name);
    const blob = new Blob([bytes], { type: mime });
    out[name] = URL.createObjectURL(blob);
  }
  state.mediaUrlMap = out;
  return out;
}
function releaseMediaUrls() {
  for (const url of Object.values(state.mediaUrlMap || {})) {
    try { URL.revokeObjectURL(url); } catch (_) {}
  }
  state.mediaUrlMap = {};
}

// -------- Sidebar --------
function bindSidebarControls() {
  document.getElementById('sidebar-toggle').addEventListener('click', () => {
    const shell = document.querySelector('.app-shell');
    shell.classList.toggle('sidebar-open');
    shell.classList.toggle('no-sidebar');
  });

  document.getElementById('sidebar-backdrop').addEventListener('click', () => {
    const shell = document.querySelector('.app-shell');
    shell.classList.remove('sidebar-open');
    shell.classList.remove('no-sidebar');
  });

  document.getElementById('new-folder-btn').addEventListener('click', async () => {
    const name = prompt('Folder name?');
    if (!name) return;
    await Storage.createFolder({ name });
    await refreshHome();
  });

  document.getElementById('sort-select').addEventListener('change', async (e) => {
    state.ui.sort = e.target.value;
    await saveUiPrefs();
    renderDeckList();
  });

  const searchEl = document.getElementById('deck-search');
  searchEl.addEventListener('input', (e) => {
    state.ui.search = e.target.value || '';
    renderDeckList();
  });

  const autoplayEl = document.getElementById('audio-autoplay-select');
  autoplayEl.value = state.settings.audioAutoplay || 'answer';
  autoplayEl.addEventListener('change', async (e) => {
    state.settings.audioAutoplay = e.target.value;
    await saveSettings();
  });

  document.getElementById('export-progress-btn').addEventListener('click', onExportProgress);
  document.getElementById('import-progress-btn').addEventListener('click', () => {
    document.getElementById('import-progress-input').click();
  });
  document.getElementById('import-progress-input').addEventListener('change', onImportProgress);
}

function renderSidebar() {
  const folderList = document.getElementById('folder-list');
  const items = [];

  const totalCount = state.library.length;
  items.push(renderFolderItem({
    id: null, name: 'All decks', count: totalCount,
    active: state.ui.filterFolderId === null,
  }));

  const uncatCount = state.library.filter((e) => !e.folderId).length;
  items.push(renderFolderItem({
    id: 'none', name: 'Uncategorized', count: uncatCount,
    active: state.ui.filterFolderId === 'none',
  }));

  for (const f of state.folders.sort((a, b) => (a.order || 0) - (b.order || 0))) {
    const count = state.library.filter((e) => e.folderId === f.id).length;
    items.push(renderFolderItem({
      id: f.id, name: f.name, count, color: f.color,
      active: state.ui.filterFolderId === f.id,
      editable: true,
    }));
  }
  folderList.innerHTML = items.join('');

  folderList.querySelectorAll('.folder-item').forEach((el) => {
    const id = el.dataset.id === '' ? null : el.dataset.id;
    el.addEventListener('click', async (e) => {
      if (e.target.closest('.folder-actions')) return;
      state.ui.filterFolderId = id;
      await saveUiPrefs();
      renderSidebar();
      renderDeckList();
    });
    // Drop target: assign deck's folder when dropped
    el.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes('application/x-deck-id')) return;
      e.preventDefault();
      el.classList.add('drop-target');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
    el.addEventListener('drop', async (e) => {
      e.preventDefault();
      el.classList.remove('drop-target');
      const deckId = e.dataTransfer.getData('application/x-deck-id');
      if (!deckId) return;
      const targetFolderId = id === 'none' ? null : id;
      await Storage.updateLibraryEntry(deckId, (rec) => { rec.folderId = targetFolderId; return rec; });
      await refreshHome();
    });
  });
  folderList.querySelectorAll('.folder-rename').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const folder = state.folders.find((f) => f.id === id);
      const name = prompt('Folder name?', folder?.name || '');
      if (name && name.trim()) {
        await Storage.updateFolder(id, { name: name.trim() });
        await refreshHome();
      }
    });
  });
  folderList.querySelectorAll('.folder-delete').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (confirm('Delete this folder? (Decks inside will become uncategorized.)')) {
        await Storage.deleteFolder(id);
        if (state.ui.filterFolderId === id) state.ui.filterFolderId = null;
        await saveUiPrefs();
        await refreshHome();
      }
    });
  });

  // Color filter chips
  const colorEl = document.getElementById('color-filter');
  const chips = [];
  chips.push(`<div class="color-chip none ${state.ui.filterColor === null ? 'active' : ''}" data-color="" title="All colors">×</div>`);
  chips.push(`<div class="color-chip none ${state.ui.filterColor === 'none' ? 'active' : ''}" data-color="none" title="No color" style="background:transparent">·</div>`);
  for (const c of COLORS) {
    const active = state.ui.filterColor === c.name ? 'active' : '';
    chips.push(`<div class="color-chip ${active}" data-color="${c.name}" title="${c.name}" style="background: var(${c.var})"></div>`);
  }
  colorEl.innerHTML = chips.join('');
  colorEl.querySelectorAll('.color-chip').forEach((el) => {
    el.addEventListener('click', async () => {
      const v = el.dataset.color;
      state.ui.filterColor = v === '' ? null : v;
      await saveUiPrefs();
      renderSidebar();
      renderDeckList();
    });
  });
}

function renderFolderItem({ id, name, count, color, active, editable }) {
  const dot = color
    ? `<span class="color-chip" style="background:var(--tag-${color}); width:10px; height:10px; border-width:0"></span>`
    : '';
  const actions = editable
    ? `<span class="folder-actions">
         <button class="folder-rename" data-id="${id}" title="Rename">✎</button>
         <button class="folder-delete" data-id="${id}" title="Delete">✕</button>
       </span>`
    : '';
  return `
    <div class="folder-item ${active ? 'active' : ''}" data-id="${id ?? ''}">
      ${dot}
      <span class="name">${escapeHtml(name)}</span>
      <span class="count">${count}</span>
      ${actions}
    </div>`;
}

// -------- Home screen --------
function bindHomeControls() {
  document.getElementById('import-btn').addEventListener('click', () => {
    document.getElementById('import-input').click();
  });
  document.getElementById('import-input').addEventListener('change', onImportFiles);
  const dropZone = document.getElementById('home');
  ['dragenter', 'dragover'].forEach((evt) => dropZone.addEventListener(evt, (e) => {
    if (e.dataTransfer.types.includes('application/x-deck-id')) return; // internal drag
    e.preventDefault(); dropZone.classList.add('dragging');
  }));
  ['dragleave', 'drop'].forEach((evt) => dropZone.addEventListener(evt, (e) => {
    e.preventDefault(); dropZone.classList.remove('dragging');
  }));
  dropZone.addEventListener('drop', (e) => {
    if (e.dataTransfer?.files?.length) onImportFiles({ target: { files: e.dataTransfer.files } });
  });
}

async function onImportFiles(e) {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  const status = document.getElementById('import-status');
  for (const file of files) {
    if (!file.name.toLowerCase().endsWith('.apkg')) {
      status.textContent = `Skipped ${file.name} (not .apkg)`;
      continue;
    }
    status.textContent = `Parsing ${file.name}…`;
    const onProgress = (msg) => {
      status.textContent = `${file.name}: ${msg}`;
      console.log('[import]', file.name, msg);
    };
    try {
      const parsed = await ApkgParser.parseApkg(file, onProgress);
      const name = file.name.replace(/\.apkg$/i, '');
      onProgress('Hashing deck…');
      const id = await Storage.deckHash(parsed, name);
      const cardStates = {};
      for (const c of parsed.cards) cardStates[c.id] = Scheduler.initialState();
      onProgress('Saving to IndexedDB…');
      await Storage.saveDeck({ id, name, parsed, cardStates });
      status.textContent = `Imported ${name} (${parsed.cards.length} cards, ${Object.keys(parsed.mediaBlobs || {}).length} media)`;
    } catch (err) {
      console.error('[import] failed:', err);
      status.textContent = `Failed to import ${file.name}: ${err.message}`;
    }
  }
  e.target.value = '';
  await refreshHome();
}

async function refreshHome() {
  // Fast path: read only library entries + folders. No deck body, no media.
  state.library = await Storage.listLibrary();
  state.folders = await Storage.listFolders();

  // If any entries are missing cached counts (older imports), backfill in the
  // background. Skip when we already have counts to keep this instantaneous.
  const stale = state.library.filter((e) => !e.counts);
  if (stale.length) {
    for (const e of stale) {
      const updated = await Storage.refreshLibraryCounts(e.id);
      if (updated) Object.assign(e, updated);
    }
  }

  renderSidebar();
  renderDeckList();
  await updateGlobalStats();
}

function renderDeckList() {
  const container = document.getElementById('deck-list');
  const list = filterAndSort(state.library);

  container.innerHTML = '';
  updateActiveFilterLabel();
  if (!list.length) {
    container.innerHTML = '<p class="empty">No decks yet. Click <b>Import .apkg</b> or drop a file here.</p>';
    return;
  }
  for (const entry of list) {
    container.appendChild(renderDeckCard(entry));
  }
}

function updateActiveFilterLabel() {
  const el = document.getElementById('active-filter-label');
  const parts = [];
  if (state.ui.filterFolderId) {
    if (state.ui.filterFolderId === 'none') parts.push('Folder: <b>Uncategorized</b>');
    else {
      const f = state.folders.find((f) => f.id === state.ui.filterFolderId);
      if (f) parts.push(`Folder: <b>${escapeHtml(f.name)}</b>`);
    }
  }
  if (state.ui.filterColor) {
    parts.push(`Color: <b>${state.ui.filterColor === 'none' ? 'none' : state.ui.filterColor}</b>`);
  }
  if (!parts.length) { el.innerHTML = ''; return; }
  el.innerHTML = parts.join(' · ') + ' <a id="clear-filter">clear</a>';
  el.querySelector('#clear-filter').addEventListener('click', async () => {
    state.ui.filterFolderId = null;
    state.ui.filterColor = null;
    await saveUiPrefs();
    renderSidebar();
    renderDeckList();
  });
}

function filterAndSort(entries) {
  let list = entries.slice();

  if (state.ui.filterFolderId === 'none') {
    list = list.filter((e) => !e.folderId);
  } else if (state.ui.filterFolderId) {
    list = list.filter((e) => e.folderId === state.ui.filterFolderId);
  }
  if (state.ui.filterColor === 'none') {
    list = list.filter((e) => !e.color);
  } else if (state.ui.filterColor) {
    list = list.filter((e) => e.color === state.ui.filterColor);
  }
  const q = (state.ui.search || '').trim().toLowerCase();
  if (q) list = list.filter((e) => (e.name || '').toLowerCase().includes(q));

  const dueOf = (e) => {
    const c = e.counts || { new: 0, learning: 0, review: 0 };
    return c.learning + c.review + cappedNewFor(e, c);
  };

  const s = state.ui.sort;
  if (s === 'name') {
    list.sort((a, b) => a.name.localeCompare(b.name));
  } else if (s === 'dateAdded') {
    list.sort((a, b) => (b.importedAt || '').localeCompare(a.importedAt || ''));
  } else if (s === 'cardCount') {
    list.sort((a, b) => (b.cardCount || 0) - (a.cardCount || 0));
  } else if (s === 'lastStudied') {
    list.sort((a, b) => (b.lastStudiedAt || '').localeCompare(a.lastStudiedAt || ''));
  } else if (s === 'due') {
    list.sort((a, b) => dueOf(b) - dueOf(a));
  } else {
    // manual — use `order`, falling back to importedAt
    list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }
  return list;
}

function cappedNewFor(entry, counts) {
  const cap = state.settings.newDailyCap;
  if (!cap || cap <= 0) return counts.new;
  const today = Storage.todayKey();
  const introducedToday = entry.todayCounts?.date === today ? (entry.todayCounts.newIntroduced || 0) : 0;
  return Math.max(0, Math.min(counts.new, cap - introducedToday));
}

function renderDeckCard(entry) {
  const counts = entry.counts || { new: 0, learning: 0, review: 0 };
  const cappedNew = cappedNewFor(entry, counts);
  const total = counts.learning + counts.review + cappedNew;

  const folder = entry.folderId ? state.folders.find((f) => f.id === entry.folderId) : null;
  const dragEnabled = state.ui.sort === 'manual';

  const el = document.createElement('div');
  el.className = 'deck-card';
  el.dataset.id = entry.id;
  el.draggable = dragEnabled;
  el.innerHTML = `
    <div class="deck-color-strip" style="background:${entry.color ? colorVar(entry.color) : 'transparent'}"></div>
    <div class="deck-card-head">
      <h3 title="${escapeHtml(entry.name)}">${escapeHtml(entry.name)}</h3>
      <div class="deck-card-actions">
        ${dragEnabled ? '<span class="drag-handle" title="Drag to reorder">⋮⋮</span>' : ''}
        <button class="card-action-btn color" title="Color-code deck">✎</button>
        <button class="card-action-btn folder" title="Move to folder">📁</button>
        <button class="card-action-btn delete" title="Delete">✕</button>
      </div>
    </div>
    <div class="deck-stats">
      <span class="stat new"><b>${cappedNew}</b> new</span>
      <span class="stat learning"><b>${counts.learning}</b> learning</span>
      <span class="stat review"><b>${counts.review}</b> due</span>
    </div>
    <div class="deck-meta">
      ${folder ? `<span class="folder-tag">📁 ${escapeHtml(folder.name)}</span>` : ''}
      ${entry.cardCount} cards · last studied ${entry.lastStudiedAt ? relTime(entry.lastStudiedAt) : 'never'}
    </div>
    <button class="study-btn" ${total === 0 ? 'disabled' : ''}>
      ${total === 0 ? 'Nothing due' : `Study ${total}`}
    </button>
  `;

  el.querySelector('.study-btn').addEventListener('click', () => startStudy(entry.id));
  el.querySelector('.card-action-btn.delete').addEventListener('click', async () => {
    if (confirm('Delete this deck and all its progress?')) {
      await Storage.deleteDeck(entry.id);
      await refreshHome();
    }
  });
  el.querySelector('.card-action-btn.color').addEventListener('click', (e) => {
    e.stopPropagation();
    openDeckColorPicker(e.currentTarget, entry);
  });
  el.querySelector('.card-action-btn.folder').addEventListener('click', (e) => {
    e.stopPropagation();
    openDeckFolderPicker(e.currentTarget, entry);
  });

  if (dragEnabled) {
    el.addEventListener('dragstart', (e) => {
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/x-deck-id', entry.id);
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      document.querySelectorAll('.deck-card').forEach((n) => n.classList.remove('drop-before', 'drop-after'));
    });
    el.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes('application/x-deck-id')) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const isBefore = (e.clientY - rect.top) < rect.height / 2;
      el.classList.toggle('drop-before', isBefore);
      el.classList.toggle('drop-after', !isBefore);
    });
    el.addEventListener('dragleave', () => {
      el.classList.remove('drop-before', 'drop-after');
    });
    el.addEventListener('drop', async (e) => {
      e.preventDefault();
      const draggedId = e.dataTransfer.getData('application/x-deck-id');
      if (!draggedId || draggedId === entry.id) return;
      const rect = el.getBoundingClientRect();
      const isBefore = (e.clientY - rect.top) < rect.height / 2;
      el.classList.remove('drop-before', 'drop-after');
      await reorderDeck(draggedId, entry.id, isBefore);
    });
  }
  return el;
}

async function reorderDeck(draggedId, targetId, before) {
  // Reorder across the full library so orders stay consistent regardless of
  // whatever filter is currently active. Compute the drag within visible order
  // then splice back into the full sorted list.
  const full = state.library.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const orderedIds = full.map((e) => e.id);
  const from = orderedIds.indexOf(draggedId);
  if (from === -1) return;
  orderedIds.splice(from, 1);
  const to = orderedIds.indexOf(targetId);
  if (to === -1) return;
  const insertAt = to + (before ? 0 : 1);
  orderedIds.splice(insertAt, 0, draggedId);

  const base = Date.now();
  for (let i = 0; i < orderedIds.length; i++) {
    await Storage.updateLibraryEntry(orderedIds[i], (rec) => { rec.order = base + i; return rec; });
  }
  await refreshHome();
}

// -------- popovers (color, folder) --------
function positionPopover(pop, anchorEl) {
  const rect = anchorEl.getBoundingClientRect();
  pop.style.top = (rect.bottom + window.scrollY + 4) + 'px';
  pop.style.left = Math.max(8, Math.min(window.innerWidth - 220, rect.left + window.scrollX)) + 'px';
}
function openPopover(anchorEl, html, onBind) {
  const pop = document.getElementById('popover');
  pop.innerHTML = html;
  pop.classList.remove('hidden');
  positionPopover(pop, anchorEl);
  onBind?.(pop);
  const close = (ev) => {
    if (ev && (pop.contains(ev.target) || anchorEl.contains(ev.target))) return;
    pop.classList.add('hidden'); pop.innerHTML = '';
    document.removeEventListener('click', close, true);
    document.removeEventListener('keydown', escClose, true);
  };
  const escClose = (ev) => { if (ev.key === 'Escape') close(); };
  setTimeout(() => {
    document.addEventListener('click', close, true);
    document.addEventListener('keydown', escClose, true);
  }, 0);
  return pop;
}
function closePopover() {
  const pop = document.getElementById('popover');
  pop.classList.add('hidden');
  pop.innerHTML = '';
}

function colorPickerHtml(currentColor) {
  const chips = [
    `<div class="color-chip none ${!currentColor ? 'active' : ''}" data-color="" title="No color">×</div>`,
  ];
  for (const c of COLORS) {
    const active = currentColor === c.name ? 'active' : '';
    chips.push(`<div class="color-chip ${active}" data-color="${c.name}" title="${c.name}" style="background: var(${c.var})"></div>`);
  }
  return `
    <div class="pop-heading">Color</div>
    <div class="pop-row">${chips.join('')}</div>
  `;
}

function openDeckColorPicker(anchorEl, entry) {
  openPopover(anchorEl, colorPickerHtml(entry.color), (pop) => {
    pop.querySelectorAll('.color-chip').forEach((chip) => {
      chip.addEventListener('click', async () => {
        const color = chip.dataset.color || null;
        await Storage.updateLibraryEntry(entry.id, (rec) => { rec.color = color; return rec; });
        closePopover();
        await refreshHome();
      });
    });
  });
}

function openDeckFolderPicker(anchorEl, entry) {
  const options = [
    `<option value="">(uncategorized)</option>`,
    ...state.folders.map((f) => `<option value="${f.id}" ${entry.folderId === f.id ? 'selected' : ''}>${escapeHtml(f.name)}</option>`),
  ].join('');
  const html = `
    <div class="pop-heading">Move to folder</div>
    <div class="pop-row"><select id="pop-folder-select">${options}</select></div>
    <div class="pop-row" style="justify-content:space-between">
      <button class="pop-btn" id="pop-new-folder">＋ New folder</button>
      <button class="pop-btn primary" id="pop-apply">Apply</button>
    </div>
  `;
  openPopover(anchorEl, html, (pop) => {
    pop.querySelector('#pop-apply').addEventListener('click', async () => {
      const val = pop.querySelector('#pop-folder-select').value || null;
      await Storage.updateLibraryEntry(entry.id, (rec) => { rec.folderId = val; return rec; });
      closePopover();
      await refreshHome();
    });
    pop.querySelector('#pop-new-folder').addEventListener('click', async () => {
      const name = prompt('Folder name?');
      if (!name) return;
      const rec = await Storage.createFolder({ name });
      await Storage.updateLibraryEntry(entry.id, (r) => { r.folderId = rec.id; return r; });
      closePopover();
      await refreshHome();
    });
  });
}

async function updateGlobalStats() {
  const meta = await Storage.getMeta('streak') || { current: 0, lastDay: null };
  const today = Storage.todayKey();
  let display = meta.current;
  if (meta.lastDay && meta.lastDay !== today) {
    const yesterday = dayOffset(today, -1);
    if (meta.lastDay !== yesterday) display = 0;
  }
  const totals = computeTodayTotal();
  document.getElementById('global-stats').innerHTML = `
    <span>🔥 <b>${display}</b>d</span>
    <span>⏱ <b>${formatDuration(totals.timeMs)}</b> · <b>${totals.reviewed}</b> today</span>
  `;
}

function computeTodayTotal() {
  const today = Storage.todayKey();
  let reviewed = 0, timeMs = 0;
  for (const l of state.library) {
    const d = (l.historyByDay || {})[today];
    if (d) { reviewed += d.reviewed || 0; timeMs += d.timeMs || 0; }
  }
  return { reviewed, timeMs };
}

function resetTodayCountsIfNewDay(deck) {
  const today = Storage.todayKey();
  if (!deck.todayCounts || deck.todayCounts.date !== today) {
    deck.todayCounts = { date: today, newIntroduced: 0, reviewed: 0 };
  }
}

function showLoading(msg) {
  const el = document.getElementById('loading-overlay');
  const m = document.getElementById('loading-msg');
  if (m) m.textContent = msg || 'Loading…';
  el.classList.remove('hidden');
}
function updateLoading(msg) {
  const m = document.getElementById('loading-msg');
  if (m && msg) m.textContent = msg;
}
function hideLoading() {
  document.getElementById('loading-overlay').classList.add('hidden');
}

// -------- Study screen --------
async function startStudy(deckId) {
  const studyBtn = document.querySelector(`.deck-card[data-id="${deckId}"] .study-btn`);
  studyBtn?.classList.add('loading');
  showLoading('Opening deck…');
  let loaded;
  try {
    loaded = await Storage.loadDeck(deckId, updateLoading);
  } finally {
    studyBtn?.classList.remove('loading');
  }
  if (!loaded) { hideLoading(); return; }
  const { deck, mediaBlobs } = loaded;
  resetTodayCountsIfNewDay(deck);

  const queue = Scheduler.buildQueue(deck.cardStates, state.settings.newDailyCap, deck.todayCounts);
  const order = [...queue.learning, ...queue.review, ...queue.newCards];
  if (!order.length) { hideLoading(); return; }

  updateLoading('Preparing media…');
  // Yield to the browser so the "Preparing media…" text paints before we
  // synchronously build blob URLs, which can take a moment for big decks.
  await new Promise((r) => requestAnimationFrame(() => r()));
  buildMediaUrlMap(mediaBlobs);
  state.currentDeck = deck;
  state.session = {
    startedMs: Date.now(),
    cardsSeen: 0,
    correct: 0,
    timeMs: 0,
    queue: order,
    index: 0,
    showingAnswer: false,
    flippedAtMs: null,
    gradedBreakdown: { 0: 0, 1: 0, 2: 0, 3: 0 },
    totalPlanned: order.length,
    initialNewCount: queue.newCards.length,
    lastGrade: null,   // snapshot for undo
  };
  updateUndoButton();
  showScreen('study');
  updateSessionRemainingDisplay();
  renderCurrentCard();
  hideLoading();
}

function currentCardId() {
  return state.session?.queue[state.session.index];
}

function renderCurrentCard() {
  const sess = state.session;
  const deck = state.currentDeck;
  if (!sess || sess.index >= sess.queue.length) return finishSession();

  const cardId = sess.queue[sess.index];
  const card = deck.deckJson.cards.find((c) => c.id === cardId);
  if (!card) { sess.index += 1; return renderCurrentCard(); }

  const ctx = {
    notes: deck.deckJson.notes,
    models: deck.deckJson.models,
    mediaUrlMap: state.mediaUrlMap,
  };

  const side = sess.showingAnswer ? 'answer' : 'question';
  const rendered = CardRenderer.renderCard(card, side, ctx);

  document.getElementById('card-css').textContent = scopeCss(rendered.css, '#card-inner');
  const cardEl = document.getElementById('card-inner');
  cardEl.className = 'card ' + side;
  cardEl.innerHTML = rendered.html;
  applyVolumeToAudio();
  applyAudioAutoplayPolicy(side);

  document.getElementById('progress-counter').textContent = `${sess.index + 1} / ${sess.totalPlanned}`;
  document.getElementById('session-timer').textContent = formatDuration(Date.now() - sess.startedMs);

  // Reflect this card's color in the pencil button + card frame tint
  const cs = deck.cardStates[cardId];
  applyCardColorVisual(cs?.color || null);

  const flipRow = document.getElementById('flip-row');
  const gradeRow = document.getElementById('grade-row');
  if (sess.showingAnswer) {
    flipRow.classList.add('hidden');
    gradeRow.classList.remove('hidden');
    document.getElementById('preview-again').textContent = Scheduler.previewInterval(cs, 0);
    document.getElementById('preview-hard').textContent = Scheduler.previewInterval(cs, 1);
    document.getElementById('preview-good').textContent = Scheduler.previewInterval(cs, 2);
    document.getElementById('preview-easy').textContent = Scheduler.previewInterval(cs, 3);
  } else {
    flipRow.classList.remove('hidden');
    gradeRow.classList.add('hidden');
    sess.flippedAtMs = null;
  }
}

function applyAudioAutoplayPolicy(side) {
  const mode = state.settings.audioAutoplay || 'answer';
  const shouldPlay = mode === 'both' || (mode === 'answer' && side === 'answer');
  document.querySelectorAll('#card-inner audio').forEach((a) => {
    if (shouldPlay) {
      a.autoplay = true;
      try { a.currentTime = 0; a.play().catch(() => {}); } catch (_) {}
    } else {
      a.autoplay = false;
      try { a.pause(); } catch (_) {}
    }
  });
}

function applyCardColorVisual(colorName) {
  const wrap = document.querySelector('.card-wrap');
  const btn = document.getElementById('card-color-btn');
  const cssColor = colorName ? colorVar(colorName) : 'transparent';
  wrap.style.setProperty('--current-color', cssColor);
  btn.style.setProperty('--current-color', cssColor);
  wrap.classList.toggle('tinted', !!colorName);
  btn.classList.toggle('has-color', !!colorName);
}

function flipCard() {
  const sess = state.session;
  if (!sess || sess.showingAnswer) return;
  sess.showingAnswer = true;
  sess.flippedAtMs = Date.now();
  renderCurrentCard();
}

async function gradeCurrent(g) {
  const sess = state.session;
  if (!sess || !sess.showingAnswer) return;

  const cardId = sess.queue[sess.index];
  const deck = state.currentDeck;
  const before = deck.cardStates[cardId];
  const wasNew = before.state === 'new';

  // Snapshot for undo (deep clones of the pieces we'll mutate).
  sess.lastGrade = {
    cardId,
    prevCardState: JSON.parse(JSON.stringify(before)),
    prevTodayCounts: JSON.parse(JSON.stringify(deck.todayCounts)),
    prevIndex: sess.index,
    prevQueueLen: sess.queue.length,
    grade: g,
    wasNew,
    dtMs: sess.flippedAtMs ? Date.now() - sess.flippedAtMs : 0,
  };

  const after = Scheduler.grade(before, g);
  if (before.color) after.color = before.color;
  deck.cardStates[cardId] = after;

  const dtMs = sess.lastGrade.dtMs;
  sess.timeMs += dtMs;
  sess.cardsSeen += 1;
  if (g >= 2) sess.correct += 1;
  sess.gradedBreakdown[g] += 1;

  if (wasNew) deck.todayCounts.newIntroduced += 1;
  deck.todayCounts.reviewed += 1;

  await Storage.updateDeckState(deck.id, (rec) => {
    rec.cardStates = deck.cardStates;
    rec.todayCounts = deck.todayCounts;
    return rec;
  });
  await accrueDailyTotals(deck.id, 1, dtMs);
  await Storage.updateLibraryEntry(deck.id, (rec) => {
    rec.counts = Storage.computeCountsFromStates(deck.cardStates);
    rec.todayCounts = deck.todayCounts;
    return rec;
  });

  if (after.state === 'learning') {
    const dueInMin = (new Date(after.dueAt).getTime() - Date.now()) / 60000;
    if (dueInMin <= 15) {
      sess.queue.push(cardId);
      sess.lastGrade.reinserted = true;
    }
  }

  sess.index += 1;
  sess.showingAnswer = false;
  updateUndoButton();

  if (sessionTimeLimitReached()) return finishSession();
  renderCurrentCard();
}

async function undoLastGrade() {
  const sess = state.session;
  if (!sess?.lastGrade) return;
  const deck = state.currentDeck;
  const u = sess.lastGrade;

  // Restore in-memory session + deck state
  deck.cardStates[u.cardId] = u.prevCardState;
  deck.todayCounts = u.prevTodayCounts;
  sess.index = u.prevIndex;
  sess.showingAnswer = true;
  sess.cardsSeen = Math.max(0, sess.cardsSeen - 1);
  if (u.grade >= 2) sess.correct = Math.max(0, sess.correct - 1);
  sess.gradedBreakdown[u.grade] = Math.max(0, sess.gradedBreakdown[u.grade] - 1);
  sess.timeMs = Math.max(0, sess.timeMs - u.dtMs);
  if (u.reinserted && sess.queue.length > u.prevQueueLen) sess.queue.pop();

  await Storage.updateDeckState(deck.id, (rec) => {
    rec.cardStates = deck.cardStates;
    rec.todayCounts = deck.todayCounts;
    return rec;
  });
  await Storage.updateLibraryEntry(deck.id, (rec) => {
    rec.counts = Storage.computeCountsFromStates(deck.cardStates);
    rec.todayCounts = deck.todayCounts;
    // Revert today's per-deck totals (streak intentionally left alone).
    const today = Storage.todayKey();
    const day = (rec.historyByDay || {})[today];
    if (day) {
      day.reviewed = Math.max(0, (day.reviewed || 0) - 1);
      day.timeMs = Math.max(0, (day.timeMs || 0) - u.dtMs);
    }
    return rec;
  });

  sess.lastGrade = null;
  updateUndoButton();
  renderCurrentCard();
}

function updateUndoButton() {
  const btn = document.getElementById('undo-btn');
  if (!btn) return;
  btn.disabled = !state.session?.lastGrade;
}

async function setCurrentCardColor(colorName) {
  const sess = state.session;
  if (!sess) return;
  const deck = state.currentDeck;
  const cardId = currentCardId();
  const cs = deck.cardStates[cardId];
  if (!cs) return;
  cs.color = colorName || null;
  await Storage.updateDeckState(deck.id, (rec) => { rec.cardStates = deck.cardStates; return rec; });
  applyCardColorVisual(cs.color);
}

function openStudyColorPicker() {
  const btn = document.getElementById('card-color-btn');
  const cs = state.currentDeck?.cardStates[currentCardId()];
  openPopover(btn, colorPickerHtml(cs?.color || null), (pop) => {
    pop.querySelectorAll('.color-chip').forEach((chip) => {
      chip.addEventListener('click', async () => {
        await setCurrentCardColor(chip.dataset.color || null);
        closePopover();
      });
    });
  });
}

async function accrueDailyTotals(deckId, cardsDelta, timeDeltaMs) {
  const today = Storage.todayKey();
  await Storage.updateLibraryEntry(deckId, (rec) => {
    rec.historyByDay = rec.historyByDay || {};
    const day = rec.historyByDay[today] || { reviewed: 0, timeMs: 0 };
    day.reviewed += cardsDelta;
    day.timeMs += timeDeltaMs;
    rec.historyByDay[today] = day;
    rec.lastStudiedAt = new Date().toISOString();
    return rec;
  });
  const streak = (await Storage.getMeta('streak')) || { current: 0, lastDay: null };
  if (streak.lastDay !== today) {
    if (streak.lastDay === dayOffset(today, -1)) streak.current += 1;
    else streak.current = 1;
    streak.lastDay = today;
    await Storage.setMeta('streak', streak);
  }
}

function sessionTimeLimitReached() {
  const sess = state.session;
  if (!sess) return false;
  const limitMin = state.settings.sessionLengthMin;
  if (!limitMin || limitMin <= 0) return false;
  return (Date.now() - sess.startedMs) >= limitMin * 60 * 1000;
}

function updateSessionRemainingDisplay() {
  const el = document.getElementById('session-remaining');
  if (!el) return;
  const sess = state.session;
  const limitMin = state.settings.sessionLengthMin;
  if (!sess || !limitMin || limitMin <= 0) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const remainMs = Math.max(0, limitMin * 60 * 1000 - (Date.now() - sess.startedMs));
  el.textContent = `⏳ ${formatDuration(remainMs)} left`;
}

// End session → summary toast, then back to home.
function finishSession() {
  const sess = state.session;
  const stats = sess && sess.cardsSeen > 0 ? {
    reviewed: sess.cardsSeen,
    correctPct: Math.round((sess.correct / sess.cardsSeen) * 100),
    timeMs: Date.now() - sess.startedMs,
    breakdown: sess.gradedBreakdown,
  } : null;
  releaseMediaUrls();
  state.session = null;
  state.currentDeck = null;
  showScreen('home');
  document.body.classList.remove('study-scrolled');
  refreshHome();
  if (stats) showSessionToast(stats);
}

function showSessionToast({ reviewed, correctPct, timeMs, breakdown }) {
  const toast = document.getElementById('session-toast');
  document.getElementById('toast-title').textContent = `Session complete — ${reviewed} reviewed`;
  document.getElementById('toast-stats').textContent =
    `${correctPct}% correct · ${formatDuration(timeMs)} · ` +
    `${breakdown[0]}A · ${breakdown[1]}H · ${breakdown[2]}G · ${breakdown[3]}E`;
  toast.classList.remove('hidden');
  clearTimeout(showSessionToast._t);
  showSessionToast._t = setTimeout(() => toast.classList.add('hidden'), 4500);
}

// -------- keyboard --------
function bindGlobalKeys() {
  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input,textarea,select')) return;
    if (state.screen === 'study') {
      const sess = state.session;
      if (!sess) return;
      if (!sess.showingAnswer) {
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flipCard(); }
      } else {
        if (e.key === '1') { e.preventDefault(); gradeCurrent(0); }
        else if (e.key === '2') { e.preventDefault(); gradeCurrent(1); }
        else if (e.key === '3' || e.key === ' ' || e.key === 'Enter') { e.preventDefault(); gradeCurrent(2); }
        else if (e.key === '4') { e.preventDefault(); gradeCurrent(3); }
      }
      if (e.key === 'r' || e.key === 'R') { e.preventDefault(); replayAudio(); }
      if (e.key === 'c' || e.key === 'C') { e.preventDefault(); openStudyColorPicker(); }
      if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); undoLastGrade(); }
      if (e.key === 'Escape') { e.preventDefault(); finishSession(); }
    }
  });

  document.getElementById('flip-btn').addEventListener('click', flipCard);
  document.querySelector('.card-wrap').addEventListener('click', (e) => {
    if (e.target.closest('audio, video, a, button')) return;
    if (state.session && !state.session.showingAnswer) flipCard();
  });
  document.querySelectorAll('#grade-row [data-grade]').forEach((btn) => {
    btn.addEventListener('click', () => gradeCurrent(parseInt(btn.dataset.grade, 10)));
  });
  document.getElementById('study-back-btn').addEventListener('click', finishSession);
  document.getElementById('card-color-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    openStudyColorPicker();
  });
  document.getElementById('undo-btn').addEventListener('click', undoLastGrade);
  document.getElementById('replay-btn').addEventListener('click', replayAudio);
  document.getElementById('toast-dismiss').addEventListener('click', () => {
    document.getElementById('session-toast').classList.add('hidden');
  });

  setInterval(() => {
    if (state.screen === 'study' && state.session) {
      const t = document.getElementById('session-timer');
      if (t) t.textContent = formatDuration(Date.now() - state.session.startedMs);
      updateSessionRemainingDisplay();
      if (sessionTimeLimitReached()) finishSession();
    }
  }, 1000);
}

function replayAudio() {
  document.querySelectorAll('#card-inner audio').forEach((a) => {
    try { a.currentTime = 0; a.volume = state.settings.volume; a.play(); } catch (_) {}
  });
}

// -------- touch swipe gestures on the study card --------
function bindStudyTouchGestures() {
  const wrap = document.querySelector('.card-wrap');
  if (!wrap) return;

  const SWIPE_MIN = 45;      // px — below this counts as a tap
  const SWIPE_DIR_RATIO = 1.4; // dominant axis must exceed other by this ratio
  let sx = 0, sy = 0, tracking = false;

  wrap.addEventListener('touchstart', (e) => {
    // Ignore multi-touch (pinch) and taps on interactive children.
    if (e.touches.length > 1) { tracking = false; return; }
    if (e.target.closest('audio, video, a, button')) { tracking = false; return; }
    tracking = true;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    clearSwipeHint();
  }, { passive: true });

  wrap.addEventListener('touchmove', (e) => {
    if (!tracking || !state.session) return;
    const dx = e.touches[0].clientX - sx;
    const dy = e.touches[0].clientY - sy;
    if (Math.abs(dx) < 20 && Math.abs(dy) < 20) return;
    if (!state.session.showingAnswer) return; // only hint on answer side
    const absX = Math.abs(dx), absY = Math.abs(dy);
    clearSwipeHint();
    if (absX > absY * SWIPE_DIR_RATIO) {
      wrap.classList.add(dx < 0 ? 'swipe-arrow-again' : 'swipe-arrow-good');
    } else if (absY > absX * SWIPE_DIR_RATIO) {
      wrap.classList.add(dy < 0 ? 'swipe-arrow-easy' : 'swipe-arrow-hard');
    }
  }, { passive: true });

  wrap.addEventListener('touchend', (e) => {
    if (!tracking || !state.session) { clearSwipeHint(); return; }
    tracking = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy;
    clearSwipeHint();
    const absX = Math.abs(dx), absY = Math.abs(dy);
    if (absX < SWIPE_MIN && absY < SWIPE_MIN) return; // tap — let click handler flip
    const sess = state.session;
    if (!sess.showingAnswer) {
      // Any decisive swipe on the question side flips the card.
      flipCard();
      e.preventDefault();
      return;
    }
    // Answer side: map direction to grade.
    if (absX > absY * SWIPE_DIR_RATIO) {
      gradeCurrent(dx < 0 ? 0 : 2); // ← Again, → Good
    } else if (absY > absX * SWIPE_DIR_RATIO) {
      gradeCurrent(dy < 0 ? 3 : 1); // ↑ Easy, ↓ Hard
    }
    e.preventDefault();
  });

  wrap.addEventListener('touchcancel', () => { tracking = false; clearSwipeHint(); });

  function clearSwipeHint() {
    wrap.classList.remove('swipe-arrow-again', 'swipe-arrow-good', 'swipe-arrow-hard', 'swipe-arrow-easy');
  }
}

// -------- Compact header when scrolling on study screen --------
function bindStudyScrollCompact() {
  const onScroll = () => {
    if (state.screen !== 'study') { document.body.classList.remove('study-scrolled'); return; }
    document.body.classList.toggle('study-scrolled', window.scrollY > 60);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
}

// -------- progress export/import --------
async function onExportProgress() {
  const payload = await Storage.exportProgressJson();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  a.href = url; a.download = `ankiportable-progress-${stamp}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function onImportProgress(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  try {
    const payload = JSON.parse(text);
    await Storage.importProgressJson(payload);
    alert('Progress restored. Note: this only restores per-card SR state — deck cards/media must already be imported.');
    await refreshHome();
  } catch (err) {
    alert('Failed to import progress: ' + err.message);
  }
  e.target.value = '';
}

// -------- helpers --------
function showScreen(name) {
  state.screen = name;
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  document.getElementById(name).classList.add('active');
}

function scopeCss(css, selector) {
  if (!css) return '';
  return css.replace(/(^|})\s*([^@}{][^{}]*)\{/g, (_m, brace, sel) => {
    const scoped = sel.split(',').map((s) => `${selector} ${s.trim()}`).join(', ');
    return `${brace} ${scoped} {`;
  });
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${rem}s`;
}

function relTime(iso) {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const s = Math.floor((now - then) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function dayOffset(dayKey, delta) {
  const [y, m, d] = dayKey.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
