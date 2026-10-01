// Made-up collections for ?demo, held in memory. Same calls as craft.js.

const media = {
  name: "Watchlist",
  titleName: "Title",
  props: [
    { key: "type", name: "Type", type: "singleSelect", options: ["Film", "TV", "Book", "Podcast", "Game"].map(name => ({ name })) },
    { key: "status", name: "Status", type: "singleSelect", options: ["Want to", "In progress", "Finished", "Dropped"].map(name => ({ name })) },
    { key: "rating", name: "Rating", type: "number", options: [] },
    { key: "where", name: "Where", type: "singleSelect", options: ["Netflix", "iPlayer", "Disney+", "Prime", "Cinema", "Kindle"].map(name => ({ name })) },
    { key: "finished", name: "Finished", type: "date", options: [] },
    { key: "link", name: "Link", type: "url", options: [] },
    { key: "notes", name: "Notes", type: "text", options: [] },
  ],
};
const albums = {
  name: "Albums",
  titleName: "Album",
  props: [
    { key: "artist", name: "Artist", type: "text", options: [] },
    { key: "genre", name: "Genre", type: "multiSelect", options: ["Indie", "Rock", "Electronic", "Hip-hop", "Folk", "Jazz", "Pop"].map(name => ({ name })) },
    { key: "rating", name: "Rating", type: "number", options: [] },
    { key: "listened", name: "Listened", type: "date", options: [] },
    { key: "bestTrack", name: "Best track", type: "text", options: [] },
    { key: "review", name: "Review", type: "text", options: [] },
    { key: "favourite", name: "Favourite", type: "boolean", options: [] },
  ],
};
const singles = {
  name: "Tracks",
  titleName: "Track",
  props: [
    { key: "artist", name: "Artist", type: "text", options: [] },
    { key: "rating", name: "Rating", type: "number", options: [] },
    { key: "verdict", name: "Verdict", type: "singleSelect", options: ["Skip", "Fine", "On repeat"].map(name => ({ name })) },
  ],
};

let n = 0;
const item = (title, props, preview = "") => ({ id: `demo-${++n}`, title, props, preview });

const store = [
  { id: "c-media", connId: "demo", docTitle: "Media List", docName: "Media List", name: media.name, schema: media, items: [
    item("Severance", { type: "TV", status: "In progress", where: "Prime", link: "https://tv.apple.com" }),
    item("Past Lives", { type: "Film", status: "Finished", rating: 5, where: "Cinema", finished: "2026-09-12", notes: "Quietly devastating. The bar scene." }),
    item("The Bear", { type: "TV", status: "Finished", rating: 4, where: "Disney+", finished: "2026-08-30" }),
    item("Tomorrow, and Tomorrow, and Tomorrow", { type: "Book", status: "In progress", where: "Kindle" }),
    item("Dune: Part Two", { type: "Film", status: "Want to" }),
    item("Shōgun", { type: "TV", status: "Want to", where: "Disney+" }),
    item("The Rest Is History", { type: "Podcast", status: "In progress" }),
    item("Slow Horses", { type: "TV", status: "Dropped", rating: 2 }),
    item("Hades II", { type: "Game", status: "Want to" }),
    item("Perfect Days", { type: "Film", status: "Finished", rating: 4, finished: "2026-07-03" }),
  ] },
  { id: "c-albums", connId: "demo", docTitle: "Music Reviews", docName: "Music Reviews", name: albums.name, schema: albums, items: [
    item("Blue Rev", { artist: "Alvvays", genre: ["Indie", "Pop"], rating: 9, listened: "2026-09-20", bestTrack: "Belinda Says", review: "Fuzzy, bright and over too fast in the best way.", favourite: true }),
    item("Romance", { artist: "Fontaines D.C.", genre: ["Rock"], rating: 8, listened: "2026-09-02", bestTrack: "Favourite" }),
    item("Two Star & The Dream Police", { artist: "Mk.gee", genre: ["Indie", "Electronic"], rating: 7, listened: "2026-08-18" }, "Grew on me on the third listen."),
    item("GNX", { artist: "Kendrick Lamar", genre: ["Hip-hop"], listened: "2026-09-28" }),
    item("Bright Future", { artist: "Adrianne Lenker", genre: ["Folk"], rating: 9, favourite: true }),
  ] },
  { id: "c-tracks", connId: "demo", docTitle: "Music Reviews", docName: "Music Reviews", name: singles.name, schema: singles, items: [
    item("Belinda Says", { artist: "Alvvays", rating: 5, verdict: "On repeat" }),
    item("Starburster", { artist: "Fontaines D.C.", rating: 4, verdict: "On repeat" }),
    item("Are You Looking Up", { artist: "Mk.gee", rating: 3, verdict: "Fine" }),
  ] },
];

const wait = () => new Promise(r => setTimeout(r, 250));
const find = (colId) => store.find(c => c.id === colId);

export async function loadAll() {
  await wait();
  return { collections: structuredClone(store), problems: [] };
}
export async function updateItem(_conn, colId, id, title, props) {
  await wait();
  const it = find(colId).items.find(i => i.id === id);
  if (title != null) it.title = title;
  for (const [k, v] of Object.entries(props)) { if (v === null) delete it.props[k]; else it.props[k] = v; }
  return { items: [it] };
}
export async function addItem(_conn, colId, title, props) {
  await wait();
  const it = item(title, { ...props });
  find(colId).items.unshift(it);
  return { items: [{ id: it.id, title, properties: it.props }] };
}
export async function deleteItem(_conn, colId, id) {
  await wait();
  const col = find(colId);
  col.items = col.items.filter(i => i.id !== id);
  return { items: [id] };
}
export async function itemContent(_conn, id) {
  await wait();
  const it = store.flatMap(c => c.items).find(i => i.id === id);
  return it?.preview ? [it.preview] : [];
}
