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
  const subs = [];
  for (let page = 1; page <= 20; page++) {
    const r = await fetch(`${API}/sites/${siteId}/submissions?per_page=100&page=${page}`, { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) throw new Error('Netlify returned ' + r.status + ' when reading orders');
    const arr = await r.json();
    subs.push(...arr);
    if (arr.length < 100) break;
  }
  const store = statusStore();
  const orders = [];
  for (const s of subs) {
    const d = s.data || {};
    if ((s.form_name || d['form-name']) !== 'member-order') continue;
    let items = [];
    try { items = JSON.parse(d.items_json || '[]'); } catch (e) { items = []; }
    const saved = (await store.get(s.id, { type: 'json' })) || {};
    orders.push({
      id: s.id, number: s.number, created: s.created_at,
      week: d.order_week || 'Unscheduled',
      name: d.name || '', email: d.email || '', phone: d.phone || '',
      membership: d.membership || '', notes: d.notes || '',
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

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = n => '$' + Number(n || 0).toFixed(2).replace(/\.00$/, '');

export function emailHtml(week, orders, sheetUrl) {
  const { brands, requests } = supplierList(orders);
  const G = '#3a503c', C = '#fef3e5', F = 'font-family:Helvetica,Arial,sans-serif';
  const h = (t) => `<h2 style="${F};font-family:Georgia,serif;font-style:italic;font-weight:400;font-size:24px;color:${G};margin:28px 0 8px">${esc(t)}</h2>`;
  const td = 'padding:8px 10px 8px 0;border-top:1px solid #e8dcc8;vertical-align:top;font-size:14px;color:' + G;
  let body = `<div style="background:${C};padding:28px 22px;${F};color:${G}">
  <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;font-weight:bold">Padel Plant · Member orders</div>
  <h1 style="font-family:Georgia,serif;font-style:italic;font-weight:400;font-size:32px;margin:6px 0 4px">Order for ${esc(week)}</h1>
  <p style="margin:0 0 6px;font-size:14px">${orders.length} member order${orders.length === 1 ? '' : 's'} · ${orders.reduce((n, o) => n + o.items.reduce((m, i) => m + (i.qty || 1), 0), 0)} items</p>
  ${sheetUrl ? `<p style="margin:0 0 10px;font-size:14px"><a href="${esc(sheetUrl)}" style="color:${G};font-weight:bold">Open the order sheet →</a></p>` : ''}`;
  if (!orders.length) {
    body += `<p style="font-size:15px;margin-top:24px">No member orders came in this week. Nothing to place.</p></div>`;
    return body;
  }
  for (const [brand, rows] of Object.entries(brands)) {
    body += h(brand + ' · to order');
    body += `<table style="border-collapse:collapse;width:100%">` + rows.map(r =>
      `<tr><td style="${td};width:44px;font-weight:bold">${r.qty}×</td><td style="${td}"><b>${esc(r.product)}</b>${r.color ? ' · ' + esc(r.color) : ''}${r.size ? ' · size ' + esc(r.size) : ''}<br><span style="font-size:12px;opacity:.75">${esc((r.sku || '').replace(/^(hs|wl)-/, '').toUpperCase())} · for ${esc(r.who.join(', '))}</span></td><td style="${td};text-align:right;white-space:nowrap">${r.list_each ? money(r.list_each * r.qty) : ''}</td></tr>`).join('') + `</table>`;
  }
  if (requests.length) {
    body += h('Special requests');
    body += `<table style="border-collapse:collapse;width:100%">` + requests.map(r =>
      `<tr><td style="${td}"><b>${esc(r.brand)}</b> · ${esc(r.request)}<br><span style="font-size:12px;opacity:.75">for ${esc(r.who)} · confirm price before ordering</span></td></tr>`).join('') + `</table>`;
  }
  body += h('By member');
  body += `<table style="border-collapse:collapse;width:100%">` + orders.map(o =>
    `<tr><td style="${td}"><b>${esc(o.name)}</b> · ${esc(o.membership)}<br><span style="font-size:12px">${esc(o.phone)} · ${esc(o.email)}</span>${o.notes ? `<br><span style="font-size:12px">Note: ${esc(o.notes)}</span>` : ''}<br><span style="font-size:12px;opacity:.75">${o.items.map(i => (i.qty || 1) + '× ' + esc(i.request ? (i.brand + ' request: ' + i.request) : (i.brand + ' ' + i.product + (i.color ? ' ' + i.color : '') + (i.size ? ' size ' + i.size : '')))).join('<br>')}</span></td><td style="${td};text-align:right;white-space:nowrap">${esc(o.member_total)}<br><span style="font-size:12px;opacity:.75">reg. ${esc(o.list_total)}</span></td></tr>`).join('') + `</table>`;
  body += `<p style="font-size:12px;opacity:.75;margin-top:24px">Members pay at pickup. Member prices are checked against PlayByPoint at the front desk.</p></div>`;
  return body;
}

export async function sendSummary(siteId, week, sheetUrl) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY is missing in Netlify settings');
  const from = process.env.ORDERS_FROM_EMAIL || 'Padel Plant Orders <orders@padelplant.com>';
  const to = (process.env.ORDERS_EMAIL_TO || 'alex@padelplant.com,sam@padelplant.com').split(',').map(s => s.trim()).filter(Boolean);
  const orders = (await fetchOrders(siteId)).filter(o => o.week === week);
  const count = orders.reduce((n, o) => n + o.items.reduce((m, i) => m + (i.qty || 1), 0), 0);
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from, to,
      subject: orders.length ? `Member gear order for ${week}: ${count} item${count === 1 ? '' : 's'} from ${orders.length} member${orders.length === 1 ? '' : 's'}` : `Member gear order for ${week}: no orders this week`,
      html: emailHtml(week, orders, sheetUrl)
    })
  });
  if (!r.ok) throw new Error('Email service returned ' + r.status + ': ' + (await r.text()).slice(0, 300));
  return { week, orders: orders.length, items: count, to };
}
