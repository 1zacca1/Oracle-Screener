// Real filings from SEC EDGAR + Oslo Bors Newsweb + Nasdaq Nordic
// Tickers resolved via SEC company_tickers.json — no API key required

const EFTS = 'https://efts.sec.gov/LATEST/search-index';
const UA   = { 'User-Agent': 'Oracle-Screener/1.0 contact@oracle-screener.app' };

function fetchWithTimeout(url, opts = {}, ms = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(t));
}

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
    const r = await fetchWithTimeout('https://www.sec.gov/files/company_tickers.json', { headers: UA });
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
    const r = await fetchWithTimeout(`${EFTS}?${p}`, { headers: UA });
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
    const r = await fetchWithTimeout(`https://www.sec.gov/cgi-bin/browse-edgar?${p}`, { headers: UA });
    const xml = await r.text();
    const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)];
    const results = [];
    for (const m of entries) {
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

// ── Globe Newswire RSS (Nordic + Canada) ─────────────────────────────────────
// Oslo Bors Newsweb and Nasdaq Nordic return JS-rendered HTML from Vercel IPs.
// Globe Newswire is a confirmed-working RSS source for all these markets.
const GNW_COUNTRY = {
  Oslo:       'Norway',
  Stockholm:  'Sweden',
  Copenhagen: 'Denmark',
  Helsinki:   'Finland',
  Canada:     'Canada',
};

async function globeNewswireFeed(exchange, limit = 15) {
  const country = GNW_COUNTRY[exchange];
  if (!country) return [];
  const url = `https://www.globenewswire.com/RssFeed/country/${encodeURIComponent(country)}`;
  try {
    const r = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Oracle-Screener/1.0' } });
    if (!r.ok) return [];
    const xml = await r.text();
    if (!xml.includes('<item>')) return [];
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, limit).map(m => {
      const raw = tag => m[1].match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`))?.[1]?.trim() || '';
      // GNW <author> is "email@domain.com (Company Name)" — extract the name part
      const authorRaw = raw('author') || raw('dc:creator') || '';
      const company   = authorRaw.match(/\(([^)]+)\)/)?.[1] || authorRaw || '';
      const title     = raw('title');
      const desc      = raw('description').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').slice(0, 280).trim();
      return { company, title, description: desc, pubDate: raw('pubDate'), exchange };
    });
  } catch { return []; }
}

// Convert a feed item to a filing record
const EARNINGS_FILTER = /\b(results|earnings|revenue|quarterly|annual report|full.year|half.year|Q[1-4] 20|interim report|financial results|årsrapport|halvårsrapport|kvartalsrapport|delårsrapport|resultat|omsætning|liikevaihto)\b/i;

const CATEGORIES = [
  { label: 'Insider Purchase',      pat: /insider.buy|insider.purchas|director.buy|bought.+shares?|acqui\w+.+shares?.+open.market/i },
  { label: 'Insider Sale',          pat: /insider.sal|director.sal|sold.+shares?.+open.market/i },
  { label: 'Share Buyback',         pat: /repurchas|buyback|buy.?back|share.purchas|aktietilbage|återköp|tilbakekjøp/i },
  { label: 'Spinoff / Carve-out',   pat: /spin.?off|carve.?out|demerger|separation|split.?off|utskillelse|spinoff/i },
  { label: 'M&A',                   pat: /acqui\w+|merger|takeover|acquisition|bid|tender.offer|definitive.agree|kombinasjon|fusjon|sammenslutn/i },
  { label: 'Strategic Review',      pat: /strategic.review|strategic.alternative|exploring.option|sale.process|put.up.for.sale/i },
  { label: 'Activist',              pat: /activist|sc.13d|significant.stake|stake.in|position.in|disclosed.+interest/i },
  { label: 'Management Change',     pat: /appoint|new.ceo|new.cfo|new.chief|resign|step.down|interim.ceo|administrerende|direktør|styreleder/i },
  { label: 'Capital Raise',         pat: /rights.issue|private.placement|share.issue|capital.raise|equity.offer|emission|kapitalforhøjelse|rettet.emissjon/i },
  { label: 'Clinical / Regulatory', pat: /phase [123]|clinical.trial|fda|ema.approv|regulatory.approv|data.read.?out|patient|efficacy/i },
  { label: 'Partnership / JV',      pat: /partnership|joint.venture|collaboration|licens|strategic.agreement|samarbeidsavtale/i },
  { label: 'Contract / Order',      pat: /contract|order.win|awarded|letter.of.intent|framework.agree|rammeavtale/i },
];

function classifyEvent(text) {
  for (const { label, pat } of CATEGORIES) {
    if (pat.test(text)) return label;
  }
  return 'Announcement';
}

function feedItemToFiling(item, region) {
  const searchText = `${item.title} ${item.description || ''}`;
  if (EARNINGS_FILTER.test(searchText)) return null;
  // Company name: GNW puts it in item.company (parsed from <author>)
  // Fallback: "Company Name - Headline" format or first segment before ":"
  const name = item.company
    || (item.title.includes(' - ') ? item.title.split(' - ')[0].trim() : null)
    || item.title.split(':')[0].trim();
  return {
    name,
    ticker:   null,
    exchange: item.exchange,
    date:     item.pubDate,
    event_type:  classifyEvent(searchText),
    headline:    item.title,
    summary:     item.description || item.title,
    region,
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const {
    events    = [],
    lookback  = 'past 7 days',
    universe  = 'Nordic + US',
    exchanges = ['US', 'Canada', 'Oslo', 'Stockholm', 'Copenhagen', 'Helsinki'],
  } = req.body;

  const { start, end } = lookbackDates(lookback);
  const notNordicOnly = universe !== 'Nordic only';
  const notUSOnly     = universe !== 'US only';
  const notCAOnly     = universe !== 'Canada only';
  const inclUS     = notNordicOnly && notCAOnly  && exchanges.includes('US');
  const inclCA     = notNordicOnly && notUSOnly  && exchanges.includes('Canada');
  const inclOslo   = notUSOnly     && notCAOnly  && exchanges.includes('Oslo');
  const inclSto    = notUSOnly     && notCAOnly  && exchanges.includes('Stockholm');
  const inclCph    = notUSOnly     && notCAOnly  && exchanges.includes('Copenhagen');
  const inclHel    = notUSOnly     && notCAOnly  && exchanges.includes('Helsinki');
  const inclNordic = inclOslo || inclSto || inclCph || inclHel;

  const raw   = [];
  const tasks = [];

  // ── US: SEC EDGAR ──────────────────────────────────────────────────────────
  const edgarPush = (type, summary) => x => raw.push({
    name:       x.entity,
    ticker:     null,          // resolved later via tickerMap
    exchange:   'US',
    date:       x.date,
    event_type: type,
    headline:   `${x.entity} — ${x.form_type || type}`,
    summary,
    region:     'us',
    _entity:    x.entity,      // kept for ticker lookup
    accession:  x.accession,
  });

  if (inclUS) {
    if (events.includes('Spinoffs/carve-outs'))
      tasks.push(edgarSearch({ keywords: ['spin-off','spinoff','carve-out','split-off'], form: '8-K', start, end })
        .then(h => h.forEach(edgarPush('Spinoff/Carve-out', '8-K filing: spin-off, carve-out, or split-off announcement'))));

    if (events.includes('Significant buybacks'))
      tasks.push(edgarSearch({ keywords: ['repurchase program','share repurchase authorization','stock repurchase program'], form: '8-K', start, end })
        .then(h => h.forEach(edgarPush('Share Buyback', '8-K filing: share repurchase program announced or authorised'))));

    if (events.includes('Insider purchases'))
      tasks.push(getForm4Issuers(start, end)
        .then(h => h.forEach(edgarPush('Insider Purchase', 'Form 4 filed: insider securities transaction reported'))));

    if (events.includes('Strategic reviews/M&A'))
      tasks.push(edgarSearch({ keywords: ['strategic review','strategic alternatives','merger agreement','definitive agreement'], form: '8-K', start, end })
        .then(h => h.forEach(edgarPush('M&A', '8-K filing: strategic review, merger agreement, or sale process announced'))));

    if (events.includes('Activist involvement'))
      tasks.push(edgarSearch({ keywords: [], form: 'SC 13D', start, end })
        .then(h => h.forEach(edgarPush('Activist', 'SC 13D filed: activist investor disclosed significant stake (>5%)'))));

    if (events.includes('Management changes'))
      tasks.push(edgarSearch({ keywords: ['appointed as Chief Executive','new Chief Executive','new CEO'], form: '8-K', start, end, limit: 6 })
        .then(h => h.forEach(edgarPush('Management Change', '8-K filing: CEO or senior executive appointment or departure'))));

    if (events.includes('Core biz inflecting'))
      tasks.push(edgarSearch({ keywords: ['record revenue','record earnings','first profitable','inflection point'], form: '8-K', start, end })
        .then(h => h.forEach(edgarPush('Business Inflection', '8-K filing: record revenue, first profitable quarter, or business inflection point'))));
  }

  // ── Nordic + Canada: Globe Newswire by country ────────────────────────────
  // Oslo Bors / Nasdaq Nordic return JS-rendered HTML from Vercel — unusable.
  // Globe Newswire confirmed working (isXML:true, 20 items).
  for (const [flag, exchange, region] of [
    [inclOslo, 'Oslo',       'nordic'],
    [inclSto,  'Stockholm',  'nordic'],
    [inclCph,  'Copenhagen', 'nordic'],
    [inclHel,  'Helsinki',   'nordic'],
    [inclCA,   'Canada',     'canada'],
  ]) {
    if (flag)
      tasks.push(globeNewswireFeed(exchange)
        .then(items => items.forEach(item => {
          const f = feedItemToFiling(item, region);
          if (f) raw.push(f);
        })));
  }

  // Run filings + ticker map fetch in parallel
  const [, tickerMap] = await Promise.all([
    Promise.allSettled(tasks),
    inclUS ? buildTickerMap() : Promise.resolve(new Map()),
  ]);

  // Enrich US filings with resolved tickers; strip internal _entity field
  const filings = raw.map(({ _entity, ...f }) => ({
    ...f,
    ticker: f.region === 'us' ? (findTicker(_entity || f.name, tickerMap) || null) : null,
  }));

  return res.json({ filings: filings.slice(0, 50), start, end, total: filings.length });
}
