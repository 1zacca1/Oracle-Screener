const UA = { 'User-Agent': 'Oracle-Screener/1.0 contact@oracle-screener.app' };

async function testFeed(label, url) {
  try {
    const r = await fetch(url, { headers: UA });
    const text = await r.text();
    const isXML = text.trim().startsWith('<?xml') || text.includes('<rss') || text.includes('<feed');
    const itemCount = (text.match(/<item>/g) || text.match(/<entry>/g) || []).length;
    const sample = text.slice(0, 200).replace(/\s+/g, ' ');
    return { label, status: r.status, isXML, itemCount, sample };
  } catch (e) {
    return { label, error: e.message };
  }
}

export default async function handler(req, res) {
  const today = new Date().toISOString().split('T')[0];
  const week  = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

  const tests = await Promise.all([
    // Oslo Bors Newsweb
    testFeed('oslo_newsweb_dated',   `https://newsweb.oslobors.no/message/browsecategory?category=OB&from=${week}&to=${today}&output=rss`),
    testFeed('oslo_newsweb_nodates', 'https://newsweb.oslobors.no/message/browsecategory?category=OB&output=rss'),
    testFeed('oslo_newsweb_v2',      'https://www.newsweb.no/newsweb/rss.do?market=OB'),

    // Nasdaq Nordic — Stockholm, Copenhagen, Helsinki
    testFeed('nasdaq_stockholm',           'https://www.nasdaqomxnordic.com/feeds/news?market=stockholm'),
    testFeed('nasdaq_stockholm_regulatory','https://www.nasdaqomxnordic.com/feeds/news?market=stockholm&newstype=regulatory'),
    testFeed('nasdaq_copenhagen',          'https://www.nasdaqomxnordic.com/feeds/news?market=copenhagen'),
    testFeed('nasdaq_helsinki',            'https://www.nasdaqomxnordic.com/feeds/news?market=helsinki'),
    testFeed('nasdaq_nordic_all',          'https://www.nasdaqomxnordic.com/feeds/news'),

    // MFN (Modular Finance Nordic)
    testFeed('mfn_latest',   'https://mfn.se/feeds/latest'),
    testFeed('mfn_rss',      'https://mfn.se/rss'),

    // Canada — Globe Newswire (main Canadian press release wire, TSX companies)
    testFeed('gnw_canada',          'https://www.globenewswire.com/RssFeed/country/Canada'),
    testFeed('gnw_canada_financial','https://www.globenewswire.com/RssFeed/country/Canada&Industry=Financial%20Services'),
    testFeed('gnw_canada_energy',   'https://www.globenewswire.com/RssFeed/country/Canada&Industry=Energy%20%26%20Natural%20Resources'),
    testFeed('cnw_newswire',        'https://www.newswire.ca/en/rss/latest.rss'),
    testFeed('tsx_notices',         'https://www.tsx.com/json/market-regulatory-notices'),

    // EDGAR EFTS (control — should always work)
    testFeed('edgar_efts',   `https://efts.sec.gov/LATEST/search-index?forms=8-K&dateRange=custom&startdt=${week}&enddt=${today}&q=%22spinoff%22`),
  ]);

  return res.json(tests);
}
