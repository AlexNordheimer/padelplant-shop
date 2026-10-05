// Reads Padel Plant shop items and stock from Toast and serves them at /api/stock.
// Credentials come from Netlify environment variables, never from the page.
//   TOAST_API_HOST          e.g. https://ws-api.toasttab.com
//   TOAST_CLIENT_ID
//   TOAST_CLIENT_SECRET
//   TOAST_RESTAURANT_GUID   the long Toast restaurant GUID (with dashes)
//   TOAST_SHOP_MENU         name of the Toast menu or menu group holding shop items (default "Retail")

let cached = { token: null, expires: 0 };

async function login(host) {
  if (cached.token && Date.now() < cached.expires) return cached.token;
  const r = await fetch(host + '/authentication/v1/authentication/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: process.env.TOAST_CLIENT_ID,
      clientSecret: process.env.TOAST_CLIENT_SECRET,
      userAccessType: 'TOAST_MACHINE_CLIENT'
    })
  });
  if (!r.ok) throw new Error('Toast login failed (' + r.status + ')');
  const j = await r.json();
  const tok = j.token || j;
  cached = { token: tok.accessToken, expires: Date.now() + ((tok.expiresIn || 3600) - 300) * 1000 };
  return cached.token;
}

function collect(node, want, inShop, out) {
  const here = inShop || (node.name && node.name.trim().toLowerCase() === want);
  if (here && node.menuItems) node.menuItems.forEach(i => out.push({ name: i.name, guid: i.guid, multiLocationId: i.multiLocationId, price: i.price ?? null }));
  (node.menuGroups || []).forEach(g => collect(g, want, here, out));
}

export default async () => {
  const host = (process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com').replace(/\/$/, '');
  const rid = process.env.TOAST_RESTAURANT_GUID;
  const want = (process.env.TOAST_SHOP_MENU || 'Retail').trim().toLowerCase();
  try {
    if (!rid || !process.env.TOAST_CLIENT_ID || !process.env.TOAST_CLIENT_SECRET) throw new Error('Toast settings are missing in Netlify');
    const token = await login(host);
    const headers = { Authorization: 'Bearer ' + token, 'Toast-Restaurant-External-ID': rid, 'Content-Type': 'application/json' };

    const menus = await (await fetch(host + '/menus/v2/menus', { headers })).json();
    const items = [];
    (menus.menus || []).forEach(m => collect(m, want, false, items));

    const stock = {};
    for (let i = 0; i < items.length; i += 100) {
      const r = await fetch(host + '/stock/v1/inventory/search', { method: 'PUT', headers, body: JSON.stringify({ guids: items.slice(i, i + 100).map(x => x.guid) }) });
      if (r.ok) (await r.json()).forEach(s => { stock[s.guid] = s; });
    }

    const out = items.map(i => ({
      name: i.name,
      guid: i.guid,
      price: i.price,
      status: stock[i.guid]?.status || 'IN_STOCK',
      quantity: stock[i.guid]?.quantity ?? null
    }));
    return Response.json({ updated: new Date().toISOString(), menu: want, items: out }, {
      headers: { 'Cache-Control': 'public, max-age=300', 'Netlify-CDN-Cache-Control': 'public, s-maxage=900, stale-while-revalidate=300' }
    });
  } catch (e) {
    return Response.json({ error: String(e.message || e), items: [] }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
};

export const config = { path: '/api/stock' };
