const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://finance.yahoo.com/',
};

async function tryFetch(label, url, opts = {}) {
  try {
    const r = await fetch(url, { headers: HEADERS, ...opts });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text.slice(0, 300); }
    return { label, status: r.status, ok: r.ok, data };
  } catch (e) {
    return { label, error: e.message };
  }
}

export default async function handler(req, res) {
  const results = await Promise.all([
    // Test 1: YF quoteSummary via query2
    tryFetch('yf_q2_AAPL',
      'https://query2.finance.yahoo.com/v10/finance/quoteSummary/AAPL?modules=keyStatistics,financialData,price'),

    // Test 2: YF quoteSummary via query1
    tryFetch('yf_q1_AAPL',
      'https://query1.finance.yahoo.com/v10/finance/quoteSummary/AAPL?modules=keyStatistics,financialData,price'),

    // Test 3: Nordic ticker
    tryFetch('yf_BOUVET',
      'https://query2.finance.yahoo.com/v10/finance/quoteSummary/BOUVET.OL?modules=keyStatistics,financialData,price'),

    // Test 4: SEC EDGAR company tickers
    tryFetch('sec_tickers',
      'https://www.sec.gov/files/company_tickers.json'),

    // Test 5: EDGAR EFTS search
    tryFetch('edgar_efts',
      'https://efts.sec.gov/LATEST/search-index?forms=8-K&dateRange=custom&startdt=2026-05-01&enddt=2026-05-31&q=%22spinoff%22'),
  ]);

  // Summarise YF result
  const aaplQ2 = results[0];
  const summary = {
    yf_query2_works: aaplQ2.ok && !!aaplQ2.data?.quoteSummary?.result?.[0]?.price?.marketCap?.raw,
    yf_query1_works: results[1].ok && !!results[1].data?.quoteSummary?.result?.[0]?.price?.marketCap?.raw,
    yf_nordic_works: results[2].ok && !!results[2].data?.quoteSummary?.result?.[0]?.price?.marketCap?.raw,
    sec_tickers_works: results[3].ok,
    edgar_efts_works: results[4].ok,
    AAPL_evEbitda: aaplQ2.data?.quoteSummary?.result?.[0]?.keyStatistics?.enterpriseToEbitda?.raw ?? 'null',
    AAPL_fcf: aaplQ2.data?.quoteSummary?.result?.[0]?.financialData?.freeCashflow?.raw ?? 'null',
    AAPL_mktCap: aaplQ2.data?.quoteSummary?.result?.[0]?.price?.marketCap?.raw ?? 'null',
    statuses: results.map(r => ({ label: r.label, status: r.status ?? r.error })),
  };

  return res.json(summary);
}
