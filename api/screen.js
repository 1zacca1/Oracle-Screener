// Yahoo Finance based — no API key required
const YF = 'https://query2.finance.yahoo.com';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
};

// Curated Nordic small/mid-cap universe (Oslo, Stockholm, Copenhagen, Helsinki)
const NORDIC = [
  'BOUVET.OL','CRAYON.OL','DNO.OL','SRBNK.OL','ATEA.OL','KAHOT.OL','AKSO.OL',
  'NEL.OL','RECSI.OL','AKRBP.OL','SUBC.OL','PROTCT.OL','NSKOG.OL','MOWI.OL',
  'VOLCAR-B.ST','HUSQ-B.ST','CAST.ST','NCC-B.ST','DIOS.ST','BUFAB.ST',
  'LATO-B.ST','SWEC-B.ST','NIBE-B.ST','VITR.ST','SECU-B.ST','HIFA-B.ST',
  'PNDORA.CO','COLO-B.CO','GN.CO','RBREW.CO','ROCK-B.CO','FLS.CO','CHR.CO',
  'NESTE.HE','OUT1V.HE','TIETO.HE','KESKOB.HE','METSO.HE','WRT1V.HE','ORNBV.HE',
];

function parseMktCap(mktcap) {
  if (mktcap?.includes('Micro'))  return { min: 10e6,  max: 250e6 };
  if (mktcap?.includes('Small'))  return { min: 250e6, max: 2e9   };
  if (mktcap?.includes('Mid'))    return { min: 2e9,   max: 10e9  };
  return { min: 10e6, max: null };
}

function fmt(v) {
  if (v == null) return 'N/A';
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}b`;
  return `$${(v / 1e6).toFixed(0)}m`;
}

async function yfGet(url) {
  try {
    const r = await fetch(url, { headers: HEADERS });
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
}

async function quoteSummary(symbol) {
  const d = await yfGet(`${YF}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=keyStatistics,financialData,price`);
  const r = d?.quoteSummary?.result?.[0];
  if (!r) return null;
  return { ks: r.keyStatistics, fd: r.financialData, pr: r.price };
}

async function yfScreenerUS(min, max, maxEv) {
  const ops = [
    { operator: 'gt', operands: ['intradaymarketcap', min || 10e6] },
    { operator: 'gt', operands: ['enterprisevalueebidta', 0.1] },
    { operator: 'lt', operands: ['enterprisevalueebidta', maxEv] },
  ];
  if (max) ops.push({ operator: 'lt', operands: ['intradaymarketcap', max] });

  try {
    const r = await fetch(`${YF}/v1/finance/screener`, {
      method: 'POST',
      headers: { ...HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        offset: 0, size: 30,
        sortField: 'intradaymarketcap', sortType: 'asc',
        quoteType: 'EQUITY',
        query: { operator: 'and', operands: ops },
        userId: '', userIdType: 'guid',
      }),
    });
    const d = await r.json();
    return d?.finance?.result?.[0]?.quotes || [];
  } catch { return []; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { universe, mktcap, ev_ebit, fcf_yield } = req.body;
  const { min, max }  = parseMktCap(mktcap);
  const maxEv         = parseFloat(ev_ebit)   || 5;
  const minFcfYield   = (parseFloat(fcf_yield) || 3) / 100;
  const inclUS        = universe !== 'Nordic only';
  const inclNordic    = universe !== 'US only';

  let candidates = [];

  if (inclUS) {
    const hits = await yfScreenerUS(min, max, maxEv);
    candidates.push(...hits.map(q => ({
      symbol:   q.symbol,
      name:     q.shortName || q.longName || q.symbol,
      exchange: q.fullExchangeName || 'US',
      region:   'us',
      mktCap:   q.marketCap,
    })));
  }

  if (inclNordic) {
    const sample = [...NORDIC].sort(() => Math.random() - 0.5).slice(0, 15);
    candidates.push(...sample.map(sym => ({
      symbol:   sym,
      name:     sym,
      exchange: sym.endsWith('.OL') ? 'Oslo' : sym.endsWith('.ST') ? 'Stockholm'
               : sym.endsWith('.CO') ? 'Copenhagen' : 'Helsinki',
      region:   'nordic',
      mktCap:   null,
    })));
  }

  if (!candidates.length) return res.json({ stocks: [] });

  // Fetch metrics in parallel (cap at 25 to stay within 10s Vercel timeout)
  const pool = candidates.slice(0, 25);
  const summaries = await Promise.allSettled(pool.map(c => quoteSummary(c.symbol)));

  const enriched = pool.map((c, i) => {
    const m = summaries[i].status === 'fulfilled' ? summaries[i].value : null;
    if (!m) return null;

    const mktCapV  = m.pr?.marketCap?.raw  || c.mktCap;
    const totalDebt = m.fd?.totalDebt?.raw  || 0;
    const totalCash = m.fd?.totalCash?.raw  || 0;
    const fcf       = m.fd?.freeCashflow?.raw;
    const ev        = mktCapV ? mktCapV + totalDebt - totalCash : null;
    const evEbitda  = m.ks?.enterpriseToEbitda?.raw;
    const fcfYield  = ev && fcf ? fcf / ev : null;

    // Market cap filter for Nordic
    if (c.region === 'nordic' && mktCapV) {
      if (min && mktCapV < min) return null;
      if (max && mktCapV > max) return null;
    }

    return {
      ...c,
      name:     m.pr?.shortName || m.pr?.longName || c.name,
      mktCap:   mktCapV,
      evEbitda,
      fcfYield,
    };
  }).filter(Boolean);

  // Filter: EV/EBITDA is primary gate; FCF yield as secondary sort boost
  const filtered = enriched
    .filter(s => s.evEbitda != null && s.evEbitda > 0 && s.evEbitda <= maxEv)
    .sort((a, b) => {
      // Prefer stocks that also pass FCF filter
      const aFcf = (a.fcfYield ?? 0) >= minFcfYield ? 0 : 1;
      const bFcf = (b.fcfYield ?? 0) >= minFcfYield ? 0 : 1;
      if (aFcf !== bFcf) return aFcf - bFcf;
      return (a.evEbitda ?? 999) - (b.evEbitda ?? 999);
    });

  const stocks = filtered.slice(0, 8).map(s => ({
    ticker:    s.symbol,
    exchange:  s.exchange,
    name:      s.name,
    mktcap:    fmt(s.mktCap),
    ev_ebitda: s.evEbitda != null ? s.evEbitda.toFixed(1) + 'x' : 'N/A',
    fcf_yield: s.fcfYield != null ? (s.fcfYield * 100).toFixed(1) + '%' : 'N/A',
    region:    s.region,
  }));

  return res.json({
    stocks,
    debug: { candidates: candidates.length, enriched: enriched.length, filtered: filtered.length },
  });
}
