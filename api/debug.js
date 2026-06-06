const UA = { 'User-Agent': 'Oracle-Screener/1.0' };

export default async function handler(req, res) {
  // Dump first raw <item> from GNW Denmark to inspect all fields
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch('https://www.globenewswire.com/RssFeed/country/Denmark', { headers: UA, signal: ctrl.signal });
    const xml = await r.text();
    const item = xml.match(/<item>([\s\S]*?)<\/item>/)?.[1] || 'NO ITEM FOUND';
    return res.json({ status: r.status, raw_item: item });
  } catch (e) {
    return res.json({ error: e.message });
  }
}
