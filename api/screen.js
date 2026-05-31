// Yahoo Finance quoteSummary — no API key, no auth required
// Uses curated universe; YF screener POST now requires crumb auth so we skip it

const YF = 'https://query2.finance.yahoo.com';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
};

// ── Curated universes ─────────────────────────────────────────────────────────
const US_UNIVERSE = [
  // Industrials / Manufacturing
  'AAON','APOG','ARCB','GXO','HNI','MGRC','PATK','PLXS','POWL','SCSC',
  'SSD','TREX','WDFC','GATX','AWI','BMI','CFX','WMS','AAON','HLIO',
  'KFRC','MYRG','NVEE','TPI','ASTE','ROAD','BWXT','DRS','HAYW','SMPL',
  // Technology (value)
  'CNXC','CSG','NSIT','PLUS','SPOK','UTMD','HCKT','CDNS','PRFT','SAIC',
  'CACI','LDOS','MTC','KEYW','SIEN','PCTY','ALTR','COHU','ONTO','SMTC',
  // Financials (community banks, BDCs)
  'AROW','BMTC','GBCI','HTBK','INDB','MBWM','RNST','TCBK','UMBF','WSBC',
  'IBTX','SBCF','FFBC','FRME','OVLY','HBT','CBTX','NBTB','BSVN','HBCP',
  'MAIN','TCPC','HTGC','GAIN','TPVG','ARCC','SLRC','MFIN','FCNCA','BRKL',
  // Healthcare
  'HALO','LMAT','MMSI','OMCL','PDCO','PRGO','ANIK','IART','PCRX','SEM',
  'AMED','ADUS','ACCD','CCRN','ENSG','OPCH','PHR','PINC','SGRY','TRHC',
  // Consumer
  'BOOT','DORM','HIBB','MRTN','SBH','SCVL','EPC','HOFT','LESL','LQDT',
  'CHEF','CATO','CONN','DBI','DLTH','FLXS','GMAN','JOUT','KIRK','RCKY',
  // Energy (value / FCF)
  'CIVI','CPE','SM','TALO','WHD','RES','CRK','GPOR','KOS','MGY',
  'ESTE','HPK','VTLE','MTDR','CHRD','FLNC','PTEN','NR','NEX','OII',
  // REITs / Real estate
  'BRT','CLPR','PINE','STAG','UE','VRE','NXRT','ILPT','IIPR','PLYM',
];

const NORDIC_UNIVERSE = [
  // Norway (Oslo)
  'BOUVET.OL','CRAYON.OL','DNO.OL','SRBNK.OL','ATEA.OL','KAHOT.OL',
  'AKSO.OL','NEL.OL','AKRBP.OL','SUBC.OL','PROTCT.OL','NSKOG.OL','MOWI.OL',
  // Sweden (Stockholm)
  'VOLCAR-B.ST','HUSQ-B.ST','CAST.ST','NCC-B.ST','DIOS.ST','BUFAB.ST',
  'LATO-B.ST','SWEC-B.ST','VITR.ST','SECU-B.ST','HIFA-B.ST','NIBE-B.ST',
  // Denmark (Copenhagen)
  'PNDORA.CO','COLO-B.CO','GN.CO','RBREW.CO','ROCK-B.CO','FLS.CO','CHR.CO',
  // Finland (Helsinki)
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
  if (v >= 1e9)  return `$${(v / 1e9).toFixed(1)}b`;
  return `$${(v / 1e6).toFixed(0)}m`;
}

async function quoteSummary(symbol) {
  try {
    const r = await fetch(
      `${YF}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=keyStatistics,financialData,price`,
      { headers: HEADERS }
    );
    if (!r.ok) return null;
    const d = await r.json();
    const result = d?.quoteSummary?.result?.[0];
    if (!result) return null;
    return { ks: result.keyStatistics, fd: result.financialData, pr: result.price };
  } catch { return null; }
}

