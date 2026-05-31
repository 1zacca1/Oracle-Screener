const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export default async function handler(req, res) {
  const out = {};

  // Step 1: get cookies
  try {
    const r1 = await fetch('https://finance.yahoo.com/', {
      headers: { 'User-Agent': UA, 'Accept': 'text/html' }, redirect: 'follow',
    });
    const setCookie = r1.headers.get('set-cookie') || '';
    const cookies = setCookie.split(',').map(c => c.split(';')[0].trim()).filter(Boolean).join('; ');
    out.cookies_ok = !!cookies;
    out.cookies_sample = cookies.slice(0, 80);

    // Step 2: get crumb
    const r2 = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
      headers: { 'User-Agent': UA, 'Cookie': cookies },
    });
    const crumb = (await r2.text()).trim();
    out.crumb = crumb;
    out.crumb_ok = !!crumb && !crumb.includes('{');

    // Step 3: test quoteSummary with crumb
    if (out.crumb_ok) {
      const r3 = await fetch(
        `https://query2.finance.yahoo.com/v10/finance/quoteSummary/AAPL?modules=keyStatistics,financialData,price&crumb=${encodeURIComponent(crumb)}`,
        { headers: { 'User-Agent': UA, 'Cookie': cookies } }
      );
      const d3 = await r3.json();
      const result = d3?.quoteSummary?.result?.[0];
      out.AAPL_ok      = !!result;
      out.AAPL_evEbitda = result?.keyStatistics?.enterpriseToEbitda?.raw ?? null;
      out.AAPL_fcf      = result?.financialData?.freeCashflow?.raw ?? null;
      out.AAPL_mktCap   = result?.price?.marketCap?.raw ?? null;
      out.AAPL_error    = d3?.quoteSummary?.error ?? null;

      // Step 4: test Nordic ticker
      const r4 = await fetch(
        `https://query2.finance.yahoo.com/v10/finance/quoteSummary/BOUVET.OL?modules=keyStatistics,financialData,price&crumb=${encodeURIComponent(crumb)}`,
        { headers: { 'User-Agent': UA, 'Cookie': cookies } }
      );
      const d4 = await r4.json();
      const result4 = d4?.quoteSummary?.result?.[0];
      out.BOUVET_ok      = !!result4;
      out.BOUVET_evEbitda = result4?.keyStatistics?.enterpriseToEbitda?.raw ?? null;
      out.BOUVET_error    = d4?.quoteSummary?.error ?? null;
    }
  } catch (e) {
    out.error = e.message;
  }

  // Also test EDGAR (independent)
  try {
    const r5 = await fetch(
      'https://efts.sec.gov/LATEST/search-index?forms=8-K&dateRange=custom&startdt=2026-05-01&enddt=2026-05-31&q=%22spinoff%22',
      { headers: { 'User-Agent': 'Oracle-Screener/1.0 contact@example.com' } }
    );
    const d5 = await r5.json();
    out.edgar_ok    = r5.ok;
    out.edgar_hits  = d5?.hits?.total?.value ?? 0;
  } catch (e) {
    out.edgar_error = e.message;
  }

  return res.json(out);
}
