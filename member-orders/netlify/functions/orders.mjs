// Staff-only API for the order sheet at /orders. Requires the STAFF_PASSCODE.
import { fetchOrders, saveStatuses, checkStaff, siteIdFrom } from '../lib/orders.mjs';

export default async (req, context) => {
  if (!checkStaff(req)) return Response.json({ error: 'Wrong passcode' }, { status: 401 });
  try {
    if (req.method === 'POST') {
      const body = await req.json();
      await saveStatuses(Array.isArray(body.updates) ? body.updates : []);
      return Response.json({ ok: true });
    }
    const orders = await fetchOrders(siteIdFrom(context));
    return Response.json({ orders }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 500 });
  }
};

export const config = { path: '/api/orders' };
