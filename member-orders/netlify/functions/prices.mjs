// Public price list for checkout: GET /api/prices
// Checkout never trusts prices sent by the browser. It asks this endpoint instead.
// The catalog lives in index.html, so this reads the same catalog code the page runs
// (between "const TIERS = [" and "const SHOP_ONLY = [];"), applies Toast prices the
// same way the page does, and reports what is on the shelf right now.
import vm from 'node:vm';

let cache = null; // { at, body }

export default async (req) => {
  if (cache && Date.now() - cache.at < 60_000) return reply(cache.body);
  try {
    const origin = new URL(req.url).origin;
    const [html, stock] = await Promise.all([
      fetch(origin + '/?prices=' + Date.now()).then(r => r.text()),
      fetch(origin + '/api/stock').then(r => r.ok ? r.json() : { items: [] }).catch(() => ({ items: [] })),
    ]);
    const a = html.indexOf('const TIERS = ['), b = html.indexOf('const SHOP_ONLY = [];');
    if (a < 0 || b < a) throw new Error('Catalog not found in the page');
    const code = html.slice(a, b) + ';({TIERS, PRODUCTS, TOAST_LINK, CUTOFF})';
    const { TIERS, PRODUCTS, TOAST_LINK, CUTOFF } = vm.runInNewContext(code, {}, { timeout: 2000 });

    // Same matching as loadStock() in the page
    const norm = x => String(x || '').toLowerCase().replace(/[^a-z0-9.]+/g, ' ').trim();
    const SIZE_WORDS = { small: 'S', medium: 'M', large: 'L', xl: 'XL', xxl: 'XXL', xs: 'XS', s: 'S', m: 'M', l: 'L' };
    const sizeOf = name => {
      const m = name.match(/size\s*([\d.]+)/i) || name.match(/size\s+(xs|small|medium|large|xxl|xl|s|m|l)\b/i) || name.match(/-\s*([\d.]+)\s*$/) || name.match(/-\s*(xs|small|medium|large|xxl|xl|s|m|l)\s*$/i);
      if (!m) return null; const v = m[1].toLowerCase(); return SIZE_WORDS[v] || v;
    };
    const byId = Object.fromEntries(PRODUCTS.map(p => [p.id, p]));
    const inStore = {}; const priced = new Set();
    for (const it of stock.items || []) {
      const n = norm(it.name);
      const hit = TOAST_LINK.find(([pre]) => n.startsWith(norm(pre)));
      const p = hit && byId[hit[1]];
      if (!p) continue;
      // same price as in store, even when it's sold out there
      if (it.price > 0 && !priced.has(p.id)) { p.price = it.price; priced.add(p.id); }
      if (it.status === 'OUT_OF_STOCK') continue;
      if (it.status === 'QUANTITY' && !(it.quantity > 0)) continue;
      const s = inStore[p.id] || (inStore[p.id] = { sizes: [] });
      const sz = sizeOf(it.name); if (sz && !s.sizes.includes(sz)) s.sizes.push(sz);
    }
    const products = {};
    for (const p of PRODUCTS) {
      if (p.shopOnly || !(p.price > 0)) continue;
      products[p.id] = {
        brand: p.brand, name: p.name, sub: p.sub || '', cat: p.cat || '', price: p.price,
        sizes: p.sizes || null, colors: p.colors ? Object.keys(p.colors) : null,
        img: p.colors ? Object.values(p.colors)[0] : (p.img || ''),
        in_store: inStore[p.id] ? { sizes: inStore[p.id].sizes } : null,
      };
    }
    const tiers = Object.fromEntries(TIERS.filter(t => t.off).map(t => [t.id, { label: t.label, off: t.off, cats: t.cats || null }]));
    const body = { updated: new Date().toISOString(), stock_ok: !!(stock.items || []).length, cutoff_day: CUTOFF.day, tiers, products };
    cache = { at: Date.now(), body };
    return reply(body);
  } catch (e) {
    if (cache) return reply(cache.body);
    return Response.json({ error: String(e.message || e) }, { status: 500 });
  }
};

const reply = body => Response.json(body, { headers: { 'Cache-Control': 'public, max-age=60', 'Access-Control-Allow-Origin': '*' } });

export const config = { path: '/api/prices' };
