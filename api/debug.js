export default async function handler(req, res) {
  const UA_SEC   = { 'User-Agent': 'Oracle-Screener/1.0 contact@oracle-screener.app' };
  const UA_PLAIN = { 'User-Agent': 'Mozilla/5.0' };
  const out = {};

  // Test 1: SEC company tickers (CIK lookup)
  try {
    const r = await fetch('https://www.sec.gov/files/company_tickers.json', { headers: UA_SEC });
    const d = await r.json();
    const aapl = Object.values(d).find(e => e.ticker === 'AAPL');
    out.sec_tickers_ok = !!aapl;
    out.sec_aapl_cik   = aapl?.cik_str;
  } catch (e) { out.sec_tickers_err = e.message; }

  // Test 2: EDGAR XBRL company concept (operating cash flow for AAPL CIK=320193)
  try {
    const r = await fetch(
      'https://data.sec.gov/api/xbrl/companyconcept/CIK0000320193/us-gaap/NetCashProvidedByUsedInOperatingActivities.json',
      { headers: UA_SEC }
    );
    const d = await r.json();
    const entries = d?.units?.USD || [];
    const annual = entries.filter(e => e.form === '10-K').sort((a, b) => b.end.localeCompare(a.end));
    out.edgar_xbrl_ok        = r.ok && annual.length > 0;
    out.edgar_aapl_ocf       = annual[0]?.val;
    out.edgar_aapl_ocf_end   = annual[0]?.end;
  } catch (e) { out.edgar_xbrl_err = e.message; }

  // Test 3: EDGAR XBRL capex for AAPL
  try {
    const r = await fetch(
      'https://data.sec.gov/api/xbrl/companyconcept/CIK0000320193/us-gaap/PaymentsToAcquirePropertyPlantAndEquipment.json',
      { headers: UA_SEC }
    );
    const d = await r.json();
    const annual = (d?.units?.USD || []).filter(e => e.form === '10-K').sort((a, b) => b.end.localeCompare(a.end));
    out.edgar_aapl_capex = annual[0]?.val;
  } catch (e) { out.edgar_capex_err = e.message; }

  // Test 4: Stooq price for AAPL
  try {
    const r = await fetch('https://stooq.com/q/d/l/?s=aapl.us&i=d', { headers: UA_PLAIN });
    const text = await r.text();
    const lines = text.trim().split('\n');
    const last = lines[lines.length - 1].split(',');
    out.stooq_ok           = r.ok && last.length >= 5;
    out.stooq_aapl_date    = last[0];
    out.stooq_aapl_close   = parseFloat(last[4]);
  } catch (e) { out.stooq_err = e.message; }

  // Test 5: Stooq price for Nordic (Oslo Bors)
  try {
    const r = await fetch('https://stooq.com/q/d/l/?s=bouvet.ol&i=d', { headers: UA_PLAIN });
    const text = await r.text();
    const lines = text.trim().split('\n');
    const last = lines[lines.length - 1].split(',');
    out.stooq_nordic_ok    = r.ok && last.length >= 5;
    out.stooq_bouvet_close = parseFloat(last[4]);
  } catch (e) { out.stooq_nordic_err = e.message; }

  // Test 6: EDGAR EFTS (for catalyst scanner)
  try {
    const r = await fetch(
      'https://efts.sec.gov/LATEST/search-index?forms=8-K&dateRange=custom&startdt=2026-05-01&enddt=2026-05-31&q=%22spinoff%22',
      { headers: UA_SEC }
    );
    const d = await r.json();
    out.edgar_efts_ok   = r.ok;
    out.edgar_efts_hits = d?.hits?.total?.value ?? 0;
  } catch (e) { out.edgar_efts_err = e.message; }

  return res.json(out);
}
