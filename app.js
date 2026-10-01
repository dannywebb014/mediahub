import * as C from "./craft.js";

// ?demo swaps Craft for made-up collections held in memory.
const DEMO = new URLSearchParams(location.search).has("demo");
const api = DEMO ? await import("./demo.js") : C;
const { esc } = C;
const $ = (id) => document.getElementById(id);

// ─── Storage ─────────────────────────────────────────────────────────
const SETTINGS_KEY = DEMO ? "media.demo" : "media.settings";
const CACHE_KEY = "media.cache";
const UI_KEY = DEMO ? "media.demo-ui" : "media.ui";
const DEFAULT_DOCS = ["Media List", "Music Reviews"];

const read = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

let settings = { docs: DEFAULT_DOCS, own: {}, theme: "system", ...read(SETTINGS_KEY, {}) };
let ui = { active: null, views: {}, ...read(UI_KEY, {}) };   // views[colId] = { q, filters, sort }
let collections = DEMO ? [] : read(CACHE_KEY, {}).collections || [];
let problems = [];
let loading = false;

const conns = () => DEMO ? [{ id: "demo", label: "demo" }] : C.connections(settings.own);
const connFor = (col) => conns().find(c => c.id === col.connId) || conns()[0];
const saveUi = () => write(UI_KEY, ui);
const view = (col) => (ui.views[col.id] ||= { q: "", filters: {}, sort: "craft" });

function applyTheme() {
  if (settings.theme === "light" || settings.theme === "dark") document.documentElement.dataset.theme = settings.theme;
  else delete document.documentElement.dataset.theme;
}
applyTheme();

// ─── Toasts ──────────────────────────────────────────────────────────
// Every failed write says so: a change that silently didn't reach Craft is
// worse than one that visibly failed.
function toast(msg, kind = "") {
  const t = document.createElement("div");
  t.className = `toast ${kind}`;
  t.textContent = msg;
  $("toasts").append(t);
  setTimeout(() => t.classList.add("out"), kind === "err" ? 6000 : 2200);
  setTimeout(() => t.remove(), kind === "err" ? 6500 : 2700);
}

// ─── Property helpers ────────────────────────────────────────────────
const RATING = /rating|score|stars?|out of/i;
const LONG = /review|notes?|thoughts|comment|summary|description|verdict text/i;
const isRating = (p) => p.type === "number" && RATING.test(p.name);
const isLong = (p, v) => p.type === "text" && (LONG.test(p.name) || String(v || "").length > 70);
const val = (it, p) => it.props[p.key];
const names = (v) => (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]).map(C.plain).filter(Boolean);
const isEmpty = (v) => v == null || v === "" || (Array.isArray(v) && !v.length);

function ratingScale(col, p) {
  const top = Math.max(0, ...col.items.map(i => Number(val(i, p)) || 0));
  return top > 5 ? 10 : 5;
}
function stars(n, scale) {
  if (n == null || n === "" || isNaN(n)) return "";
  const v = Number(n);
  if (scale > 5) return `<span class="score"><b>${esc(v)}</b>/${scale}</span>`;
  return `<span class="stars" aria-label="${v} out of 5">${"★".repeat(Math.round(v))}<i>${"★".repeat(Math.max(0, 5 - Math.round(v)))}</i></span>`;
}

