# media.

Your **Media List** and **Music Reviews** Craft documents, with every collection inside them, in one place.

- The switch at the top moves between the two documents. If a document has more than one collection, pills under it pick the collection. On a phone you can also swipe sideways across the list, and on a keyboard ← and → do the same.
- Search, filter chips (from the collection's select columns, status-like ones first), and sorting by title, rating or date.
- Tap an item to edit it. The fields come from the collection's own columns: selects as chips, a number column called Rating/Score/Stars as stars (or 1–10 if any score is above 5), dates with a Today button, links, tick boxes and text. Anything written on the item's own page in Craft is shown underneath.
- **+** adds an item to the collection that's open, starting in whatever filter is showing.

Changes go straight to Craft. If Craft refuses one, the page puts it back and says why.

Try it without connecting anything at `?demo`.

## Setup

Uses the Craft connections saved in [tasks.](../taskhub/). Both apps are on the same site, so they share this browser's storage. Those need to be **All Documents** connections: a Daily Notes one can't see documents.

If the documents are in a space tasks. isn't connected to, paste an **All Documents** or **Selected Documents** API URL into Settings. Settings also changes which documents are shown, if they're renamed.

Nothing secret is in this repo.

## Files

- `index.html`: the page and its styles
- `app.js`: switching, the list, the item sheet and settings
- `craft.js`: Craft's documents and collections API
- `demo.js`: the made-up collections for `?demo`

A static site with no build step, hosted on GitHub Pages.
