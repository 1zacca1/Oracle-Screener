const YF = 'https://query2.finance.yahoo.com';
const H = { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' };

export default async function handler(req, res) {
  const results = {};

  // Test 1: quoteSummary for a known ticker
  const r1 = await fetch(`${YF}/v10/finance/quoteSummary/AAPL?modules=keyStatistics,financialData,price`, { headers: H });
  const d1 = await r1.json();
  const m = d1?.quoteSummary?.result?.[0];
  results.AAPL = m ? {
    evEbitda:  m.keyStatistics?.enterpriseToEbitda?.raw,
    fcf:       m.financialData?.freeCashflow?.raw,
    mktCap:    m.price?.marketCap?.raw,
    totalDebt: m.financialData?.totalDebt?.raw,
    totalCash: m.financialData?.totalCash?.raw,
  } : d1;

  // Test 2: Nordic ticker
  const r2 = await fetch(`${YF}/v10/finance/quoteSummary/BOUVET.OL?modules=keyStatistics,financialData,price`, { headers: H });
  const d2 = await r2.json();
  const m2 = d2?.quoteSummary?.result?.[0];
  results.BOUVET_OL = m2 ? {
    evEbitda:  m2.keyStatistics?.enterpriseToEbitda?.raw,
    fcf:       m2.financialData?.freeCashflow?.raw,
    mktCap:    m2.price?.marketCap?.raw,
  } : d2;

  // Test 3: YF screener POST
  const r3 = await fetch(`${YF}/v1/finance/screener`, {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      offset: 0, size: 5,
      sortField: 'intradaymarketcap', sortType: 'asc',
      quoteType: 'EQUITY',
      query: { operator: 'and', operands: [
        { operator: 'gt', operands: ['enterprisevalueebidta', 0.1] },
        { operator: 'lt', operands: ['enterprisevalueebidta', 6] },
        { operator: 'gt', operands: ['intradaymarketcap', 50e6] },
        { operator: 'lt', operands: ['intradaymarketcap', 2e9] },
      ]},
      userId: '', userIdType: 'guid',
    }),
  });
  const d3 = await r3.json();
  results.screener = d3?.finance?.result?.[0]?.quotes?.map(q => ({
    symbol: q.symbol, name: q.shortName, mktCap: q.marketCap,
  })) ?? d3;

  return res.json(results);
}