function fmtDate(v) {
  const s = C.plain(v);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return s;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

// Filter rows come from select properties, status-like ones first.
function filterProps(col) {
  const sel = col.schema.props.filter(p => p.type === "singleSelect" && p.options.length);
  const rank = (p) => /status|state|progress|verdict/i.test(p.name) ? 0 : /type|kind|format|medium|category/i.test(p.name) ? 1 : 2;
  return sel.sort((a, b) => rank(a) - rank(b)).slice(0, 2);
}

// Option colours: Craft's names where it gives them, otherwise by position.
const PALETTE = ["yellow", "mint-green", "sky-blue", "lavender", "pink", "aqua-blue", "lime", "red", "gray"];
function optColour(p, name) {
  const i = p.options.findIndex(o => o.name === name);
  return (i >= 0 && p.options[i].color) || PALETTE[(i < 0 ? 8 : i) % PALETTE.length];
}

// ─── Loading ─────────────────────────────────────────────────────────
async function load() {
  if (loading) return;
  if (!DEMO && !conns().length) { render(); return; }
  loading = true;
  render();
  try {
    const res = await api.loadAll(conns(), settings.docs);
    collections = res.collections;
    problems = res.problems;
    if (!DEMO) write(CACHE_KEY, { collections, at: Date.now() });
  } catch (err) {
    problems = [`Couldn’t load from Craft: ${err.message}`];
  }
  loading = false;
  render();
}

// ─── Rendering ───────────────────────────────────────────────────────
const docs = () => {
  const order = settings.docs.map(d => d.toLowerCase());
  const seen = [...new Set(collections.map(c => c.docName))];
  return seen.sort((a, b) => order.indexOf(a.toLowerCase()) - order.indexOf(b.toLowerCase()));
};
const active = () => collections.find(c => c.id === ui.active) || collections[0];

function render() {
  const col = active();
  $("refresh").classList.toggle("spin", loading);
  renderDocs(col);
  renderCols(col);
  renderNotices();
  if (!col) {
    $("toolbar").hidden = true;
    $("add").hidden = true;
    $("list").innerHTML = loading ? `<p class="empty">Loading your collections…</p>` : "";
    return;
  }
  $("toolbar").hidden = false;
  $("add").hidden = false;
  renderToolbar(col);
  renderList(col);
}

function renderDocs(col) {
  const box = $("docs");
  const ds = docs();
  box.hidden = ds.length < 2;
  box.innerHTML = ds.map(d => {
    const n = collections.filter(c => c.docName === d).reduce((s, c) => s + c.items.length, 0);
    return `<button type="button" role="tab" aria-selected="${col?.docName === d}" data-doc="${esc(d)}">${esc(d)}<span class="n">${n}</span></button>`;
  }).join("");
}

function renderCols(col) {
  const box = $("cols");
  const mine = col ? collections.filter(c => c.docName === col.docName) : [];
  box.hidden = mine.length < 2;
  box.innerHTML = mine.map(c => `<button type="button" class="pill${c.id === col.id ? " on" : ""}" data-col="${esc(c.id)}">${esc(c.name)} <span class="n">${c.items.length}</span></button>`).join("");
}

function renderNotices() {
  const box = $("notices");
  const lines = [];
  if (!DEMO && !conns().length) {
    lines.push(`<div class="notice"><b>Connect Craft to start.</b> media. uses the Craft connections saved in tasks. on this device. None were found, so add one in <button type="button" class="linkish" data-open-settings>Settings</button>, or try the <a href="?demo">demo</a>.</div>`);
  }
  for (const p of problems) lines.push(`<div class="notice err">${esc(p)}</div>`);
  box.innerHTML = lines.join("");
}

function renderToolbar(col) {
  const v = view(col);
  const fps = filterProps(col);
  $("search").value = v.q;
  $("search").placeholder = `Search ${col.name.toLowerCase()}`;
  $("filters").innerHTML = fps.map(p => {
    const counts = Object.fromEntries(p.options.map(o => [o.name, 0]));
    for (const it of col.items) for (const n of names(val(it, p))) counts[n] = (counts[n] || 0) + 1;
    const cur = v.filters[p.key];
    const chips = Object.entries(counts).filter(([, n]) => n > 0)
      .map(([name, n]) => `<button type="button" class="chip c-${esc(optColour(p, name))}${cur === name ? " on" : ""}" data-fkey="${esc(p.key)}" data-fval="${esc(name)}">${esc(name)} <span class="n">${n}</span></button>`).join("");
    return chips ? `<div class="chips" aria-label="${esc(p.name)}"><button type="button" class="chip all${cur ? "" : " on"}" data-fkey="${esc(p.key)}" data-fval="">All</button>${chips}</div>` : "";
  }).join("");

  const sorts = [["craft", "Craft order"], ["title", `${col.schema.titleName} A–Z`]];
  const rp = col.schema.props.find(isRating);
  if (rp) sorts.push(["rating", "Highest rated"]);
  const dp = col.schema.props.find(p => p.type === "date");
  if (dp) sorts.push(["date", `${dp.name}, newest`]);
  if (!sorts.some(s => s[0] === v.sort)) v.sort = "craft";
  $("sort").innerHTML = sorts.map(([k, l]) => `<option value="${k}"${k === v.sort ? " selected" : ""}>${esc(l)}</option>`).join("");
}

function visibleItems(col) {
  const v = view(col);
  const q = v.q.trim().toLowerCase();
  let items = col.items.filter(it => {
    for (const [k, want] of Object.entries(v.filters)) {
      if (!want) continue;
      const p = col.schema.props.find(p => p.key === k);
      if (p && !names(val(it, p)).includes(want)) return false;
    }
    if (!q) return true;
    const hay = [it.title, it.preview, ...col.schema.props.map(p => names(val(it, p)).join(" "))].join(" ").toLowerCase();
    return hay.includes(q);
  });
  const rp = col.schema.props.find(isRating);
  const dp = col.schema.props.find(p => p.type === "date");
  if (v.sort === "title") items = [...items].sort((a, b) => a.title.localeCompare(b.title, "en", { sensitivity: "base" }));
  if (v.sort === "rating" && rp) items = [...items].sort((a, b) => (Number(val(b, rp)) || -1) - (Number(val(a, rp)) || -1));
  if (v.sort === "date" && dp) items = [...items].sort((a, b) => String(C.plain(val(b, dp)) || "").localeCompare(String(C.plain(val(a, dp)) || "")));
  return items;
}

function card(col, it) {
  const props = col.schema.props;
  const sub = props.find(p => p.type === "text" && !isLong(p, val(it, p)) && !isEmpty(val(it, p)));
  const fps = filterProps(col).map(p => p.key);
  const tags = [];
  for (const p of props) {
    const v = val(it, p);
    if (isEmpty(v)) continue;
    if (p.type === "singleSelect" || p.type === "multiSelect") {
      for (const n of names(v)) tags.push(`<span class="tag c-${esc(optColour(p, n))}${fps.includes(p.key) ? " strong" : ""}">${esc(n)}</span>`);
    } else if (p.type === "date") {
      tags.push(`<span class="meta" title="${esc(p.name)}">${esc(fmtDate(v))}</span>`);
    } else if (p.type === "boolean" && v === true) {
      tags.push(`<span class="meta">✓ ${esc(p.name)}</span>`);
    }
  }
  const rp = props.find(isRating);
  const rating = rp ? stars(val(it, rp), ratingScale(col, rp)) : "";
  const longP = props.find(p => isLong(p, val(it, p)) && !isEmpty(val(it, p)));
  const snippet = longP ? C.plain(val(it, longP)) : it.preview;
  return `<button type="button" class="item" data-item="${esc(it.id)}">
    <div class="item-top">
      <span class="item-title">${esc(it.title || "Untitled")}</span>
      ${rating}
    </div>
    ${sub ? `<div class="item-sub">${esc(C.plain(val(it, sub)))}</div>` : ""}
    ${tags.length ? `<div class="item-tags">${tags.join("")}</div>` : ""}
    ${snippet ? `<p class="item-snip">${esc(snippet)}</p>` : ""}
  </button>`;
}

function renderList(col) {
  const items = visibleItems(col);
  const v = view(col);
  const filtered = v.q || Object.values(v.filters).some(Boolean);
  $("count").textContent = filtered ? `${items.length} of ${col.items.length}` : `${col.items.length} ${col.items.length === 1 ? "item" : "items"}`;
  $("heading").innerHTML = `${esc(col.name)}<span class="dot">.</span>`;
  $("list").innerHTML = items.length
    ? items.map(it => card(col, it)).join("")
    : `<p class="empty">${col.items.length ? "Nothing matches." : "Nothing here yet. Tap + to add the first one."}</p>`;
}

// ─── Switching ───────────────────────────────────────────────────────
function select(colId) {
  if (!collections.some(c => c.id === colId)) return;
  ui.active = colId;
  // Remembered per document, so switching back lands where you were.
  const col = collections.find(c => c.id === colId);
  (ui.lastByDoc ||= {})[col.docName] = colId;
  saveUi();
  render();
  window.scrollTo({ top: 0 });
}
function step(dir) {
  const flat = docs().flatMap(d => collections.filter(c => c.docName === d));
  const i = flat.indexOf(active());
  if (i < 0 || flat.length < 2) return;
  select(flat[(i + dir + flat.length) % flat.length].id);
}

$("docs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-doc]");
  if (!b) return;
  const d = b.dataset.doc;
  const last = ui.lastByDoc?.[d];
  const col = collections.find(c => c.id === last && c.docName === d) || collections.find(c => c.docName === d);
  if (col) select(col.id);
});
$("cols").addEventListener("click", (e) => {
  const b = e.target.closest("[data-col]");
  if (b) select(b.dataset.col);
});

