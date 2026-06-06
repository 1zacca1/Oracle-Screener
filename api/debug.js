const UA = { 'User-Agent': 'Oracle-Screener/1.0' };

export default async function handler(req, res) {
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 6000);
    const r   = await fetch('https://www.globenewswire.com/RssFeed/country/Norway', { headers: UA, signal: ctrl.signal });
    const xml = await r.text();
    // Return first 3 raw items so we can see all field names
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 3).map(m => m[1].trim());
    return res.json({ status: r.status, items });
  } catch (e) {
    return res.json({ error: e.message });
  }
}
