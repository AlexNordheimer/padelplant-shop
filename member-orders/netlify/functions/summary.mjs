// Public, counts-only summary of member gear orders for the Ops page alerts (ops.padelplant.com)
// and Padel Plant Today. No names, emails or phone numbers ever leave this endpoint.
import { fetchOrders, siteIdFrom } from '../lib/orders.mjs';

const ORDERS = 'https://shop.padelplant.com/orders';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'max-age=120' };
const DAY = 86400000;

// Most recent Monday at noon, Eastern time (orders placed before then should be in that week's order).
function lastMondayNoon(now = new Date()) {
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const offset = now - et; // ms between UTC clock and ET wall clock
  const d = new Date(et); d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  if (d > et) d.setDate(d.getDate() - 7);
  return new Date(d.getTime() + offset);
}
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

export default async (req, context) => {
  try {
    const orders = await fetchOrders(siteIdFrom(context));
    const now = Date.now(), cutoff = lastMondayNoon();
    let requested = 0, overdue = 0, overdueSince = null, newToday = 0, waiting = 0, waitingSince = null, spam = 0, atDesk = 0;
    const deskMembers = new Set();
    for (const o of orders) {
      const created = new Date(o.created);
      if (o.test) continue; // test checkouts from previews
      if (o.spam) { if (now - created < 14 * DAY) spam++; continue; }
      if (now - created < DAY) newToday++;
      for (const it of o.items) {
        if (it.status === 'Requested') {
          requested++;
          if (created < cutoff) { overdue++; if (!overdueSince || created < overdueSince) overdueSince = created; }
        }
        if (it.status === 'Arrived') { atDesk += it.qty || 1; deskMembers.add((o.email || o.name || o.id || '').toLowerCase()); }
        // Arrived but not picked up for two weeks (order date stands in for arrival date)
        if (it.status === 'Arrived' && now - created > 14 * DAY) { waiting++; if (!waitingSince || created < waitingSince) waitingSince = created; }
      }
    }
    const alerts = [];
    if (overdue) alerts.push({ key: 'shop-not-ordered', area: 'Shop', level: 'bad',
      title: plural(overdue, 'gear item', 'gear items') + ' missed the Monday order',
      detail: 'Requested before Monday noon and still not marked Ordered. Place the order or update the sheet.',
      link: ORDERS, n: overdue, since: overdueSince });
    if (requested - overdue > 0) alerts.push({ key: 'shop-requested', area: 'Shop', level: 'info',
      title: plural(requested - overdue, 'gear item', 'gear items') + ' requested for next Monday\'s order',
      detail: newToday ? plural(newToday, 'new order', 'new orders') + ' in the last 24 hours.' : 'Goes out with the next weekly order.',
      link: ORDERS, n: requested - overdue, since: null });
    if (atDesk) alerts.push({ key: 'shop-pickup', area: 'Shop', level: 'warn',
      title: plural(atDesk, 'gear item', 'gear items') + ' waiting at the desk for ' + plural(deskMembers.size, 'member', 'members'),
      detail: 'Marked Arrived and not picked up yet. Print the pickup sheets from the order page.' + (waiting ? ' ' + plural(waiting, 'item has', 'items have') + ' been waiting over two weeks.' : ''),
      link: ORDERS, n: atDesk, since: waitingSince });
    if (spam) alerts.push({ key: 'shop-spam', area: 'Shop', level: 'warn',
      title: plural(spam, 'order', 'orders') + ' flagged as spam',
      detail: 'Netlify flagged these. Check they aren\'t real member orders.',
      link: ORDERS, n: spam, since: null });
    return Response.json({ updated_at: new Date().toISOString(), requested, overdue, new_24h: newToday, waiting_pickup: waiting, at_desk: atDesk, at_desk_members: deskMembers.size, spam, alerts }, { headers: CORS });
  } catch (e) {
    return Response.json({ error: String(e.message || e), alerts: [] }, { status: 500, headers: CORS });
  }
};

export const config = { path: '/api/summary' };