$("filters").addEventListener("click", (e) => {
  const b = e.target.closest("[data-fkey]");
  if (!b) return;
  const v = view(active());
  const { fkey, fval } = b.dataset;
  v.filters[fkey] = v.filters[fkey] === fval ? "" : fval;
  saveUi();
  render();
});
$("search").addEventListener("input", (e) => { view(active()).q = e.target.value; saveUi(); renderList(active()); });
$("sort").addEventListener("change", (e) => { view(active()).sort = e.target.value; saveUi(); renderList(active()); });
$("refresh").addEventListener("click", load);

// Swipe sideways across the list to move between collections.
let touch = null;
$("list").addEventListener("touchstart", (e) => { const t = e.touches[0]; touch = { x: t.clientX, y: t.clientY, at: Date.now() }; }, { passive: true });
$("list").addEventListener("touchend", (e) => {
  if (!touch) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touch.x, dy = t.clientY - touch.y;
  if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2 && Date.now() - touch.at < 600) step(dx < 0 ? 1 : -1);
  touch = null;
}, { passive: true });

document.addEventListener("keydown", (e) => {
  if (e.target.closest("input, textarea, select, dialog[open]")) return;
  if (e.key === "ArrowRight") step(1);
  else if (e.key === "ArrowLeft") step(-1);
  else if (e.key === "/") { e.preventDefault(); $("search").focus(); }
  else if (e.key === "n" && active()) openItem(active(), null);
});

