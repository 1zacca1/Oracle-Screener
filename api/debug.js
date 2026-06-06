const UA = { 'User-Agent': 'Oracle-Screener/1.0' };

async function testFeed(label, url) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(url, { headers: UA, signal: ctrl.signal });
    clearTimeout(t);
    const text = await r.text();
    const isXML = text.trim().startsWith('<?xml') || text.includes('<rss') || text.includes('<feed');
    const itemCount = (text.match(/<item>/g) || text.match(/<entry>/g) || []).length;
    const ct = r.headers.get('content-type') || '';
    const sample = text.slice(0, 150).replace(/\s+/g, ' ');
    return { label, status: r.status, isXML, itemCount, ct, sample };
  } catch (e) {
    return { label, error: e.message };
  }
}

export default async function handler(req, res) {
  const week = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const today = new Date().toISOString().split('T')[0];

  const tests = await Promise.all([
    // Globe Newswire — confirmed working for Canada, testing Nordic countries
    testFeed('gnw_norway',    'https://www.globenewswire.com/RssFeed/country/Norway'),
    testFeed('gnw_sweden',    'https://www.globenewswire.com/RssFeed/country/Sweden'),
    testFeed('gnw_denmark',   'https://www.globenewswire.com/RssFeed/country/Denmark'),
    testFeed('gnw_finland',   'https://www.globenewswire.com/RssFeed/country/Finland'),
    testFeed('gnw_canada',    'https://www.globenewswire.com/RssFeed/country/Canada'),

    // EDGAR (control)
    testFeed('edgar_8k', `https://efts.sec.gov/LATEST/search-index?forms=8-K&dateRange=custom&startdt=${week}&enddt=${today}`),
  ]);

  return res.json(tests);
}
