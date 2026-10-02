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
    // Craft's "Validation failed" says why in the rest of the body, so keep all of it.
    let detail = body;
    try {
      const j = JSON.parse(body);
      const head = j.error || j.message || "";
      const rest = { ...j }; delete rest.error; delete rest.message;
      detail = [typeof head === "string" ? head : JSON.stringify(head), Object.keys(rest).length ? JSON.stringify(rest) : ""].filter(Boolean).join(": ");
    } catch { /* not JSON */ }
    const err = new Error(`${resp.status}${detail ? ` — ${detail.slice(0, 600)}` : ""}`);
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

// ─── Writing items ───────────────────────────────────────────────────
// Craft checks each item against the collection's own JSON Schema
// (format=json-schema-items), so values are shaped to it before sending:
// the property's real key, a number where it wants a number, a list where it
// wants a list, and nothing it doesn't know about.
const itemSchemas = new Map();
async function itemSchema(conn, colId) {
  if (!itemSchemas.has(colId)) {
    itemSchemas.set(colId, craft(conn, `/collections/${encodeURIComponent(colId)}/schema?format=json-schema-items`)
      .then((s) => s?.properties?.items?.items?.properties?.properties?.properties || null)
      .catch((err) => { console.warn("No item schema, sending values as they are:", err.message); itemSchemas.delete(colId); return null; }));
  }
  return itemSchemas.get(colId);
}

const types = (spec) => [].concat(spec?.type || []);
function coerce(value, spec) {
  if (value === null || value === undefined) return value;
  const t = types(spec);
  const want = t.find((x) => x !== "null") || "";
  if (want === "array") {
    const list = Array.isArray(value) ? value : String(value) === "" ? [] : [value];
    return list.map((v) => coerce(v, spec.items || {}));
  }
  if (Array.isArray(value)) value = value.join(", ");
  if (want === "number" || want === "integer") {
    const n = Number(value);
    return Number.isFinite(n) ? (want === "integer" ? Math.round(n) : n) : null;
  }
  if (want === "boolean") return value === true || value === "true";
  if (want === "string") {
    const text = String(value);
    if (spec.format === "date") return text.slice(0, 10);
    return text;
  }
  return value;
}

// props: { key: value } from the editor; meta: the collection's normalised props (for names).
async function shapeProps(conn, colId, props, meta = []) {
  const schema = await itemSchema(conn, colId);
  if (!schema) return props;
  const out = {};
  for (const [key, value] of Object.entries(props)) {
    const name = meta.find((p) => p.key === key)?.name;
    // The editor's key, or the property Craft describes by the same name.
    const target = key in schema ? key
      : Object.keys(schema).find((k) => schema[k]?.description === name || schema[k]?.title === name);
    if (!target) { console.warn(`Craft's schema has no property "${name || key}"; leaving it out.`); continue; }
    if ((value === null || value === "") && !types(schema[target]).includes("null") && types(schema[target])[0] !== "string") continue;
    out[target] = coerce(value, schema[target]);
  }
  return out;
}

// allowNewSelectOptions is in Craft's docs, but some connections reject it as an
// unrecognised key. It's only sent when a new option was actually made, and if
// Craft refuses it the request goes again without it.
async function writeItems(conn, colId, method, body, allowNew) {
  const path = `/collections/${encodeURIComponent(colId)}/items`;
  if (!allowNew) return craft(conn, path, { method, body: JSON.stringify(body) });
  try {
    return await craft(conn, path, { method, body: JSON.stringify({ ...body, allowNewSelectOptions: true }) });
  } catch (err) {
    if (err.status !== 400 || !/allowNewSelectOptions/.test(err.message)) throw err;
    return craft(conn, path, { method, body: JSON.stringify(body) });
  }
}

export const updateItem = async (conn, colId, id, title, props, allowNew, meta) =>
  writeItems(conn, colId, "PUT",
    { itemsToUpdate: [{ id, ...(title != null ? { title } : {}), properties: await shapeProps(conn, colId, props, meta) }] }, allowNew);

export const addItem = async (conn, colId, title, props, allowNew, meta) =>
  writeItems(conn, colId, "POST",
    { items: [{ title, properties: await shapeProps(conn, colId, props, meta) }] }, allowNew);

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
