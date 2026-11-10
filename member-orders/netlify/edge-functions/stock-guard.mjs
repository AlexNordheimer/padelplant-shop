// Sits in front of /api/stock so a hiccup at Toast never blanks the shop.
// Toast's menu API refuses calls that come too close together (it returns an HTML
// error page). This keeps the last good stock list and:
//   - serves it straight away if it is under 5 minutes old (fewer calls to Toast),
//   - otherwise asks Toast for a fresh copy and saves it,
//   - and if Toast fails, serves the last good copy instead of an error.
import { getStore } from '@netlify/blobs';

const FRESH_MS = 5 * 60 * 1000;
const KEY = 'stock';

export default async (req, context) => {
  let store, saved = null;
  try {
    store = getStore({ name: 'stock-cache', consistency: 'eventual' });
    saved = await store.get(KEY, { type: 'json' });
  } catch (_) { /* no cache yet, or blobs unavailable: fall through to Toast */ }

  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' };
  if (saved && saved.savedAt && Date.now() - saved.savedAt < FRESH_MS) {
    return new Response(JSON.stringify(saved.body), { headers });
  }

  let res;
  try { res = await context.next(); } catch (_) { res = null; }
  if (res && res.ok) {
    const text = await res.text();
    try {
      const body = JSON.parse(text);
      if (store && Array.isArray(body.items) && body.items.length) {
        await store.setJSON(KEY, { savedAt: Date.now(), body });
      }
    } catch (_) { /* not JSON: pass it through untouched */ }
    return new Response(text, { status: 200, headers });
  }

  if (saved && saved.body) {
    return new Response(JSON.stringify({ ...saved.body, stale: true }), { headers });
  }
  return res || Response.json({ error: 'Stock is unavailable right now', items: [] }, { status: 502 });
};

export const config = { path: '/api/stock' };
