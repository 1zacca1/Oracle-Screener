// Real filings from SEC EDGAR + Oslo Bors Newsweb
// Tickers resolved via SEC company_tickers.json — no API key required

const EFTS = 'https://efts.sec.gov/LATEST/search-index';
const UA   = { 'User-Agent': 'Oracle-Screener/1.0 contact@oracle-screener.app' };

function lookbackDates(lookback) {
  const end  = new Date();
  const days = lookback?.includes('30') ? 30 : lookback?.includes('14') ? 14 : 7;
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  return {
    start: start.toISOString().split('T')[0],
    end:   end.toISOString().split('T')[0],
  };
}

// ── Ticker lookup ─────────────────────────────────────────────────────────────
async function buildTickerMap() {
  try {
    const r = await fetch('https://www.sec.gov/files/company_tickers.json', { headers: UA });
    const d = await r.json();
    const map = new Map();
    for (const e of Object.values(d)) {
      map.set(normalise(e.title), e.ticker);
    }
    return map;
  } catch { return new Map(); }
}

function normalise(name = '') {
  return name.toUpperCase()
    .replace(/,?\s+(INC|CORP|LTD|LLC|PLC|CO\.?|GROUP|HOLDINGS?|INTERNATIONAL|THE)\b\.?/g, '')
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function findTicker(entityName, map) {
  if (!entityName || !map.size) return null;
  const key = normalise(entityName);
  if (map.has(key)) return map.get(key);
  // Fuzzy: match on first two significant words
  const prefix = key.split(' ').slice(0, 2).join(' ');
  for (const [k, v] of map) {
    if (k.startsWith(prefix) && Math.abs(k.length - key.length) < 12) return v;
  }
  return null;
}

// ── EDGAR EFTS search ─────────────────────────────────────────────────────────
async function edgarSearch({ keywords = [], form, start, end, limit = 10 }) {
  const p = new URLSearchParams({ forms: form, dateRange: 'custom', startdt: start, enddt: end });
  if (keywords.length) p.set('q', keywords.map(k => `"${k}"`).join(' OR '));
  try {
    const r = await fetch(`${EFTS}?${p}`, { headers: UA });
    if (!r.ok) return [];
    const d = await r.json();
    return (d.hits?.hits || []).slice(0, limit).map(h => ({
      entity:    h._source.entity_name || '',
      date:      h._source.file_date   || '',
      form_type: h._source.form_type   || form,
      accession: h._source.accession_no || '',
    }));
  } catch { return []; }
}

// For Form 4, use the EDGAR filing browser Atom feed which exposes issuer names
async function getForm4Issuers(start, end, limit = 15) {
  try {
    const p = new URLSearchParams({
      action: 'getcurrent', type: '4', dateb: '', owner: 'include',
      count: String(limit * 3), output: 'atom',
    });
    const r = await fetch(`https://www.sec.gov/cgi-bin/browse-edgar?${p}`, { headers: UA });
    const xml = await r.text();
    const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)];
    const results = [];
    for (const m of entries) {
      // Titles look like: "4 - COMPANY NAME (CIK) (Issuer)"
      const issuer = m[1].match(/4\s*-\s*(.+?)\s*\(\d+\)\s*\(Issuer\)/i)?.[1]?.trim();
      if (!issuer) continue;
      const updated = m[1].match(/<updated>(.*?)<\/updated>/)?.[1]?.split('T')[0] || '';
      if (updated < start || updated > end) continue;
      results.push({ entity: issuer, date: updated, form_type: '4', accession: '' });
      if (results.length >= limit) break;
    }
    return results;
  } catch { return []; }
}

// ── Oslo Bors Newsweb ─────────────────────────────────────────────────────────
async function newswebOslo(start, end) {
  try {
    const r = await fetch(
      `https://newsweb.oslobors.no/message/browsecategory?category=OB&from=${start}&to=${end}&output=rss`,
      { headers: { 'User-Agent': 'Oracle-Screener/1.0' } }
    );
    const xml = await r.text();
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
      const raw = tag => m[1].match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`))?.[1]?.trim() || '';
      return { title: raw('title'), pubDate: raw('pubDate') };
    }).slice(0, 12);
  } catch { return []; }
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const {
    events   = [],
    lookback = 'past 7 days',
    universe = 'Nordic + US',
  } = req.body;

  const { start, end } = lookbackDates(lookback);
  const inclUS     = universe !== 'Nordic only';
  const inclNordic = universe !== 'US only';

  const raw    = [];
  const tasks  = [];

  if (inclUS) {
    if (events.includes('Spinoffs/carve-outs'))
      tasks.push(edgarSearch({ keywords: ['spin-off','spinoff','carve-out','split-off'], form: '8-K', start, end })
        .then(h => h.forEach(x => raw.push({ ...x, event_type: 'Spinoff/Carve-out', region: 'us' }))));

    if (events.includes('Significant buybacks'))
      tasks.push(edgarSearch({ keywords: ['repurchase program','share repurchase authorization','stock repurchase program'], form: '8-K', start, end })
        .then(h => h.forEach(x => raw.push({ ...x, event_type: 'Buyback', region: 'us' }))));

    if (events.includes('Insider purchases'))
      tasks.push(getForm4Issuers(start, end)
        .then(h => h.forEach(x => raw.push({ ...x, event_type: 'Insider Purchase', region: 'us' }))));

    if (events.includes('Strategic reviews/M&A'))
      tasks.push(edgarSearch({ keywords: ['strategic review','strategic alternatives','merger agreement','definitive agreement'], form: '8-K', start, end })
        .then(h => h.forEach(x => raw.push({ ...x, event_type: 'Strategic Review/M&A', region: 'us' }))));

    if (events.includes('Activist involvement'))
      tasks.push(edgarSearch({ keywords: [], form: 'SC 13D', start, end })
        .then(h => h.forEach(x => raw.push({ ...x, event_type: 'Activist (SC 13D)', region: 'us' }))));

    if (events.includes('Management changes'))
      tasks.push(edgarSearch({ keywords: ['appointed as Chief Executive','new Chief Executive','new CEO'], form: '8-K', start, end, limit: 6 })
        .then(h => h.forEach(x => raw.push({ ...x, event_type: 'Management Change', region: 'us' }))));

    if (events.includes('Core biz inflecting'))
      tasks.push(edgarSearch({ keywords: ['record revenue','record earnings','first profitable','inflection point'], form: '8-K', start, end })
        .then(h => h.forEach(x => raw.push({ ...x, event_type: 'Business Inflection', region: 'us' }))));
  }

  if (inclNordic)
    tasks.push(newswebOslo(start, end)
      .then(items => items.forEach(item => raw.push({
        entity:        item.title.split(':')[0]?.trim() || 'Nordic Company',
        date:          item.pubDate,
        form_type:     'Announcement',
        event_type:    'Nordic Announcement',
        event_summary: item.title,
        region:        'nordic',
      }))));

  // Run filings + ticker map fetch in parallel
  const [, tickerMap] = await Promise.all([
    Promise.allSettled(tasks),
    inclUS ? buildTickerMap() : Promise.resolve(new Map()),
  ]);

  // Enrich US filings with real tickers
  const filings = raw.map(f => ({
    ...f,
    ticker: f.region === 'us' ? (findTicker(f.entity, tickerMap) || '?') : undefined,
  }));

  return res.json({ filings: filings.slice(0, 50), start, end, total: filings.length });
}
