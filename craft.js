// Craft's API, for the collections in a handful of named documents.
//
// Connections come from tasks. (same site, so the same browser storage), plus
// an optional one of media.'s own. Only "All Documents" and "Selected
// Documents" connections expose /documents and /collections.

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export { esc };

// Only the link ID matters, so anything around it in a paste is ignored.
export function apiBase(url) {
  const u = String(url || "").trim();
  const m = u.match(/^(?:https?:\/\/)?(connect\.craft\.do\/links\/[^/?#\s]+)/i);
  return m ? `https://${m[1]}/api/v1` : u.replace(/\/+$/, "");
}

export function connections(own) {
  let tasks = {};
  try { tasks = JSON.parse(localStorage.getItem("tasks.settings") || "{}"); } catch { /* private mode */ }
  const list = [];
  if (own?.url) list.push({ id: "media", label: "media.", url: own.url, key: own.key });
  const labels = { my: "my space.", work: "work." };
  for (const [id, s] of Object.entries(tasks.spaces || {})) {
    if (s?.url && !list.some(c => apiBase(c.url) === apiBase(s.url))) list.push({ id, label: labels[id] || id, url: s.url, key: s.key });
  }
  return list;
}

export async function craft(conn, path, options = {}) {
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  // A pasted key can carry invisible characters that a header cannot hold.
  const key = String(conn.key || "").replace(/[\s ​-‍﻿]/g, "");
  if (key) headers.Authorization = `Bearer ${key}`;
  const resp = await fetch(apiBase(conn.url) + path, { ...options, headers });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    let detail = body;
    try { const j = JSON.parse(body); detail = j.error || j.message || body; } catch { /* not JSON */ }
    if (typeof detail !== "string") detail = JSON.stringify(detail);
    const err = new Error(`${resp.status}${detail ? ` — ${detail.slice(0, 160)}` : ""}`);
    err.status = resp.status;
    throw err;
  }
  return resp.json();
}

// ─── Shapes ──────────────────────────────────────────────────────────
// Craft's docs show two spellings of the same thing ("select" with plain
// option strings, "singleSelect" with {name, color}), so both are accepted.
const TYPE = { select: "singleSelect", checkbox: "boolean", multiselect: "multiSelect" };
const optName = (o) => typeof o === "string" ? o : (o?.name ?? o?.value ?? "");

export function normaliseSchema(raw, fallbackName) {
  const s = raw?.schema && !raw.properties ? raw.schema : raw || {};
  const list = s.propertyDetails?.length ? s.propertyDetails : s.properties || [];
  return {
    name: s.name || fallbackName || "Collection",
    titleName: s.contentPropDetails?.name || "Title",
    props: list.map(p => ({
      key: p.key || p.name,
      name: p.name || p.key,
      type: TYPE[p.type] || TYPE[String(p.type).toLowerCase()] || p.type || "text",
      options: (p.options || []).map(o => ({ name: optName(o), color: o?.color })).filter(o => o.name),
      config: p.config,
    })),
  };
}

// A title may come back as a string or as rich text.
export function plain(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(plain).join(", ");
  return plain(v.markdown ?? v.text ?? v.name ?? v.value ?? v.title ?? "");
}
export const stripMd = (s) => plain(s).replace(/<\/?[a-z][^>]*>/gi, "").replace(/[*_~`]+/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").trim();

export function normaliseItem(raw) {
  return {
    id: raw.id,
    title: stripMd(raw.title),
    props: raw.properties || {},
    preview: stripMd(raw.contentPreview || ""),
  };
}

// ─── Loading ─────────────────────────────────────────────────────────
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Finds each named document in the first connection that has it, then every
// collection inside it. Returns what it found and what it couldn't.
export async function loadAll(conns, docNames) {
  const wanted = docNames.map(n => ({ name: n, key: norm(n), found: null }));
  const problems = [];
  for (const conn of conns) {
    if (wanted.every(w => w.found)) break;
    let docs;
    try {
      docs = (await craft(conn, "/documents")).items || [];
    } catch (err) {
      problems.push(`${conn.label} ${err.status === 404 ? "can’t list documents (it’s a Daily Notes connection)" : `failed: ${err.message}`}`);
      continue;
    }
    for (const w of wanted) {
      if (w.found) continue;
      const doc = docs.find(d => !d.isDeleted && norm(stripMd(d.title)) === w.key)
        || docs.find(d => !d.isDeleted && norm(stripMd(d.title)).includes(w.key));
      if (doc) w.found = { conn, doc };
    }
  }

  const collections = [];
  for (const w of wanted) {
    if (!w.found) { problems.push(`Couldn’t find a document called “${w.name}”`); continue; }
    const { conn, doc } = w.found;
    const docTitle = stripMd(doc.title) || w.name;
    let cols;
    try {
      cols = (await craft(conn, `/collections?documentIds=${encodeURIComponent(doc.id)}`)).items || [];
    } catch (err) {
      problems.push(`“${docTitle}”: ${err.message}`);
      continue;
    }
    if (!cols.length) problems.push(`“${docTitle}” has no collections`);
    const loaded = await Promise.all(cols.map(async (c) => {
      const [schema, items] = await Promise.all([
        craft(conn, `/collections/${encodeURIComponent(c.id)}/schema?format=schema`).catch(() => c.schema),
        craft(conn, `/collections/${encodeURIComponent(c.id)}/items?maxDepth=0`),
      ]);
      const sc = normaliseSchema(schema, c.name);
      return {
        id: c.id, connId: conn.id, docTitle, docName: w.name,
        name: c.name || sc.name, schema: sc,
        items: (items.items || []).map(normaliseItem),
      };
    }).map(p => p.catch(err => { problems.push(`“${docTitle}”: ${err.message}`); return null; })));
    collections.push(...loaded.filter(Boolean));
  }
  return { collections, problems };
}

export const updateItem = (conn, colId, id, title, props, allowNew) =>
  craft(conn, `/collections/${encodeURIComponent(colId)}/items`, {
    method: "PUT",
    body: JSON.stringify({ itemsToUpdate: [{ id, ...(title != null ? { title } : {}), properties: props }], allowNewSelectOptions: Boolean(allowNew) }),
  });

export const addItem = (conn, colId, title, props, allowNew) =>
  craft(conn, `/collections/${encodeURIComponent(colId)}/items`, {
    method: "POST",
    body: JSON.stringify({ items: [{ title, properties: props }], allowNewSelectOptions: Boolean(allowNew) }),
  });

export const deleteItem = (conn, colId, id) =>
  craft(conn, `/collections/${encodeURIComponent(colId)}/items`, {
    method: "DELETE",
    body: JSON.stringify({ idsToDelete: [id] }),
  });

// The item's own page: the review or notes written inside it.
export async function itemContent(conn, id) {
  const data = await craft(conn, `/blocks?id=${encodeURIComponent(id)}&maxDepth=-1`);
  const out = [];
  const walk = (b, depth) => {
    if (!b) return;
    if (depth > 0 && b.markdown) out.push(b.markdown);
    for (const c of b.content || b.blocks || []) walk(c, depth + 1);
  };
  if (Array.isArray(data.items)) data.items.forEach(b => walk(b, 0)); else walk(data, 0);
  return out;
}
