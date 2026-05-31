const FMP = 'https://financialmodelingprep.com/api';

const NORDIC = ['OSLO', 'STO', 'CPH', 'HEL'];
const US     = ['NYSE', 'NASDAQ'];

function getExchanges(universe) {
  if (universe === 'Nordic only') return NORDIC;
  if (universe === 'US only')     return US;
  return [...NORDIC, ...US];
}

function parseMktCap(mktcap) {
  if (mktcap?.includes('Micro'))  return { min: 10_000_000,     max: 250_000_000   };
  if (mktcap?.includes('Small'))  return { min: 250_000_000,    max: 2_000_000_000 };
  if (mktcap?.includes('Mid'))    return { min: 2_000_000_000,  max: 10_000_000_000};
  return { min: 50_000_000, max: null };
}

function fmtMktCap(v) {
  if (!v) return 'N/A';
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}b`;
  return `$${(v / 1e6).toFixed(0)}m`;
}

async function screenerPage(exchange, min, max, key) {
  const p = new URLSearchParams({
    exchange,
    isActivelyTrading: 'true',
    isEtf: 'false',
    limit: '50',
    apikey: key,
  });
  if (min) p.set('marketCapMoreThan', String(min));
  if (max) p.set('marketCapLessThan', String(max));
  const r = await fetch(`${FMP}/v3/stock-screener?${p}`);
  const d = await r.json();
  return Array.isArray(d) ? d : [];
}

async function keyMetrics(symbol, key) {
  const r = await fetch(`${FMP}/v3/key-metrics-ttm/${symbol}?apikey=${key}`);
  const d = await r.json();
  return Array.isArray(d) && d.length ? d[0] : null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const key = process.env.FMP_API_KEY;
  if (!key) return res.status(500).json({ error: 'FMP_API_KEY not set in Vercel environment variables.' });

  const { universe, mktcap, ev_ebit, fcf_yield, insider_own, inflection, focus } = req.body;

  const exchanges   = getExchanges(universe);
  const { min, max } = parseMktCap(mktcap);
  const maxEvEbitda  = parseFloat(ev_ebit)   || 5;
  const minFcfYield  = (parseFloat(fcf_yield) || 8) / 100;

  // 1 — Pull candidates from each exchange in parallel
  const pages = await Promise.allSettled(exchanges.map(e => screenerPage(e, min, max, key)));
  const all   = pages.filter(r => r.status === 'fulfilled').flatMap(r => r.value);

  // Deduplicate, then take a random slice of 25 to stay within Vercel timeout
  const unique = [...new Map(all.map(s => [s.symbol, s])).values()];
  const sample = unique.sort(() => Math.random() - 0.5).slice(0, 25);

  if (!sample.length) return res.json({ stocks: [] });

  // 2 — Fetch key metrics for each candidate in parallel
  const enriched = await Promise.allSettled(
    sample.map(async s => {
      const m = await keyMetrics(s.symbol, key);
      return m ? { ...s, metrics: m } : null;
    })
  );

  const valid = enriched
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value);

  // 3 — Filter by EV/EBITDA and FCF yield
  const filtered = valid.filter(s => {
    const ev  = s.metrics.enterpriseValueOverEBITDATTM;
    const fcf = s.metrics.freeCashFlowYieldTTM;
    return ev > 0 && ev <= maxEvEbitda && fcf >= minFcfYield;
  });

  filtered.sort((a, b) =>
    a.metrics.enterpriseValueOverEBITDATTM - b.metrics.enterpriseValueOverEBITDATTM
  );

  // 4 — Shape output for the frontend / Claude
  const stocks = filtered.slice(0, 8).map(s => ({
    ticker:    s.symbol,
    exchange:  s.exchangeShortName || s.exchange,
    name:      s.companyName,
    mktcap:    fmtMktCap(s.marketCap),
    ev_ebitda: s.metrics.enterpriseValueOverEBITDATTM?.toFixed(1) + 'x',
    fcf_yield: (s.metrics.freeCashFlowYieldTTM * 100).toFixed(1) + '%',
    pe:        s.metrics.peRatioTTM?.toFixed(1) ?? 'N/A',
    region:    NORDIC.includes(s.exchangeShortName || s.exchange) ? 'nordic' : 'us',
  }));

  return res.json({ stocks, filters: { universe, mktcap, ev_ebit, fcf_yield, insider_own, inflection, focus } });
}
