const UA = { 'User-Agent': 'Oracle-Screener/1.0' };

export default async function handler(req, res) {
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 6000);
    const r   = await fetch('https://www.globenewswire.com/RssFeed/country/Norway', { headers: UA, signal: ctrl.signal });
    const xml = await r.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 5).map(m => {
      const block = m[1];
      const raw = tag => block.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`))?.[1]?.trim() || '';
      const stockCat = block.match(/domain="[^"]*rss\/stock"[^>]*>([^<]+)/)?.[1]?.trim() || '';
      return {
        company:  raw('dc:contributor'),
        ticker:   stockCat.includes(':') ? stockCat.split(':')[1] : stockCat,
        title:    raw('title'),
        desc:     raw('description').replace(/<[^>]+>/g, '').slice(0, 120),
        pubDate:  raw('pubDate'),
      };
    });
    return res.json({ status: r.status, items });
  } catch (e) {
    return res.json({ error: e.message });
  }
}
