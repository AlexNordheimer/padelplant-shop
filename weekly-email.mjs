// Runs every Monday at 13:00 UTC (9 AM Eastern in summer, 8 AM in winter),
// after the Sunday 9 PM order cutoff, and emails that week's order to the team.
import { sendSummary, weekLabel, siteIdFrom } from '../lib/orders.mjs';

export default async (req, context) => {
  const week = weekLabel(new Date());
  const site = process.env.URL || 'https://padelplant-shop.netlify.app';
  try {
    const res = await sendSummary(siteIdFrom(context), week, site + '/orders');
    console.log('Weekly order email sent', res);
  } catch (e) {
    console.error('Weekly order email failed:', e.message || e);
  }
};

export const config = { schedule: '0 13 * * 1' };
