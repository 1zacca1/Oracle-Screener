const UA_BOT     = { 'User-Agent': 'Oracle-Screener/1.0 contact@oracle-screener.app' };
const UA_BROWSER = { 'User-Agent': 'Mozilla/5.0 (compatible; Oracle-Screener/1.0)' };

async function testFeed(label, url, ua = UA_BOT) {
  try {
    const r = await fetch(url, { headers: ua });
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
  const today = new Date().toISOString().split('T')[0];
  const week  = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const month = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

  const tests = await Promise.all([
    // Oslo Bors Newsweb — both UAs to detect bot-blocking
    testFeed('oslo_dated_bot',     `https://newsweb.oslobors.no/message/browsecategory?category=OB&from=${week}&to=${today}&output=rss`, UA_BOT),
    testFeed('oslo_dated_browser', `https://newsweb.oslobors.no/message/browsecategory?category=OB&from=${week}&to=${today}&output=rss`, UA_BROWSER),
    testFeed('oslo_nodates',       'https://newsweb.oslobors.no/message/browsecategory?category=OB&output=rss', UA_BROWSER),
    testFeed('oslo_v2',            'https://www.newsweb.no/newsweb/rss.do?market=OB', UA_BROWSER),

    // Nasdaq Nordic
    testFeed('nasdaq_stockholm_bot',     'https://www.nasdaqomxnordic.com/feeds/news?market=stockholm', UA_BOT),
    testFeed('nasdaq_stockholm_browser', 'https://www.nasdaqomxnordic.com/feeds/news?market=stockholm', UA_BROWSER),
    testFeed('nasdaq_copenhagen',        'https://www.nasdaqomxnordic.com/feeds/news?market=copenhagen', UA_BROWSER),
    testFeed('nasdaq_helsinki',          'https://www.nasdaqomxnordic.com/feeds/news?market=helsinki', UA_BROWSER),
    testFeed('nasdaq_nordic_all',        'https://www.nasdaqomxnordic.com/feeds/news', UA_BROWSER),

    // MFN (Modular Finance Nordic)
    testFeed('mfn_latest', 'https://mfn.se/feeds/latest', UA_BROWSER),
    testFeed('mfn_rss',    'https://mfn.se/rss',          UA_BROWSER),

    // Canada
    testFeed('gnw_canada', 'https://www.globenewswire.com/RssFeed/country/Canada', UA_BROWSER),
    testFeed('cnw_canada', 'https://www.newswire.ca/en/rss/latest.rss',            UA_BROWSER),

    // EDGAR EFTS (control — must work)
    testFeed('edgar_8k_week',  `https://efts.sec.gov/LATEST/search-index?forms=8-K&dateRange=custom&startdt=${week}&enddt=${today}&q=%22spinoff%22`, UA_BOT),
    testFeed('edgar_8k_month', `https://efts.sec.gov/LATEST/search-index?forms=8-K&dateRange=custom&startdt=${month}&enddt=${today}`, UA_BOT),
  ]);

  return res.json(tests);
}
