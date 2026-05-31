// Real filings from SEC EDGAR + Oslo Bors Newsweb
// No API key required

const EFTS = 'https://efts.sec.gov/LATEST/search-index';
const UA   = { 'User-Agent': 'Oracle-Screener/1.0 contact@oracle-screener.app' };

function lookbackDates(lookback) {
  const end   = new Date();
  const days  = lookback?.includes('30') ? 30 : lookback?.includes('14') ? 14 : 7;
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  return {
    start: start.toISOString().split('T')[0],
    end:   end.toISOString().split('T')[0],
  };
}

async function edgarSearch({ keywords = [], form, start, end, limit = 8 }) {
  const params = new URLSearchParams({
    forms:     form,
    dateRange: 'custom',
    startdt:   start,
    enddt:     end,
  });
  if (keywords.length) params.set('q', keywords.map(k => `"${k}"`).join(' OR '));

  try {
    const r = await fetch(`${EFTS}?${params}`, { headers: UA });
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

async function newswebOslo(start, end) {
  try {
    // Oslo Bors Newsweb RSS feed
    const r = await fetch(
      `https://newsweb.oslobors.no/message/browsecategory?category=OB&from=${start}&to=${end}&output=rss`,
      { headers: { 'User-Agent': 'Oracle-Screener/1.0' } }
    );
    const text = await r.text();
    const items = [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
      const get = (tag) => m[1].match(new RegExp(`<${tag}[^>]*>(?:<![CDATA[)?(.*?)(?:]]>)?<\/${tag}>`, 's'))?.[1]?.trim() || '';
      return { title: get('title'), pubDate: get('pubDate') };
    });
    return items.slice(0, 12);
  } catch { return []; }
}

async function nasdaqNordicRSS(start, end) {
  try {
    const r = await fetch(
      'https://www.nasdaqomxnordic.com/feeds/news?market=nordic&newstype=corp',
      { headers: { 'User-Agent': 'Oracle-Screener/1.0' } }
    );
    const text = await r.text();
    const items = [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
      const title   = m[1].match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g,'').trim() || '';
      const pubDate = m[1].match(/<pubDate>(.*?)<\/pubDate>/)?.[1]?.trim() || '';
      return { title, pubDate };
    }).filter(item => {
      if (!item.pubDate) return true;
      const d = new Date(item.pubDate);
      return d >= new Date(start) && d <= new Date(end + 'T23:59:59');
    });
    return items.slice(0, 10);
  } catch { return []; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const {
    events   = [],
    lookback = 'past 7 days',
    universe = 'Nordic + US',
    sector   = 'any',
  } = req.body;

  const { start, end } = lookbackDates(lookback);
  const inclUS     = universe !== 'Nordic only';
  const inclNordic = universe !== 'US only';

  const filings = [];
  const tasks   = [];

  // ── US: SEC EDGAR ────────────────────────────────────────────
  if (inclUS) {
    if (events.includes('Spinoffs/carve-outs')) {
      tasks.push(edgarSearch({
        keywords: ['spin-off','spinoff','carve-out','split-off','separation of'],
        form: '8-K', start, end,
      }).then(hits => hits.forEach(h => filings.push({ ...h, event_type: 'Spinoff/Carve-out', region: 'us' }))));
    }

    if (events.includes('Significant buybacks')) {
      tasks.push(edgarSearch({
        keywords: ['repurchase program','share repurchase authorization','stock repurchase program'],
        form: '8-K', start, end,
      }).then(hits => hits.forEach(h => filings.push({ ...h, event_type: 'Buyback', region: 'us' }))));
    }

    if (events.includes('Insider purchases')) {
      // Form 4 with open-market purchase transactions
      tasks.push(edgarSearch({
        keywords: ['Open Market Purchase','direct purchase','acquisition of shares'],
        form: '4', start, end, limit: 15,
      }).then(hits => hits.forEach(h => filings.push({ ...h, event_type: 'Insider Purchase', region: 'us' }))));
    }

    if (events.includes('Strategic reviews/M&A')) {
      tasks.push(edgarSearch({
        keywords: ['strategic review','strategic alternatives','merger agreement','definitive agreement','acquisition agreement'],
        form: '8-K', start, end,
      }).then(hits => hits.forEach(h => filings.push({ ...h, event_type: 'Strategic Review/M&A', region: 'us' }))));
    }

    if (events.includes('Activist involvement')) {
      tasks.push(edgarSearch({
        keywords: [],
        form: 'SC 13D', start, end,
      }).then(hits => hits.forEach(h => filings.push({ ...h, event_type: 'Activist (SC 13D)', region: 'us' }))));
    }

    if (events.includes('Management changes')) {
      tasks.push(edgarSearch({
        keywords: ['appointed as Chief Executive','new Chief Executive','new CEO','President and Chief Executive'],
        form: '8-K', start, end, limit: 6,
      }).then(hits => hits.forEach(h => filings.push({ ...h, event_type: 'Management Change', region: 'us' }))));
    }

    if (events.includes('Core biz inflecting')) {
      tasks.push(edgarSearch({
        keywords: ['record revenue','record earnings','profitability milestone','first profitable quarter','inflection'],
        form: '8-K', start, end,
      }).then(hits => hits.forEach(h => filings.push({ ...h, event_type: 'Business Inflection', region: 'us' }))));
    }
  }

  // ── Nordic: Oslo Bors Newsweb + Nasdaq Nordic ─────────────────
  if (inclNordic) {
    tasks.push(
      newswebOslo(start, end).then(items => items.forEach(item =>
        filings.push({
          entity:     item.title.split(':')[0]?.trim() || 'Nordic Company',
          date:       item.pubDate,
          form_type:  'Announcement',
          event_type: 'Nordic Corporate Announcement',
          event_summary: item.title,
          region:     'nordic',
        })
      ))
    );
    tasks.push(
      nasdaqNordicRSS(start, end).then(items => items.forEach(item =>
        filings.push({
          entity:     item.title.split(':')[0]?.trim() || 'Nordic Company',
          date:       item.pubDate,
          form_type:  'Announcement',
          event_type: 'Nordic Corporate Announcement',
          event_summary: item.title,
          region:     'nordic',
        })
      ))
    );
  }

  await Promise.allSettled(tasks);

  return res.json({ filings: filings.slice(0, 50), start, end, total: filings.length });
}
