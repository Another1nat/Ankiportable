// Mustache-lite card renderer + media rewriting + note-type CSS scoping.
// Understands: {{Field}}, {{#Field}}...{{/Field}}, {{^Field}}...{{/Field}},
// {{FrontSide}}, {{cN::text::hint}} cloze deletions.

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderField(value) {
  return value == null ? '' : String(value);
}

// Very-lightweight mustache-lite (Anki templates only use these forms).
function renderTemplate(tmpl, fields, extras = {}) {
  let out = tmpl;

  // Sections: {{#Name}}...{{/Name}} — show if non-empty. Do inverted first
  // via a distinct sigil so patterns don't collide.
  // Handle nested by iterating until fixpoint (templates rarely nest deep).
  for (let i = 0; i < 5; i++) {
    let changed = false;
    out = out.replace(/\{\{#([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_m, name, inner) => {
      changed = true;
      const v = fields[name.trim()];
      return (v != null && String(v).trim() !== '') ? inner : '';
    });
    out = out.replace(/\{\{\^([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_m, name, inner) => {
      changed = true;
      const v = fields[name.trim()];
      return (v == null || String(v).trim() === '') ? inner : '';
    });
    if (!changed) break;
  }

  // {{FrontSide}} — inject rendered front (for afmt)
  if (extras.frontSide != null) {
    out = out.replace(/\{\{FrontSide\}\}/g, extras.frontSide);
  }

  // Field substitutions with optional filters like {{text:Field}} or {{type:Field}}.
  // We ignore filters; just substitute the field value.
  out = out.replace(/\{\{([^}]+)\}\}/g, (m, name) => {
    const raw = name.trim();
    // Strip filter prefixes ("text:", "type:", "furigana:", "cloze:", etc.)
    const parts = raw.split(':');
    const key = parts[parts.length - 1].trim();
    if (key === 'FrontSide') return '';
    if (fields.hasOwnProperty(key)) {
      const isCloze = parts.some((p) => p.trim() === 'cloze');
      return isCloze ? renderField(fields[key]) : renderField(fields[key]);
    }
    return '';
  });

  return out;
}

// Cloze processing: transform {{c1::answer::hint}} within a field value.
// side='question' hides the target cloze (shows [...] or hint), reveals others as-is.
// side='answer' reveals target, others revealed too.
function processCloze(text, targetOrd, side) {
  if (!text) return text;
  const targetNum = targetOrd + 1; // ord is 0-indexed, cloze numbers 1-indexed
  return text.replace(/\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g, (_m, num, answer, hint) => {
    const n = parseInt(num, 10);
    if (side === 'question' && n === targetNum) {
      const label = hint ? hint : '...';
      return `<span class="cloze">[${label}]</span>`;
    }
    return `<span class="cloze">${answer}</span>`;
  });
}

function isClozeModel(model) {
  return Number(model.type) === 1;
}

function buildFieldMap(note, model) {
  const map = {};
  const names = model.flds.map((f) => f.name);
  for (let i = 0; i < names.length; i++) {
    map[names[i]] = note.fields[i] ?? '';
  }
  map.Tags = note.tags || '';
  return map;
}

// Rewrite Anki media references in HTML:
//   [sound:name.mp3]  → <audio controls autoplay src="blob:..."></audio>
//   <img src="name.jpg"> → <img src="blob:...">
//   also <source src="...">, <video src="...">
function rewriteMedia(html, mediaUrlMap) {
  if (!html) return '';
  let out = html;

  // [sound:xxx] — no autoplay attribute; the app controls playback so we
  // can gate audio to answer-only, both sides, or off.
  out = out.replace(/\[sound:([^\]]+)\]/g, (_m, name) => {
    const url = mediaUrlMap[name.trim()];
    if (!url) return '';
    return `<audio controls preload="auto" data-anki-media="${escapeHtml(name)}" src="${url}"></audio>`;
  });

  // src="..." attribute rewriting — only if bare filename (no scheme, no path)
  out = out.replace(/(<(?:img|audio|video|source)\b[^>]*\s(?:src))\s*=\s*(['"])([^'"]+)\2/gi,
    (m, prefix, quote, val) => {
      if (/^(https?:|data:|blob:|file:|\/|\.\/|\.\.\/)/i.test(val)) return m;
      const name = decodeURIComponent(val.split('?')[0].split('#')[0]);
      const url = mediaUrlMap[name];
      if (url) return `${prefix}=${quote}${url}${quote}`;
      // Missing media: use a 1x1 transparent GIF so the browser doesn't
      // try to resolve the bare filename against the page URL (which
      // triggers the "Unsafe attempt to load URL file://…" warning on
      // file:// origins).
      return `${prefix}=${quote}data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==${quote}`;
    });

  // Strip empty src attributes (Anki templates sometimes emit <img src="">
  // when a field is blank). Empty src resolves to the page URL and warns.
  out = out.replace(/(<(?:img|audio|video|source)\b[^>]*)\ssrc\s*=\s*(['"])\s*\2/gi, '$1');

  return out;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Render one card face (question or answer). Returns { html, css }.
// card: { nid, ord }
// context: { notes, models, mediaUrlMap }
function renderCard(card, side, context) {
  const note = context.notes[card.nid];
  if (!note) return { html: '<em>Missing note</em>', css: '' };
  const model = context.models[note.mid];
  if (!model) return { html: '<em>Missing model</em>', css: '' };

  const cloze = isClozeModel(model);

  // Build field map, optionally cloze-processing each field
  let fields = buildFieldMap(note, model);
  if (cloze) {
    const clozeSide = side; // 'question' or 'answer'
    const processed = {};
    for (const [k, v] of Object.entries(fields)) {
      processed[k] = processCloze(v, card.ord, clozeSide);
    }
    fields = processed;
  }

  // Pick template. Cloze note types have one template used for all clozes.
  const tmpl = cloze ? model.tmpls[0] : (model.tmpls[card.ord] || model.tmpls[0]);
  if (!tmpl) return { html: '<em>No template</em>', css: '' };

  let html;
  if (side === 'question') {
    html = renderTemplate(tmpl.qfmt, fields);
  } else {
    const front = renderTemplate(tmpl.qfmt, fields);
    html = renderTemplate(tmpl.afmt, fields, { frontSide: front });
  }

  html = rewriteMedia(html, context.mediaUrlMap);
  return { html, css: model.css || '' };
}

window.CardRenderer = { renderCard, isClozeModel, buildFieldMap };
