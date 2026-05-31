// Yahoo Finance with crumb authentication
// Crumb must be fetched first, then used in all subsequent requests

const YF = 'https://query2.finance.yahoo.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ── Curated universes ─────────────────────────────────────────────────────────
const US_UNIVERSE = [
  'AAON','APOG','ARCB','GXO','HNI','MGRC','PATK','PLXS','POWL','SCSC',
  'SSD','TREX','WDFC','GATX','AWI','BMI','CFX','WMS','HLIO','KFRC',
  'MYRG','NVEE','ASTE','ROAD','BWXT','HAYW','SMPL','CNXC','CSG','NSIT',
  'PLUS','SPOK','UTMD','HCKT','SAIC','CACI','COHU','ONTO','SMTC','PRFT',
  'AROW','BMTC','GBCI','HTBK','INDB','MBWM','RNST','TCBK','UMBF','WSBC',
  'IBTX','SBCF','FFBC','FRME','OVLY','HBT','CBTX','NBTB','BSVN','HBCP',
  'MAIN','TCPC','HTGC','GAIN','ARCC','MFIN','FCNCA','BRKL','HALO','LMAT',
  'MMSI','OMCL','PDCO','PRGO','ANIK','IART','PCRX','SEM','ENSG','OPCH',
  'BOOT','DORM','HIBB','MRTN','SBH','SCVL','EPC','HOFT','LESL','LQDT',
  'CHEF','CATO','CONN','DBI','DLTH','JOUT','KIRK','RCKY','CIVI','CPE',
  'SM','TALO','WHD','RES','CRK','GPOR','KOS','MGY','ESTE','HPK',
  'VTLE','MTDR','CHRD','PTEN','NR','NEX','OII','BRT','PINE','STAG',
];

const NORDIC_UNIVERSE = [
  'BOUVET.OL','CRAYON.OL','DNO.OL','SRBNK.OL','ATEA.OL','KAHOT.OL',
  'AKSO.OL','NEL.OL','AKRBP.OL','SUBC.OL','PROTCT.OL','NSKOG.OL',
  'VOLCAR-B.ST','HUSQ-B.ST','CAST.ST','NCC-B.ST','DIOS.ST','BUFAB.ST',
  'LATO-B.ST','SWEC-B.ST','VITR.ST','SECU-B.ST','NIBE-B.ST',
  'PNDORA.CO','COLO-B.CO','GN.CO','RBREW.CO','ROCK-B.CO','FLS.CO',
  'NESTE.HE','OUT1V.HE','TIETO.HE','KESKOB.HE','METSO.HE','WRT1V.HE',
];

// ── Yahoo Finance crumb auth ───────────────────────────────────────────────────
async function getYFAuth() {
  try {
    // Step 1: get session cookies
    const r1 = await fetch('https://finance.yahoo.com/', {
      headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' },
      redirect: 'follow',
    });
    const setCookie = r1.headers.get('set-cookie') || '';
    const cookies = setCookie.split(',').map(c => c.split(';')[0].trim()).filter(Boolean).join('; ');

    // Step 2: get crumb
    const r2 = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
      headers: { 'User-Agent': UA, 'Cookie': cookies },
    });
    const crumb = (await r2.text()).trim();
    if (!crumb || crumb.includes('{')) return null; // got JSON error instead of crumb
    return { crumb, cookies };
  } catch { return null; }
}

async function quoteSummary(symbol, auth) {
  try {
    const crumbQ = auth ? `&crumb=${encodeURIComponent(auth.crumb)}` : '';
    const r = await fetch(
      `${YF}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=keyStatistics,financialData,price${crumbQ}`,
      { headers: { 'User-Agent': UA, 'Accept': 'application/json', ...(auth ? { 'Cookie': auth.cookies } : {}) } }
    );
    if (!r.ok) return null;
    const d = await r.json();
    const result = d?.quoteSummary?.result?.[0];
    return result ? { ks: result.keyStatistics, fd: result.financialData, pr: result.price } : null;
  } catch { return null; }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
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
function regionOf(s) { return s.includes('.') ? 'nordic' : 'us'; }
function exchangeOf(s) {
  if (s.endsWith('.OL')) return 'Oslo';
  if (s.endsWith('.ST')) return 'Stockholm';
  if (s.endsWith('.CO')) return 'Copenhagen';
  if (s.endsWith('.HE')) return 'Helsinki';
  return 'US';
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { universe, mktcap, ev_ebit, fcf_yield } = req.body;
  const { min, max } = parseMktCap(mktcap);
  const maxEv       = parseFloat(ev_ebit)    || 5;
  const minFcfYield = (parseFloat(fcf_yield) || 3) / 100;
  const inclUS      = universe !== 'Nordic only';
  const inclNordic  = universe !== 'US only';

  // Get crumb + candidate pool in parallel
  let pool = [];
  if (inclUS)     pool.push(...US_UNIVERSE);
  if (inclNordic) pool.push(...NORDIC_UNIVERSE);
  const sample = pool.sort(() => Math.random() - 0.5).slice(0, 30);

  const [auth] = await Promise.all([getYFAuth()]);

  if (!auth) {
    return res.status(502).json({ error: 'Could not authenticate with Yahoo Finance. Try again in a moment.' });
  }

  // Fetch metrics in parallel
  const summaries = await Promise.allSettled(sample.map(s => quoteSummary(s, auth)));

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

    if (mktCapV && min && mktCapV < min) return null;
    if (mktCapV && max && mktCapV > max) return null;

    return {
      sym, evEbitda, fcfYield, mktCapV,
      name:     m.pr?.shortName || m.pr?.longName || sym,
      region:   regionOf(sym),
      exchange: exchangeOf(sym),
    };
  }).filter(Boolean);

  const passed = enriched.filter(s => s.evEbitda != null && s.evEbitda > 0 && s.evEbitda <= maxEv);
  passed.sort((a, b) => {
    const aOk = (a.fcfYield ?? -1) >= minFcfYield ? 0 : 1;
    const bOk = (b.fcfYield ?? -1) >= minFcfYield ? 0 : 1;
    return aOk !== bOk ? aOk - bOk : (a.evEbitda ?? 999) - (b.evEbitda ?? 999);
  });

  // Fallback: return lowest EV/EBITDA stocks even if nothing passes both filters
  const results = passed.length
    ? passed
    : enriched.filter(s => s.evEbitda != null && s.evEbitda > 0)
              .sort((a, b) => a.evEbitda - b.evEbitda);

  if (!results.length) return res.json({ stocks: [], debug: { enriched: enriched.length, sample: sample.length } });

  const stocks = results.slice(0, 8).map(s => ({
    ticker:    s.sym,
    exchange:  s.exchange,
    name:      s.name,
    mktcap:    fmt(s.mktCapV),
    ev_ebitda: s.evEbitda != null ? s.evEbitda.toFixed(1) + 'x' : 'N/A',
    fcf_yield: s.fcfYield != null ? (s.fcfYield * 100).toFixed(1) + '%' : 'N/A',
    region:    s.region,
  }));

  return res.json({ stocks, debug: { enriched: enriched.length, passed: passed.length } });
}