// ─── Item sheet ──────────────────────────────────────────────────────
const sheet = $("sheet");
let editing = null;   // { col, item (null when new), draft: { title, props }, newOptions }

$("list").addEventListener("click", (e) => {
  const b = e.target.closest("[data-item]");
  if (!b) return;
  const col = active();
  const it = col.items.find(i => i.id === b.dataset.item);
  if (it) openItem(col, it);
});
$("add").addEventListener("click", () => active() && openItem(active(), null));

function openItem(col, it) {
  const props = {};
  // A new item starts in whichever filter is showing.
  if (!it) for (const [k, v] of Object.entries(view(col).filters)) if (v) props[k] = v;
  editing = { col, item: it, draft: { title: it?.title || "", props: it ? structuredClone(it.props) : props }, newOptions: false };
  $("sheet-kicker").textContent = `${col.docTitle} · ${col.name}`;
  $("sheet-delete").hidden = !it;
  $("sheet-save").textContent = it ? "Save" : "Add";
  renderSheet();
  sheet.showModal();
  if (!it) setTimeout(() => sheet.querySelector("[data-title]")?.focus(), 50);
  const box = $("sheet-content");
  box.hidden = true;
  if (it) {
    api.itemContent(connFor(col), it.id).then(lines => {
      if (editing?.item !== it || !lines.length) return;
      box.hidden = false;
      box.innerHTML = `<h3>In Craft</h3>${lines.map(l => `<p>${esc(C.stripMd(l))}</p>`).join("")}`;
    }).catch(() => { /* the page content is a nice-to-have; the fields still work */ });
  }
}