function regionOf(symbol) {
  if (symbol.endsWith('.OL') || symbol.endsWith('.ST') ||
      symbol.endsWith('.CO') || symbol.endsWith('.HE')) return 'nordic';
  return 'us';
}

function exchangeOf(symbol) {
  if (symbol.endsWith('.OL')) return 'Oslo';
  if (symbol.endsWith('.ST')) return 'Stockholm';
  if (symbol.endsWith('.CO')) return 'Copenhagen';
  if (symbol.endsWith('.HE')) return 'Helsinki';
  return 'US';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { universe, mktcap, ev_ebit, fcf_yield } = req.body;
  const { min, max }  = parseMktCap(mktcap);
  const maxEv         = parseFloat(ev_ebit)    || 5;
  const minFcfYield   = (parseFloat(fcf_yield) || 3) / 100;
  const inclUS        = universe !== 'Nordic only';
  const inclNordic    = universe !== 'US only';

  // Build candidate list from universes
  let pool = [];
  if (inclUS)     pool.push(...US_UNIVERSE);
  if (inclNordic) pool.push(...NORDIC_UNIVERSE);

  // Shuffle and sample 30 for speed (Vercel 10s timeout)
  const sample = pool.sort(() => Math.random() - 0.5).slice(0, 30);

  // Fetch metrics in parallel
  const summaries = await Promise.allSettled(sample.map(s => quoteSummary(s)));

  const enriched = sample.map((sym, i) => {
    const m = summaries[i].status === 'fulfilled' ? summaries[i].value : null;
    if (!m) return null;

    const mktCapV   = m.pr?.marketCap?.raw;
    const evEbitda  = m.ks?.enterpriseToEbitda?.raw;
    const totalDebt = m.fd?.totalDebt?.raw  || 0;
    const totalCash = m.fd?.totalCash?.raw  || 0;
    const fcf       = m.fd?.freeCashflow?.raw;
    const ev        = mktCapV ? mktCapV + totalDebt - totalCash : null;
    const fcfYield  = ev && fcf ? fcf / ev : null;
    const name      = m.pr?.shortName || m.pr?.longName || sym;

    // Market cap filter
    if (mktCapV && min && mktCapV < min) return null;
    if (mktCapV && max && mktCapV > max) return null;

    return { sym, name, mktCapV, evEbitda, fcfYield, region: regionOf(sym), exchange: exchangeOf(sym) };
  }).filter(Boolean);

  // Filter: EV/EBITDA required; FCF yield as secondary
  const passed = enriched.filter(s => s.evEbitda != null && s.evEbitda > 0 && s.evEbitda <= maxEv);

  // Sort: stocks passing FCF filter first, then by lowest EV/EBITDA
  passed.sort((a, b) => {
    const aOk = (a.fcfYield ?? -1) >= minFcfYield ? 0 : 1;
    const bOk = (b.fcfYield ?? -1) >= minFcfYield ? 0 : 1;
    if (aOk !== bOk) return aOk - bOk;
    return (a.evEbitda ?? 999) - (b.evEbitda ?? 999);
  });

  // Fallback: if nothing passes EV filter, return lowest EV/EBITDA from enriched
  const results = passed.length ? passed : enriched
    .filter(s => s.evEbitda != null && s.evEbitda > 0)
    .sort((a, b) => a.evEbitda - b.evEbitda);

  if (!results.length) return res.json({ stocks: [] });

  const stocks = results.slice(0, 8).map(s => ({
    ticker:    s.sym,
    exchange:  s.exchange,
    name:      s.name,
    mktcap:    fmt(s.mktCapV),
    ev_ebitda: s.evEbitda != null ? s.evEbitda.toFixed(1) + 'x' : 'N/A',
    fcf_yield: s.fcfYield != null ? (s.fcfYield * 100).toFixed(1) + '%' : 'N/A',
    region:    s.region,
  }));

  return res.json({
    stocks,
    debug: { sampled: sample.length, enriched: enriched.length, passed: passed.length },
  });
}
