// Featured items on the shop's home page. Anyone can read; staff save with the STAFF_PASSCODE.
// Staff pick them on the shop itself: open shop.padelplant.com/#feature, tap the stars, Save.
import { getStore } from '@netlify/blobs';
import { checkStaff } from '../lib/orders.mjs';

const settings = () => getStore({ name: 'shop-settings', consistency: 'strong' });

export default async (req) => {
  try {
    if (req.method === 'POST') {
      if (!checkStaff(req)) return Response.json({ error: 'Wrong passcode' }, { status: 401 });
      const body = await req.json().catch(() => ({}));
      const ids = [...new Set((Array.isArray(body.ids) ? body.ids : [])
        .filter(x => typeof x === 'string' && x.length > 0 && x.length < 120))].slice(0, 12);
      await settings().setJSON('featured', { ids, updated: new Date().toISOString() });
      return Response.json({ ok: true, ids });
    }
    const saved = await settings().get('featured', { type: 'json' });
    return Response.json(saved || { ids: null }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return Response.json({ error: String(e.message || e), ids: null }, { status: 500 });
  }
};

export const config = { path: '/api/featured' };