function field(col, p) {
  const v = editing.draft.props[p.key];
  const label = `<label class="f">${esc(p.name)}</label>`;
  const k = esc(p.key);
  switch (p.type) {
    case "singleSelect":
    case "multiSelect": {
      const on = names(v);
      const opts = [...p.options.map(o => o.name), ...on.filter(n => !p.options.some(o => o.name === n))];
      return `${label}<div class="chips wrap">${opts.map(n => `<button type="button" class="chip c-${esc(optColour(p, n))}${on.includes(n) ? " on" : ""}" data-pick="${k}" data-val="${esc(n)}">${esc(n)}</button>`).join("")}<button type="button" class="chip ghost" data-newopt="${k}">+ New</button></div>`;
    }
    case "number": {
      if (isRating(p)) {
        const scale = ratingScale(col, p);
        const n = Number(v) || 0;
        return `${label}<div class="rate${scale > 5 ? " ten" : ""}">${Array.from({ length: scale }, (_, i) => `<button type="button" class="${i < n ? "on" : ""}" data-rate="${k}" data-val="${i + 1}" aria-label="${i + 1}">${scale > 5 ? i + 1 : "★"}</button>`).join("")}</div>`;
      }
      return `${label}<input class="field" type="number" inputmode="decimal" data-prop="${k}" value="${esc(v ?? "")}">`;
    }
    case "date":
      return `${label}<div class="row"><input class="field" type="date" data-prop="${k}" value="${esc(C.plain(v).slice(0, 10))}"><button type="button" class="btn small" data-today="${k}">Today</button></div>`;
    case "boolean":
      return `<label class="switch"><input type="checkbox" data-prop="${k}"${v === true ? " checked" : ""}><span></span>${esc(p.name)}</label>`;
    case "url":
      return `${label}<div class="row"><input class="field" type="url" inputmode="url" data-prop="${k}" value="${esc(C.plain(v))}" placeholder="https://">${v ? `<a class="btn small" href="${esc(C.plain(v))}" target="_blank" rel="noopener">Open</a>` : ""}</div>`;
    case "email":
    case "phone":
      return `${label}<input class="field" type="${p.type === "email" ? "email" : "tel"}" data-prop="${k}" value="${esc(C.plain(v))}">`;
    case "text":
      return isLong(p, v)
        ? `${label}<textarea class="field" rows="4" data-prop="${k}">${esc(C.plain(v))}</textarea>`
        : `${label}<input class="field" data-prop="${k}" value="${esc(C.plain(v))}">`;
    default:
      // Relations, formulas and the like are shown but edited in Craft.
      return isEmpty(v) ? "" : `${label}<p class="ro">${esc(names(v).join(", "))}</p>`;
  }
}

function renderSheet() {
  const { col, draft } = editing;
  $("sheet-fields").innerHTML =
    `<label class="f">${esc(col.schema.titleName)}</label><input class="field title" data-title value="${esc(draft.title)}" placeholder="${esc(col.schema.titleName)}">`
    + col.schema.props.map(p => `<div class="fwrap">${field(col, p)}</div>`).join("");
}

const propOf = (key) => editing.col.schema.props.find(p => p.key === key);
$("sheet-fields").addEventListener("input", (e) => {
  const t = e.target;
  if (t.matches("[data-title]")) editing.draft.title = t.value;
  else if (t.dataset.prop) {
    const p = propOf(t.dataset.prop);
    editing.draft.props[p.key] = p.type === "boolean" ? t.checked : p.type === "number" ? (t.value === "" ? null : Number(t.value)) : t.value;
  }
});
$("sheet-fields").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  const d = editing.draft.props;
  if (b.dataset.pick) {
    const p = propOf(b.dataset.pick);
    const n = b.dataset.val;
    if (p.type === "multiSelect") {
      const cur = names(d[p.key]);
      d[p.key] = cur.includes(n) ? cur.filter(x => x !== n) : [...cur, n];
    } else d[p.key] = names(d[p.key])[0] === n ? null : n;
  } else if (b.dataset.newopt) {
    const p = propOf(b.dataset.newopt);
    const n = prompt(`New ${p.name} option`)?.trim();
    if (!n) return;
    editing.newOptions = true;
    d[p.key] = p.type === "multiSelect" ? [...names(d[p.key]), n] : n;
  } else if (b.dataset.rate) {
    const n = Number(b.dataset.val);
    d[b.dataset.rate] = Number(d[b.dataset.rate]) === n ? null : n;
  } else if (b.dataset.today) {
    d[b.dataset.today] = today();
  } else return;
  renderSheet();
});

// Craft gets only what changed. Cleared values go as the type's empty value.
function emptyFor(p) {
  if (p.type === "multiSelect") return [];
  if (p.type === "boolean") return false;
  if (p.type === "text" || p.type === "url" || p.type === "email" || p.type === "phone") return "";
  return null;
}
function changes(col, before, after) {
  const out = {};
  for (const p of col.schema.props) {
    if (!["singleSelect", "multiSelect", "number", "date", "boolean", "url", "email", "phone", "text"].includes(p.type)) continue;
    const a = after[p.key], b = before[p.key];
    if (JSON.stringify(isEmpty(a) ? null : a) === JSON.stringify(isEmpty(b) ? null : b)) continue;
    out[p.key] = isEmpty(a) ? emptyFor(p) : a;
  }
  return out;
}

