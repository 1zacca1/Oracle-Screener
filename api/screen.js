const FMP = 'https://financialmodelingprep.com/api';

// FMP exchange codes (verified)
const NORDIC = ['OSE', 'STO', 'CSE', 'HEL'];
const US     = ['NYSE', 'NASDAQ'];

function getExchanges(universe) {
  if (universe === 'Nordic only') return NORDIC;
  if (universe === 'US only')     return US;
  return [...US, ...NORDIC]; // US first — better FMP coverage
}

function parseMktCap(mktcap) {
  if (mktcap?.includes('Micro'))  return { min: 10_000_000,    max: 250_000_000   };
  if (mktcap?.includes('Small'))  return { min: 250_000_000,   max: 2_000_000_000 };
  if (mktcap?.includes('Mid'))    return { min: 2_000_000_000, max: 10_000_000_000};
  return { min: 50_000_000, max: null };
}

function fmtMktCap(v) {
  if (!v) return 'N/A';
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}b`;
  return `$${(v / 1e6).toFixed(0)}m`;
}

async function fmpGet(url) {
  const r = await fetch(url);
  if (!r.ok) return null;
  const d = await r.json();
  return d;
}

async function fetchCandidates(exchanges, min, max, key) {
  const all = [];
  for (const exchange of exchanges) {
    const p = new URLSearchParams({ exchange, isActivelyTrading: 'true', isEtf: 'false', limit: '50', apikey: key });
    if (min) p.set('marketCapMoreThan', String(min));
    if (max) p.set('marketCapLessThan', String(max));
    const data = await fmpGet(`${FMP}/v3/stock-screener?${p}`);
    if (Array.isArray(data)) all.push(...data);
  }
  // Deduplicate by symbol
  return [...new Map(all.map(s => [s.symbol, s])).values()];
}

async function fetchMetrics(symbol, key) {
  const data = await fmpGet(`${FMP}/v3/key-metrics-ttm/${symbol}?apikey=${key}`);
  if (!Array.isArray(data) || !data.length) return null;
  return data[0];
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const key = process.env.FMP_API_KEY;
  if (!key) return res.status(500).json({ error: 'FMP_API_KEY not set in Vercel environment variables.' });

  const { universe, mktcap, ev_ebit, fcf_yield, insider_own, inflection, focus } = req.body;

  const exchanges    = getExchanges(universe);
  const { min, max } = parseMktCap(mktcap);
  const maxEvEbitda  = parseFloat(ev_ebit)   || 5;
  const minFcfYield  = (parseFloat(fcf_yield) || 3) / 100;

  // 1 — Get candidates (sequential per exchange to avoid FMP rate limits)
  const candidates = await fetchCandidates(exchanges, min, max, key);
  if (!candidates.length) {
    return res.json({ stocks: [], debug: 'No candidates returned from FMP screener' });
  }

  // Shuffle for variety, cap at 20 to stay within Vercel's 10s timeout
  const sample = candidates.sort(() => Math.random() - 0.5).slice(0, 20);

  // 2 — Fetch key metrics in parallel (20 calls)
  const metricsResults = await Promise.allSettled(
    sample.map(s => fetchMetrics(s.symbol, key))
  );

  const enriched = sample
    .map((s, i) => {
      const m = metricsResults[i].status === 'fulfilled' ? metricsResults[i].value : null;
      return m ? { ...s, metrics: m } : null;
    })
    .filter(Boolean);

  // 3 — Score and filter
  // Primary: EV/EBITDA and FCF yield
  // Fallback: just EV/EBITDA if nothing passes both
  const passedBoth = enriched.filter(s => {
    const ev  = s.metrics.enterpriseValueOverEBITDATTM;
    const fcf = s.metrics.freeCashFlowYieldTTM;
    return ev != null && ev > 0 && ev <= maxEvEbitda
        && fcf != null && fcf >= minFcfYield;
  });

  const passedEv = enriched.filter(s => {
    const ev = s.metrics.enterpriseValueOverEBITDATTM;
    return ev != null && ev > 0 && ev <= maxEvEbitda;
  });

  const pool = passedBoth.length >= 3 ? passedBoth : passedEv;

  pool.sort((a, b) =>
    (a.metrics.enterpriseValueOverEBITDATTM ?? 999) -
    (b.metrics.enterpriseValueOverEBITDATTM ?? 999)
  );

  const stocks = pool.slice(0, 8).map(s => ({
    ticker:    s.symbol,
    exchange:  s.exchangeShortName || s.exchange || '',
    name:      s.companyName,
    mktcap:    fmtMktCap(s.marketCap),
    ev_ebitda: s.metrics.enterpriseValueOverEBITDATTM != null
      ? s.metrics.enterpriseValueOverEBITDATTM.toFixed(1) + 'x'
      : 'N/A',
    fcf_yield: s.metrics.freeCashFlowYieldTTM != null
      ? (s.metrics.freeCashFlowYieldTTM * 100).toFixed(1) + '%'
      : 'N/A',
    pe:        s.metrics.peRatioTTM != null ? s.metrics.peRatioTTM.toFixed(1) : 'N/A',
    region:    NORDIC.includes(s.exchangeShortName || s.exchange) ? 'nordic' : 'us',
  }));

  return res.json({
    stocks,
    debug: {
      candidates: candidates.length,
      enriched: enriched.length,
      passedBoth: passedBoth.length,
      passedEvOnly: passedEv.length,
    },
  });
}
