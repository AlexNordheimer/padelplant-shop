// Staff button on /orders: email a week's summary now. Requires the STAFF_PASSCODE.
import { sendSummary, checkStaff, siteIdFrom } from '../lib/orders.mjs';

export default async (req, context) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!checkStaff(req)) return Response.json({ error: 'Wrong passcode' }, { status: 401 });
  try {
    const { week } = await req.json();
    const sheet = new URL('/orders', req.url).toString();
    return Response.json(await sendSummary(siteIdFrom(context), week, sheet));
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 500 });
  }
};

export const config = { path: '/api/send-summary' };