$("sheet-save").addEventListener("click", async () => {
  const { col, item, draft, newOptions } = editing;
  const title = draft.title.trim();
  if (!title) { sheet.querySelector("[data-title]").focus(); toast(`Give it a ${col.schema.titleName.toLowerCase()} first`); return; }
  const conn = connFor(col);
  const btn = $("sheet-save");
  btn.disabled = true;
  try {
    if (item) {
      const props = changes(col, item.props, draft.props);
      const titleChanged = title !== item.title;
      if (!titleChanged && !Object.keys(props).length) { sheet.close(); return; }
      const before = { title: item.title, props: structuredClone(item.props) };
      item.title = title;
      Object.assign(item.props, props);
      sheet.close();
      render();
      try {
        await api.updateItem(conn, col.id, item.id, titleChanged ? title : null, props, newOptions);
        toast("Saved to Craft");
      } catch (err) {
        Object.assign(item, before);
        render();
        toast(`Not saved: ${err.message}`, "err");
      }
    } else {
      const props = changes(col, {}, draft.props);
      const res = await api.addItem(conn, col.id, title, props, newOptions);
      const made = res.items?.[0];
      col.items.unshift(made ? { ...C.normaliseItem(made), title: C.stripMd(made.title) || title, props: { ...props, ...(made.properties || {}) } } : { id: `tmp-${Date.now()}`, title, props, preview: "" });
      sheet.close();
      render();
      toast("Added to Craft");
      if (!made) load();
    }
    if (newOptions) load();
    if (!DEMO) write(CACHE_KEY, { collections, at: Date.now() });
  } catch (err) {
    toast(`Not added: ${err.message}`, "err");
  } finally {
    btn.disabled = false;
  }
});

$("sheet-delete").addEventListener("click", async () => {
  const { col, item } = editing;
  if (!confirm(`Delete “${item.title}” from ${col.name} in Craft?`)) return;
  const at = col.items.indexOf(item);
  col.items.splice(at, 1);
  sheet.close();
  render();
  try {
    await api.deleteItem(connFor(col), col.id, item.id);
    toast("Deleted");
    if (!DEMO) write(CACHE_KEY, { collections, at: Date.now() });
  } catch (err) {
    col.items.splice(at, 0, item);
    render();
    toast(`Not deleted: ${err.message}`, "err");
  }
});
$("sheet-close").addEventListener("click", () => sheet.close());
sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.close(); });
sheet.addEventListener("close", () => { editing = null; });

// ─── Settings ────────────────────────────────────────────────────────
const dlg = $("settings");
function openSettings() {
  const list = DEMO ? [] : C.connections(settings.own).filter(c => c.id !== "media");
  $("set-conns").innerHTML = DEMO
    ? `<p class="note">This is the demo. <a href="./">Leave the demo</a> to use your own Craft.</p>`
    : list.length
      ? `<p class="note">Using the Craft connection${list.length > 1 ? "s" : ""} saved in tasks.: ${list.map(c => `<b>${esc(c.label)}</b>`).join(", ")}.</p>`
      : `<p class="note">No connections from tasks. on this device. Paste a Craft API URL below.</p>`;
  $("set-docs").value = settings.docs.join("\n");
  $("set-url").value = settings.own?.url || "";
  $("set-key").value = settings.own?.key || "";
  $("set-theme").value = settings.theme;
  $("set-result").textContent = "";
  dlg.showModal();
}
$("open-settings").addEventListener("click", openSettings);
$("notices").addEventListener("click", (e) => { if (e.target.closest("[data-open-settings]")) openSettings(); });
$("set-theme").addEventListener("change", (e) => { settings.theme = e.target.value; applyTheme(); write(SETTINGS_KEY, settings); });
$("set-save").addEventListener("click", () => {
  const docsList = $("set-docs").value.split("\n").map(s => s.trim()).filter(Boolean);
  settings.docs = docsList.length ? docsList : DEFAULT_DOCS;
  settings.own = { url: $("set-url").value.trim(), key: $("set-key").value.trim() };
  write(SETTINGS_KEY, settings);
  dlg.close();
  load();
});
$("set-close").addEventListener("click", () => dlg.close());
dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });

// ─── Start ───────────────────────────────────────────────────────────
if (DEMO) $("brand").insertAdjacentHTML("beforeend", ` <a class="demo-tag" href="./">demo</a>`);
render();
load();
