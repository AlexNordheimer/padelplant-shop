// Shared helpers for the member order sheet and the Monday email.
import { getStore } from '@netlify/blobs';

const API = 'https://api.netlify.com/api/v1';
export const STATUSES = ['Requested', 'Ordered', 'Arrived', 'Picked up'];

export const weekLabel = (d = new Date()) =>
  d.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' });

export function siteIdFrom(context) {
  const id = context?.site?.id || process.env.SITE_ID;
  if (!id) throw new Error('Could not tell which Netlify site this is');
  return id;
}

export function checkStaff(req) {
  const want = process.env.STAFF_PASSCODE;
  return !!want && req.headers.get('x-staff-key') === want;
}

const statusStore = () => getStore({ name: 'member-order-status', consistency: 'strong' });

export async function fetchOrders(siteId) {
  const token = process.env.NETLIFY_API_TOKEN;
  if (!token) throw new Error('NETLIFY_API_TOKEN is missing in Netlify settings');
  const H = { headers: { Authorization: 'Bearer ' + token } };
  const fr = await fetch(`${API}/sites/${siteId}/forms`, H);
  if (!fr.ok) throw new Error('Netlify returned ' + fr.status + ' when reading forms');
  const form = (await fr.json()).find(f => f.name === 'member-order');
  if (!form) return [];
  const subs = [];
  // Read normal and spam-flagged submissions, so a real order Netlify mistakes for spam isn't lost.
  for (const state of ['verified', 'spam']) {
    for (let page = 1; page <= 20; page++) {
      const r = await fetch(`${API}/forms/${form.id}/submissions?${state === 'spam' ? 'state=spam&' : ''}per_page=100&page=${page}`, H);
      if (!r.ok) throw new Error('Netlify returned ' + r.status + ' when reading orders');
      const arr = await r.json();
      arr.forEach(x => { x._spam = state === 'spam'; });
      subs.push(...arr);
      if (arr.length < 100) break;
    }
  }
  const store = statusStore();
  const orders = [];
  for (const s of subs) {
    const d = s.data || {};
    let items = [];
    try { items = JSON.parse(d.items_json || '[]'); } catch (e) { items = []; }
    const saved = (await store.get(s.id, { type: 'json' })) || {};
    orders.push({
      id: s.id, number: s.number, created: s.created_at,
      week: d.order_week || 'Unscheduled',
      name: d.name || '', email: d.email || '', phone: d.phone || '',
      membership: d.membership || '', notes: d.notes || '', spam: !!s._spam,
      list_total: d.list_total || '', member_total: d.member_total || '',
      items: items.map((it, i) => ({ ...it, idx: i, status: saved[i] || 'Requested' }))
    });
  }
  orders.sort((a, b) => (a.created < b.created ? 1 : -1));
  return orders;
}

export async function saveStatuses(updates) {
  const store = statusStore();
  const byOrder = {};
  updates.forEach(u => {
    if (!STATUSES.includes(u.status)) return;
    (byOrder[u.order] = byOrder[u.order] || []).push(u);
  });
  for (const [id, list] of Object.entries(byOrder)) {
    const cur = (await store.get(id, { type: 'json' })) || {};
    list.forEach(u => { cur[u.idx] = u.status; });
    await store.setJSON(id, cur);
  }
}

// Group a week's orders into one supplier list per brand.
export function supplierList(orders) {
  const brands = {}, requests = [];
  orders.forEach(o => o.items.forEach(it => {
    if (it.sku === 'request' || it.request) { requests.push({ ...it, who: o.name, order: o.id }); return; }
    const b = brands[it.brand] = brands[it.brand] || {};
    const key = [it.product, it.color || '', it.size || ''].join('|');
    const row = b[key] = b[key] || { brand: it.brand, product: it.product, color: it.color, size: it.size, sku: it.sku, qty: 0, list_each: it.list_each, who: [], refs: [] };
    row.qty += it.qty || 1;
    row.who.push(o.name + ((it.qty || 1) > 1 ? ' ×' + it.qty : ''));
    row.refs.push({ order: o.id, idx: it.idx, status: it.status });
  }));
  return {
    brands: Object.fromEntries(Object.entries(brands).sort().map(([k, v]) => [k, Object.values(v).sort((a, b) => a.product.localeCompare(b.product))])),
    requests
  };
}
