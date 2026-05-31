const FMP = 'https://financialmodelingprep.com/api';

export default async function handler(req, res) {
  const key = process.env.FMP_API_KEY;
  if (!key) return res.status(500).json({ error: 'No FMP_API_KEY' });

  const results = {};

  // Test 1: screener with no exchange filter (US, any mktcap)
  const s1 = await fetch(`${FMP}/v3/stock-screener?isActivelyTrading=true&isEtf=false&limit=5&apikey=${key}`);
  results.screener_nofilter = await s1.json();

  // Test 2: screener with country=US
  const s2 = await fetch(`${FMP}/v3/stock-screener?country=US&isActivelyTrading=true&isEtf=false&limit=5&apikey=${key}`);
  results.screener_US = await s2.json();

  // Test 3: screener with exchange=NYSE
  const s3 = await fetch(`${FMP}/v3/stock-screener?exchange=NYSE&isActivelyTrading=true&isEtf=false&limit=5&apikey=${key}`);
  results.screener_NYSE = await s3.json();

  // Test 4: screener with country=NO (Norway)
  const s4 = await fetch(`${FMP}/v3/stock-screener?country=NO&isActivelyTrading=true&isEtf=false&limit=5&apikey=${key}`);
  results.screener_Norway = await s4.json();

  // Test 5: key metrics for AAPL (known working)
  const s5 = await fetch(`${FMP}/v3/key-metrics-ttm/AAPL?apikey=${key}`);
  results.metrics_AAPL = await s5.json();

  // Test 6: key metrics for first result of nofilter screener
  if (Array.isArray(results.screener_nofilter) && results.screener_nofilter[0]) {
    const sym = results.screener_nofilter[0].symbol;
    const s6 = await fetch(`${FMP}/v3/key-metrics-ttm/${sym}?apikey=${key}`);
    results[`metrics_${sym}`] = await s6.json();
  }

  return res.json(results);
}
