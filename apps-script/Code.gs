// ══════════════════════════════════════════════════════════════
// Prediction Watch — Google Apps Script
// Fetches data from prediction market & financial APIs,
// records to unified Data sheet. Run via time triggers.
// ══════════════════════════════════════════════════════════════

// ── Sheet helpers ─────────────────────────────────────────────

/** Safely convert a sheet cell value (Date object or string) to 'yyyy-MM-dd'. */
function sheetDateStr(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'UTC', 'yyyy-MM-dd');
  return v?.toString().trim().substring(0, 10) || '';
}

/** Get or create the unified Data sheet. Columns: graph_id, date, series, value */
function ensureDataSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Data');
  if (!sheet) {
    sheet = ss.insertSheet('Data');
    sheet.getRange('A1:D1').setValues([['graph_id', 'date', 'series', 'value']]);
    Logger.log(`Created Data sheet (GID: ${sheet.getSheetId()})`);
  }
  return sheet;
}

/** Build a Set of existing "graphId|date|series" keys from the Data sheet for dedup. */
function getExistingDataKeys(sheet) {
  const keys = new Set();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const gid = data[i][0]?.toString().trim();
    const d = sheetDateStr(data[i][1]);
    const s = data[i][2]?.toString().trim();
    if (gid && d && s) keys.add(`${gid}|${d}|${s}`);
  }
  return keys;
}

/** Append rows to Data sheet, deduplicating against existing keys. Returns count added. */
function appendDataRows(sheet, rows, existing) {
  const newRows = [];
  for (const row of rows) {
    const day = row[1].length >= 10 ? row[1].slice(0, 10) : row[1];
    const key = `${row[0]}|${day}|${row[2]}`;
    if (!existing.has(key)) {
      newRows.push(row);
      existing.add(key);
    }
  }
  if (newRows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, 4).setValues(newRows);
  }
  return newRows.length;
}

// ── Read Markets (Sources) from sheet ─────────────────────────

/** Read Sources tab dynamically. Returns array of source objects. */
function getSources(sheet) {
  if (!sheet) sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Sources');
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => h.toString().trim().toLowerCase());
  const sources = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const r = {};
    headers.forEach((h, j) => {
      const v = row[j];
      if (v instanceof Date) {
        r[h] = Utilities.formatDate(v, 'UTC', 'yyyy-MM-dd');
      } else {
        r[h] = v?.toString().trim() || '';
      }
    });
    if (!r['question_id'] || !r['platform'] || !r['slug']) continue;
    sources.push({
      graph_id: r['question_id'],
      platform: r['platform'].toLowerCase(),
      slug: r['slug'],
      label: r['label'] || '',
      url: r['url'] || '',
      param: r['param'] || '',
      color: r['color'] || '',
    });
  }
  return sources;
}

/** Filter sources by platform(s). */
function getSourcesByPlatform(platforms) {
  const all = getSources();
  const set = new Set(Array.isArray(platforms) ? platforms : [platforms]);
  return all.filter(s => set.has(s.platform));
}

// ── Recording functions (called by triggers) ──────────────────

/**
 * Record all data types in a single trigger call.
 * Runs: prediction market probabilities, yahoo prices, BLS indicators.
 */
function recordAll() {
  const sheet = ensureDataSheet();
  const existing = getExistingDataKeys(sheet);
  let totalAdded = 0;

  // 1. Prediction market probabilities
  const predSources = getSourcesByPlatform(['manifold', 'polymarket', 'kalshi', 'metaculus']);
  const timestamp = new Date().toISOString();
  const predRows = [];
  for (const s of predSources) {
    let prob = null;
    switch (s.platform) {
      case 'manifold':   prob = fetchManifold(s.slug); break;
      case 'polymarket': prob = fetchPolymarket(s.slug); break;
      case 'kalshi':     prob = fetchKalshi(s.slug); break;
      case 'metaculus':  prob = fetchMetaculus(s.slug, s.param); break;
    }
    if (prob !== null) predRows.push([s.graph_id, timestamp, s.slug, prob]);
  }
  const predAdded = appendDataRows(sheet, predRows, existing);
  Logger.log(`Probabilities: ${predAdded} recorded`);
  totalAdded += predAdded;

  // 2. Yahoo Finance prices
  const yahooSources = getSourcesByPlatform('yahoo');
  const priceRows = [];
  for (const s of yahooSources) {
    const points = fetchYahooHistory(s.slug, 5);
    if (!points || points.length === 0) { Logger.log(`${s.slug}: no data`); continue; }
    const [dateStr, close] = points[points.length - 1];
    priceRows.push([s.graph_id, dateStr, s.slug, close]);
  }
  const priceAdded = appendDataRows(sheet, priceRows, existing);
  Logger.log(`Prices: ${priceAdded} recorded`);
  totalAdded += priceAdded;

  // 3. BLS indicators (fetch current + previous year to catch recent releases)
  const blsSources = getSourcesByPlatform('bls');
  if (blsSources.length > 0) {
    const slugToGraph = {};
    for (const s of blsSources) slugToGraph[s.slug] = s.graph_id;
    const currentYear = new Date().getFullYear();
    const blsRows = fetchBLS(blsSources.map(s => s.slug), currentYear - 1, currentYear);
    const indRows = blsRows.map(([dateStr, seriesId, value]) =>
      [slugToGraph[seriesId] || seriesId, dateStr, seriesId, value]
    );
    const indAdded = appendDataRows(sheet, indRows, existing);
    Logger.log(`Indicators: ${indAdded} recorded`);
    totalAdded += indAdded;
  }

  Logger.log(`recordAll complete: ${totalAdded} total new rows`);
}

// Keep individual functions as aliases for manual use / backward compat
function recordAllProbabilities() { recordAll(); }
function recordPrices() { recordAll(); }
function recordIndicators() { recordAll(); }

// ── Platform API fetchers ─────────────────────────────────────
// Each returns a probability as a number 0-100, or null on error.
//
// Verified API response formats (April 2026):
//   Manifold:   GET /v0/slug/{slug}  → { probability: 0.439 }
//   Polymarket: GET gamma-api/markets?slug={slug} → [{ outcomePrices: '["0.23","0.77"]' }]
//   Kalshi:     GET api.elections.kalshi.com/trade-api/v2/markets/{ticker} → { market: { last_price_dollars: "0.0800" } }
//   Metaculus:  GET /api2/questions/{id}/ (requires auth token) → { community_prediction: { full: { q2: 0.45 } } }

function fetchManifold(slug) {
  try {
    // Slug is the question part of the URL, e.g. "will-we-get-agi-before-2030"
    // The /v0/slug/ endpoint returns { probability: 0.0-1.0 }
    const url = `https://api.manifold.markets/v0/slug/${slug}`;
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) {
      // Fallback: try as a market ID
      const url2 = `https://api.manifold.markets/v0/market/${slug}`;
      const resp2 = UrlFetchApp.fetch(url2, { muteHttpExceptions: true });
      if (resp2.getResponseCode() !== 200) return null;
      const data = JSON.parse(resp2.getContentText());
      return Math.round(data.probability * 1000) / 10;
    }
    const data = JSON.parse(resp.getContentText());
    return Math.round(data.probability * 1000) / 10; // e.g. 0.439 → 43.9
  } catch (e) {
    Logger.log(`Manifold error (${slug}): ${e}`);
    return null;
  }
}

function fetchPolymarket(slug) {
  try {
    // The gamma API returns an array of markets matching the slug.
    // outcomePrices is a JSON string: '["0.23","0.77"]' where index 0 = Yes probability.
    const url = `https://gamma-api.polymarket.com/markets?slug=${encodeURIComponent(slug)}`;
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return null;
    const data = JSON.parse(resp.getContentText());

    if (Array.isArray(data) && data.length > 0) {
      const market = data[0];
      // outcomePrices is a JSON-encoded string array like '["0.23","0.77"]'
      let prices = market.outcomePrices;
      if (typeof prices === 'string') prices = JSON.parse(prices);
      if (Array.isArray(prices) && prices.length > 0) {
        const yesPrice = parseFloat(prices[0]);
        if (!isNaN(yesPrice)) return Math.round(yesPrice * 1000) / 10; // e.g. 0.23 → 23.0
      }
    }

    return null;
  } catch (e) {
    Logger.log(`Polymarket error (${slug}): ${e}`);
    return null;
  }
}

function fetchKalshi(ticker) {
  try {
    // Kalshi's public read API is at api.elections.kalshi.com (no auth needed).
    // Response: { market: { last_price_dollars: "0.0800", yes_ask_dollars: "0.1000", ... } }
    // Prices are in dollar strings where $1.00 = 100%.
    const url = `https://api.elections.kalshi.com/trade-api/v2/markets/${ticker}`;
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return null;
    const data = JSON.parse(resp.getContentText());
    const market = data.market;
    if (!market) return null;
    // Prefer last_price_dollars, fall back to yes_bid/ask midpoint
    const lastPrice = parseFloat(market.last_price_dollars);
    if (!isNaN(lastPrice) && lastPrice > 0) return Math.round(lastPrice * 1000) / 10; // e.g. "0.0800" → 8.0
    const yesAsk = parseFloat(market.yes_ask_dollars);
    const yesBid = parseFloat(market.yes_bid_dollars);
    if (!isNaN(yesAsk) && !isNaN(yesBid)) return Math.round(((yesAsk + yesBid) / 2) * 1000) / 10;
    return null;
  } catch (e) {
    Logger.log(`Kalshi error (${ticker}): ${e}`);
    return null;
  }
}

function fetchMetaculus(questionId, cutoffDate) {
  try {
    const token = PropertiesService.getScriptProperties().getProperty('METACULUS_API_TOKEN');
    if (!token) {
      Logger.log('Metaculus: No API token set in Script Properties (METACULUS_API_TOKEN).');
      return null;
    }

    // v3 API — possibilities.continuous_range is the 201-point quantile (inverse CDF)
    const v3url = `https://www.metaculus.com/api/questions/${questionId}/`;
    const v3resp = UrlFetchApp.fetch(v3url, {
      muteHttpExceptions: true,
      headers: { 'Authorization': `Token ${token}` },
    });

    if (v3resp.getResponseCode() === 200) {
      const data = JSON.parse(v3resp.getContentText());
      const q = data.question || data;

      // Date question with cutoff: use continuous_range quantile array (in scaling or possibilities)
      const scaleInfo = q.scaling || q.possibilities;
      if (cutoffDate && scaleInfo && Array.isArray(scaleInfo.continuous_range)) {
        const result = calcProbFromQuantiles(scaleInfo.continuous_range, cutoffDate);
        if (result !== null) return result;
      }

      // Binary question via recency_weighted aggregation
      const agg = q.aggregations && q.aggregations.recency_weighted;
      if (agg && agg.latest) {
        if (cutoffDate && Array.isArray(agg.latest.cdf)) {
          const result = calcCdfAtCutoff(q, agg.latest, cutoffDate);
          if (result !== null) return result;
        }
        if (Array.isArray(agg.latest.centers) && agg.latest.centers.length > 0) {
          return Math.round(agg.latest.centers[0] * 1000) / 10;
        }
      }
    }

    // Fall back to v2 API
    const v2url = `https://www.metaculus.com/api2/questions/${questionId}/`;
    const v2resp = UrlFetchApp.fetch(v2url, {
      muteHttpExceptions: true,
      headers: { 'Authorization': `Token ${token}` },
    });
    if (v2resp.getResponseCode() !== 200) {
      Logger.log(`Metaculus API returned ${v2resp.getResponseCode()} for question ${questionId}`);
      return null;
    }
    const v2data = JSON.parse(v2resp.getContentText());

    if (cutoffDate) {
      const result = calcCdfAtCutoffV2(v2data, cutoffDate);
      if (result !== null) return result;
    }

    const cp = v2data.community_prediction;
    if (cp && cp.full && cp.full.q2 !== undefined) {
      return Math.round(cp.full.q2 * 1000) / 10;
    }
    return null;
  } catch (e) {
    Logger.log(`Metaculus error (${questionId}): ${e}`);
    return null;
  }
}

/**
 * Given a 201-point quantile array (inverse CDF) of ISO date strings from v3 API
 * (possibilities.continuous_range), compute P(date < cutoffDate) as a 0-100 probability.
 * quantiles[i] = the date x such that P(forecast_date <= x) = i/200.
 */
function calcProbFromQuantiles(quantiles, cutoffDate) {
  try {
    const n = quantiles.length;
    if (n < 2) return null;

    const target = new Date(cutoffDate).getTime();
    const timestamps = quantiles.map(d => new Date(d).getTime());

    if (target <= timestamps[0]) return 0;
    if (target >= timestamps[n - 1]) return 100;

    // Binary search for the surrounding quantile points
    let lo = 0, hi = n - 1;
    while (lo < hi - 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (timestamps[mid] <= target) lo = mid;
      else hi = mid;
    }

    // Interpolate: prob at lo is lo/(n-1), at hi is hi/(n-1)
    const frac = (target - timestamps[lo]) / (timestamps[hi] - timestamps[lo]);
    const prob = (lo + frac) / (n - 1);
    return Math.round(prob * 1000) / 10;
  } catch (e) {
    Logger.log(`calcProbFromQuantiles error: ${e}`);
    return null;
  }
}

/**
 * Given a v3 aggregation object with a CDF array and question scale info,
 * compute P(date < cutoffDate) as a 0-100 probability.
 * The CDF is a 201-point array where cdf[i] = P(value <= min + i*(max-min)/200).
 */
function calcCdfAtCutoff(question, aggLatest, cutoffDate) {
  try {
    const cdf = aggLatest.cdf;
    if (!Array.isArray(cdf) || cdf.length < 2) return null;

    const scale = (question.possibilities && question.possibilities.scale) ||
                  (question.scaling) || null;
    if (!scale) return null;

    const minVal = parseMetaculusScaleDate(scale.min || scale.range_min);
    const maxVal = parseMetaculusScaleDate(scale.max || scale.range_max);
    if (minVal === null || maxVal === null) return null;

    const targetVal = new Date(cutoffDate).getTime() / 1000; // seconds
    if (targetVal <= minVal) return 0;
    if (targetVal >= maxVal) return 100;

    // CDF has N points uniformly spanning [min, max]
    const n = cdf.length;
    const fraction = (targetVal - minVal) / (maxVal - minVal);
    const idx = fraction * (n - 1);
    const lo = Math.floor(idx);
    const hi = Math.min(lo + 1, n - 1);
    const interp = cdf[lo] + (cdf[hi] - cdf[lo]) * (idx - lo);
    return Math.round(interp * 1000) / 10;
  } catch (e) {
    Logger.log(`calcCdfAtCutoff error: ${e}`);
    return null;
  }
}

/**
 * V2 API fallback: use the histogram + scale from community_prediction.
 */
function calcCdfAtCutoffV2(data, cutoffDate) {
  try {
    const cp = data.community_prediction;
    if (!cp || !cp.full) return null;
    const histogram = cp.full.histogram;
    if (!Array.isArray(histogram) || histogram.length < 2) return null;

    const scale = data.possibilities && data.possibilities.scale;
    if (!scale) return null;

    const minVal = parseMetaculusScaleDate(scale.min);
    const maxVal = parseMetaculusScaleDate(scale.max);
    if (minVal === null || maxVal === null) return null;

    const targetVal = new Date(cutoffDate).getTime() / 1000;
    if (targetVal <= minVal) return 0;
    if (targetVal >= maxVal) return 100;

    const deriv = scale.deriv_ratio || 1;
    const a = (targetVal - minVal) / (maxVal - minVal);
    let scaled;
    if (Math.abs(deriv - 1) < 0.001) {
      scaled = a;
    } else {
      scaled = Math.log(a * (deriv - 1) + 1) / Math.log(deriv);
    }

    const n = histogram.length;
    const binIdx = Math.min(Math.floor(scaled * n), n - 1);
    let total = 0, cumulative = 0;
    for (let i = 0; i < n; i++) {
      total += histogram[i];
      if (i <= binIdx) cumulative += histogram[i];
    }
    if (total === 0) return null;
    return Math.round(cumulative / total * 1000) / 10;
  } catch (e) {
    Logger.log(`calcCdfAtCutoffV2 error: ${e}`);
    return null;
  }
}

/** Parse a Metaculus scale date — could be ISO string, Unix seconds, or YYYYMMDD integer */
function parseMetaculusScaleDate(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') {
    // If it looks like YYYYMMDD (8 digits), convert to timestamp
    if (val > 19000000 && val < 21000000) {
      const s = val.toString();
      return new Date(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`).getTime() / 1000;
    }
    return val; // assume already Unix seconds
  }
  if (typeof val === 'string') {
    return new Date(val).getTime() / 1000;
  }
  return null;
}

/** Debug helper: run this manually to inspect the raw API response for a question */
function logMetaculusQuestionFormat() {
  const questionId = 3479;
  const token = PropertiesService.getScriptProperties().getProperty('METACULUS_API_TOKEN');
  if (!token) { Logger.log('No token set'); return; }
  Logger.log(`Token stored (first 6 chars): ${token.slice(0, 6)}... length=${token.length}`);
  // Try v3 with auth
  const v3resp = UrlFetchApp.fetch(`https://www.metaculus.com/api/questions/${questionId}/`, {
    muteHttpExceptions: true, headers: { 'Authorization': `Token ${token}` },
  });
  Logger.log(`v3 status: ${v3resp.getResponseCode()}`);
  if (v3resp.getResponseCode() === 200) {
    const d = JSON.parse(v3resp.getContentText());
    Logger.log(`top-level keys: ${Object.keys(d)}`);
    const q = d.question || d;
    Logger.log(`q keys: ${Object.keys(q).slice(0, 20)}`);
    Logger.log(`q.possibilities: ${JSON.stringify(q.possibilities).slice(0, 100)}`);
    Logger.log(`q.scaling: ${JSON.stringify(q.scaling).slice(0, 200)}`);
    const scaleInfo = q.scaling || q.possibilities;
    const cr = scaleInfo && scaleInfo.continuous_range;
    Logger.log(`continuous_range present: ${!!cr}, length: ${cr ? cr.length : 0}`);
    if (cr && cr.length > 0) {
      Logger.log(`quantile[0]: ${cr[0]}, quantile[100]: ${cr[100]}, quantile[200]: ${cr[200]}`);
      const prob2030 = calcProbFromQuantiles(cr, '2030-01-01');
      Logger.log(`P(AGI before 2030): ${prob2030}%`);
    }
    const agg = q.aggregations && q.aggregations.recency_weighted && q.aggregations.recency_weighted.latest;
    if (agg) {
      Logger.log(`agg keys: ${Object.keys(agg)}`);
      if (agg.cdf) Logger.log(`cdf length: ${agg.cdf.length}, first: ${agg.cdf[0]}, last: ${agg.cdf[agg.cdf.length-1]}`);
      if (agg.histogram) Logger.log(`histogram length: ${agg.histogram.length}`);
    } else {
      Logger.log('no recency_weighted.latest found');
    }
  } else {
    Logger.log(`v3 error body: ${v3resp.getContentText().slice(0, 500)}`);
  }

  // Try v2 with auth
  const v2resp = UrlFetchApp.fetch(`https://www.metaculus.com/api2/questions/${questionId}/`, {
    muteHttpExceptions: true, headers: { 'Authorization': `Token ${token}` },
  });
  Logger.log(`v2 status: ${v2resp.getResponseCode()}`);
  if (v2resp.getResponseCode() === 200) {
    const d = JSON.parse(v2resp.getContentText());
    Logger.log(`possibilities.type: ${d.possibilities && d.possibilities.type}`);
    Logger.log(`possibilities.scale: ${JSON.stringify(d.possibilities && d.possibilities.scale)}`);
    const cp = d.community_prediction && d.community_prediction.full;
    if (cp) {
      Logger.log(`cp keys: ${Object.keys(cp)}`);
      if (cp.histogram) Logger.log(`v2 histogram length: ${cp.histogram.length}`);
      Logger.log(`q1/q2/q3: ${cp.q1} / ${cp.q2} / ${cp.q3}`);
    }
  } else {
    Logger.log(`v2 error body: ${v2resp.getContentText().slice(0, 500)}`);
  }

  // Try v2 without auth (to check if the question is publicly accessible)
  const v2pubResp = UrlFetchApp.fetch(`https://www.metaculus.com/api2/questions/${questionId}/`, {
    muteHttpExceptions: true,
  });
  Logger.log(`v2 no-auth status: ${v2pubResp.getResponseCode()}`);
  if (v2pubResp.getResponseCode() !== 200) {
    Logger.log(`v2 no-auth body: ${v2pubResp.getContentText().slice(0, 300)}`);
  }
}

// ── Backfill from APIs (run manually once) ─────────────────────

/**
 * Backfill historical prediction market data. Reads Sources for manifold/polymarket,
 * writes to unified Data sheet. Dedup-safe.
 */
function backfillHistory() {
  const sheet = ensureDataSheet();
  const sources = getSourcesByPlatform(['manifold', 'polymarket']);
  const existing = getExistingDataKeys(sheet);
  let totalRows = 0;

  for (const s of sources) {
    let rows = [];
    switch (s.platform) {
      case 'manifold':
        rows = backfillManifold(s.graph_id, s.slug);
        break;
      case 'polymarket':
        rows = backfillPolymarket(s.graph_id, s.slug);
        break;
    }
    const added = appendDataRows(sheet, rows, existing);
    if (added > 0) Logger.log(`${s.platform}/${s.slug}: added ${added} rows`);
    totalRows += added;
  }

  // Log platforms without history APIs
  const noHistory = getSourcesByPlatform(['kalshi', 'metaculus']);
  for (const s of noHistory) {
    Logger.log(`${s.platform}: No public history API for ${s.slug} — data collected going forward only`);
  }
  Logger.log(`Backfilled ${totalRows} total history rows`);
}

function backfillManifold(graphId, slug) {
  try {
    const marketUrl = `https://api.manifold.markets/v0/slug/${slug}`;
    const marketResp = UrlFetchApp.fetch(marketUrl, { muteHttpExceptions: true });
    if (marketResp.getResponseCode() !== 200) return [];
    const market = JSON.parse(marketResp.getContentText());
    const contractId = market.id;

    const betsUrl = `https://api.manifold.markets/v0/bets?contractId=${contractId}&limit=1000`;
    const betsResp = UrlFetchApp.fetch(betsUrl, { muteHttpExceptions: true });
    if (betsResp.getResponseCode() !== 200) return [];
    const bets = JSON.parse(betsResp.getContentText());

    const byDay = {};
    for (const bet of bets) {
      if (bet.probAfter === undefined) continue;
      const day = new Date(bet.createdTime).toISOString().slice(0, 10);
      byDay[day] = {
        timestamp: new Date(bet.createdTime).toISOString(),
        probability: Math.round(bet.probAfter * 1000) / 10,
      };
    }

    return Object.values(byDay)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      .map(p => [graphId, p.timestamp, slug, p.probability]);
  } catch (e) {
    Logger.log(`Manifold backfill error (${slug}): ${e}`);
    return [];
  }
}

function backfillPolymarket(graphId, slug) {
  try {
    const gammaUrl = `https://gamma-api.polymarket.com/markets?slug=${encodeURIComponent(slug)}`;
    const gammaResp = UrlFetchApp.fetch(gammaUrl, { muteHttpExceptions: true });
    let tokenId = slug;

    if (gammaResp.getResponseCode() === 200) {
      const gammaData = JSON.parse(gammaResp.getContentText());
      if (Array.isArray(gammaData) && gammaData.length > 0) {
        let tokenIds = gammaData[0].clobTokenIds;
        if (typeof tokenIds === 'string') tokenIds = JSON.parse(tokenIds);
        tokenId = (Array.isArray(tokenIds) && tokenIds.length > 0) ? tokenIds[0] : slug;
      }
    }

    const url = `https://clob.polymarket.com/prices-history?interval=all&market=${tokenId}&fidelity=60`;
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return [];
    const data = JSON.parse(resp.getContentText());
    const history = data.history || data;
    if (!Array.isArray(history)) return [];

    return history.map(point => [
      graphId,
      new Date(point.t * 1000).toISOString(),
      slug,
      Math.round(parseFloat(point.p) * 1000) / 10,
    ]);
  } catch (e) {
    Logger.log(`Polymarket backfill error (${slug}): ${e}`);
    return [];
  }
}

/** Backfill up to 5 years of daily prices for all yahoo sources. */
function backfillPrices() {
  const sheet = ensureDataSheet();
  const sources = getSourcesByPlatform('yahoo');
  const existing = getExistingDataKeys(sheet);
  let totalRows = 0;

  for (const s of sources) {
    const points = fetchYahooHistory(s.slug, 1825);
    if (!points) { Logger.log(`${s.slug}: fetch failed`); continue; }
    const rows = points.map(([dateStr, close]) => [s.graph_id, dateStr, s.slug, close]);
    const added = appendDataRows(sheet, rows, existing);
    Logger.log(`${s.slug}: added ${added} historical points`);
    totalRows += added;
  }
  Logger.log(`Backfilled ${totalRows} total price points`);
}

/** Backfill BLS indicators (10 years), reads series from Sources. */
function backfillIndicators() {
  const sheet = ensureDataSheet();
  const sources = getSourcesByPlatform('bls');
  if (sources.length === 0) { Logger.log('No BLS sources configured'); return; }
  const existing = getExistingDataKeys(sheet);

  const slugToGraph = {};
  for (const s of sources) slugToGraph[s.slug] = s.graph_id;

  const currentYear = new Date().getFullYear();
  const blsRows = fetchBLS(sources.map(s => s.slug), currentYear - 10, currentYear);
  const rows = blsRows.map(([dateStr, seriesId, value]) =>
    [slugToGraph[seriesId] || seriesId, dateStr, seriesId, value]
  );
  const added = appendDataRows(sheet, rows, existing);
  Logger.log(`Backfilled ${added} indicator points`);
}

// ── Yahoo Finance ─────────────────────────────────────────────

/** Fetch daily closes from Yahoo Finance. rangeDays controls how far back. */
function fetchYahooHistory(symbol, rangeDays) {
  const rangeParam =
    rangeDays <= 30  ? '1mo' :
    rangeDays <= 90  ? '3mo' :
    rangeDays <= 180 ? '6mo' :
    rangeDays <= 365 ? '1y'  :
    rangeDays <= 730 ? '2y'  : '5y';
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${rangeParam}&interval=1d`;
  try {
    const resp = UrlFetchApp.fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GoogleAppsScript)' },
      muteHttpExceptions: true,
    });
    if (resp.getResponseCode() !== 200) {
      Logger.log(`Yahoo ${symbol}: HTTP ${resp.getResponseCode()}`);
      return null;
    }
    const data = JSON.parse(resp.getContentText());
    const result = data.chart.result[0];
    const timestamps = result.timestamp;
    const closes = result.indicators.quote[0].close;
    const points = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (closes[i] == null) continue;
      const date = new Date(timestamps[i] * 1000);
      points.push([Utilities.formatDate(date, 'UTC', 'yyyy-MM-dd'), closes[i]]);
    }
    return points;
  } catch (e) {
    Logger.log(`Yahoo ${symbol} error: ${e.message}`);
    return null;
  }
}

// ── BLS Economic Indicators ───────────────────────────────────

/**
 * Fetch monthly BLS data for given series IDs.
 * Returns [[date, seriesId, value], ...]
 */
function fetchBLS(seriesIds, startYear, endYear) {
  const url = 'https://api.bls.gov/publicAPI/v2/timeseries/data/';
  const payload = JSON.stringify({ seriesid: seriesIds, startyear: String(startYear), endyear: String(endYear) });
  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: payload,
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() !== 200) {
    Logger.log(`BLS HTTP ${resp.getResponseCode()}`);
    return [];
  }
  const data = JSON.parse(resp.getContentText());
  if (data.status !== 'REQUEST_SUCCEEDED') {
    Logger.log(`BLS status: ${data.status} — ${JSON.stringify(data.message)}`);
    return [];
  }

  const rows = [];
  for (const series of data.Results.series) {
    for (const item of series.data) {
      const month = item.period.substring(1); // "M01" -> "01"
      if (month === '13') continue; // annual average
      const dateStr = `${item.year}-${month}-01`;
      const value = parseFloat(item.value);
      if (!isNaN(value)) rows.push([dateStr, series.seriesID, value]);
    }
  }
  return rows;
}

// ── METR Time Horizon data ────────────────────────────────────

/**
 * Fetch METR time horizon data, write to Data sheet.
 * Reads the graph_id from Sources where platform='metr'.
 */
function backfillMETR() {
  const sheet = ensureDataSheet();
  const metrSources = getSourcesByPlatform('metr');
  const graphId = metrSources.length > 0 ? metrSources[0].graph_id : 'metr-horizon';
  const existing = getExistingDataKeys(sheet);

  const resp = UrlFetchApp.fetch('https://metr.org/time-horizons/', { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) {
    Logger.log(`METR page: HTTP ${resp.getResponseCode()}`);
    return;
  }
  const html = resp.getContentText();

  let benchmarkData = extractMETRJson(html, 'benchmarkDataV1_1') || extractMETRJson(html, 'benchmarkDataV1');
  if (!benchmarkData) {
    Logger.log('Could not extract METR benchmark data from page');
    return;
  }

  const results = benchmarkData.results || {};
  const rows = [];

  for (const [key, model] of Object.entries(results)) {
    const metrics = model.metrics || {};
    const p50 = metrics.p50_horizon_length?.estimate;
    const releaseDate = model.release_date;
    if (p50 == null || !releaseDate) continue;

    let name = key.replace(/_inspect$/, '').replace(/_/g, ' ');
    name = name.replace(/\b\w/g, c => c.toUpperCase());
    rows.push([graphId, releaseDate, `METR:${name}`, p50]);
  }

  const added = appendDataRows(sheet, rows, existing);
  Logger.log(`Backfilled ${added} METR data points`);
}

/** Extract a named JS object from HTML. Returns parsed object or null. */
function extractMETRJson(html, varName) {
  const re = new RegExp('const\\s+' + varName + '\\s*=\\s*');
  const match = re.exec(html);
  if (!match) return null;
  const start = match.index + match[0].length;
  let depth = 0, end = start;
  for (let i = start; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') depth--;
    if (depth === 0) { end = i + 1; break; }
  }
  try { return JSON.parse(html.substring(start, end)); }
  catch (e) { Logger.log(`Failed to parse ${varName}: ${e.message}`); return null; }
}

// ── One-time cleanup ──────────────────────────────────────────

/** Remove duplicate graph_id+date+series rows from the Data sheet. */
function dedupData() {
  const sheet = ensureDataSheet();
  const data = sheet.getDataRange().getValues();
  const seen = new Set();
  const rowsToDelete = [];
  for (let i = 1; i < data.length; i++) {
    const gid = data[i][0]?.toString().trim();
    const d = sheetDateStr(data[i][1]);
    const s = data[i][2]?.toString().trim();
    const key = `${gid}|${d}|${s}`;
    if (seen.has(key)) {
      rowsToDelete.push(i + 1);
    } else {
      seen.add(key);
    }
  }
  for (let i = rowsToDelete.length - 1; i >= 0; i--) {
    sheet.deleteRow(rowsToDelete[i]);
  }
  Logger.log(`Removed ${rowsToDelete.length} duplicate rows from Data sheet`);
}

// ── Migration: merge old sheets into Data ─────────────────────

/**
 * One-time migration: copies History, Prices, Indicators into the unified Data sheet.
 * Requires Sources to have the new source rows (yahoo, bls, metr) already added.
 * Safe to run multiple times (dedup).
 */
function migrateToUnifiedData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dataSheet = ensureDataSheet();
  const existing = getExistingDataKeys(dataSheet);
  let totalAdded = 0;

  // 1. Migrate History → Data
  const historySheet = ss.getSheetByName('History');
  if (historySheet) {
    const hData = historySheet.getDataRange().getValues();
    const rows = [];
    for (let i = 1; i < hData.length; i++) {
      const qid = hData[i][0]?.toString().trim();
      const ts = hData[i][1];
      const slug = hData[i][3]?.toString().trim();
      const prob = parseFloat(hData[i][4]);
      if (!qid || isNaN(prob)) continue;
      const dateStr = (ts instanceof Date) ? ts.toISOString() : ts?.toString().trim();
      rows.push([qid, dateStr, slug, prob]);
    }
    const added = appendDataRows(dataSheet, rows, existing);
    Logger.log(`History → Data: migrated ${added} rows`);
    totalAdded += added;
  }

  // 2. Migrate Prices → Data (need slug→graph_id mapping from Sources)
  const pricesSheet = ss.getSheetByName('Prices');
  if (pricesSheet) {
    const sources = getSourcesByPlatform('yahoo');
    const slugToGraph = {};
    for (const s of sources) slugToGraph[s.slug] = s.graph_id;

    const pData = pricesSheet.getDataRange().getValues();
    const rows = [];
    for (let i = 1; i < pData.length; i++) {
      const dateStr = sheetDateStr(pData[i][0]);
      const symbol = pData[i][1]?.toString().trim();
      const close = parseFloat(pData[i][2]);
      if (!dateStr || !symbol || isNaN(close)) continue;
      const graphId = slugToGraph[symbol];
      if (!graphId) { continue; } // symbol not in Sources yet
      rows.push([graphId, dateStr, symbol, close]);
    }
    const added = appendDataRows(dataSheet, rows, existing);
    Logger.log(`Prices → Data: migrated ${added} rows`);
    totalAdded += added;
  }

  // 3. Migrate Indicators → Data
  const indSheet = ss.getSheetByName('Indicators');
  if (indSheet) {
    const sources = getSourcesByPlatform(['bls', 'metr']);
    const slugToGraph = {};
    for (const s of sources) slugToGraph[s.slug] = s.graph_id;

    const iData = indSheet.getDataRange().getValues();
    const rows = [];
    for (let i = 1; i < iData.length; i++) {
      const dateStr = sheetDateStr(iData[i][0]);
      const series = iData[i][1]?.toString().trim();
      const value = parseFloat(iData[i][2]);
      if (!dateStr || !series || isNaN(value)) continue;

      // For BLS series, look up graph_id; for METR, use the metr source's graph_id
      let graphId = slugToGraph[series];
      if (!graphId && series.startsWith('METR:')) {
        // Find the metr source
        const metrSource = sources.find(s => s.platform === 'metr');
        graphId = metrSource ? metrSource.graph_id : 'metr-horizon';
      }
      if (!graphId) continue;
      rows.push([graphId, dateStr, series, value]);
    }
    const added = appendDataRows(dataSheet, rows, existing);
    Logger.log(`Indicators → Data: migrated ${added} rows`);
    totalAdded += added;
  }

  Logger.log(`Migration complete: ${totalAdded} total rows added to Data sheet (GID: ${dataSheet.getSheetId()})`);
}

// ── Setup helper ──────────────────────────────────────────────

/** Run this once to set up all time triggers. Clears existing triggers first. */
function createTrigger() {
  // Delete all existing project triggers
  for (const trigger of ScriptApp.getProjectTriggers()) {
    ScriptApp.deleteTrigger(trigger);
  }

  // Twice daily: 8 AM and 8 PM — records all data types (probabilities, prices, indicators)
  ScriptApp.newTrigger('recordAll')
    .timeBased().atHour(8).everyDays(1).create();
  ScriptApp.newTrigger('recordAll')
    .timeBased().atHour(20).everyDays(1).create();

  Logger.log('Triggers created: recordAll at 8 AM and 8 PM daily');
}

// ── Web App API ───────────────────────────────────────────────
// Deploy as web app: Publish → Deploy as web app → Execute as: Me, Access: Anyone
// Set WEBAPP_SECRET in Script Properties for auth.
//
// POST body JSON:
//   { "secret": "...", "action": "append"|"read"|"delete_rows", "sheet": "Markets"|"Questions"|..., ... }
//
// Actions:
//   append:      { rows: [[col1, col2, ...], ...] }                — append rows
//   read:        {}                                                  — returns all rows
//   delete_rows: { match: { column: "slug", value: "some-slug" } } — delete matching rows

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const secret = PropertiesService.getScriptProperties().getProperty('WEBAPP_SECRET');
    if (!secret || body.secret !== secret) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }
    return handleAction(body);
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}

function doGet(e) {
  return jsonResponse({ error: 'GET not supported. Use POST with secret in the request body.' }, 405);
}

function handleAction(body) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Actions that don't require a sheet
  if (body.action === 'run') {
    const allowed = { recordAll, recordAllProbabilities, backfillHistory, backfillPrices, recordPrices, backfillIndicators, recordIndicators, backfillMETR, dedupData, migrateToUnifiedData, createTrigger };
    const fn = allowed[body.function];
    if (!fn) return jsonResponse({ error: `Unknown function: ${body.function}` }, 400);
    fn();
    return jsonResponse({ success: true, ran: body.function });
  }

  if (body.action === 'get_sheets') {
    const sheets = ss.getSheets();
    return jsonResponse({ sheets: sheets.map(s => ({ name: s.getName(), gid: s.getSheetId() })) });
  }

  const sheet = ss.getSheetByName(body.sheet);
  if (!sheet) return jsonResponse({ error: `Sheet "${body.sheet}" not found` }, 404);

  switch (body.action) {
    case 'read': {
      const data = sheet.getDataRange().getValues();
      const headers = data[0].map(h => h.toString());
      const rows = data.slice(1).map(row => {
        const obj = {};
        headers.forEach((h, i) => obj[h] = row[i]?.toString() || '');
        return obj;
      });
      return jsonResponse({ headers, rows, count: rows.length });
    }

    case 'append': {
      if (!body.rows || !body.rows.length) return jsonResponse({ error: 'No rows to append' }, 400);
      sheet.getRange(sheet.getLastRow() + 1, 1, body.rows.length, body.rows[0].length)
        .setValues(body.rows);
      return jsonResponse({ success: true, appended: body.rows.length });
    }

    case 'delete_rows': {
      if (!body.match) return jsonResponse({ error: 'Missing match criteria' }, 400);
      const data = sheet.getDataRange().getValues();
      const headers = data[0].map(h => h.toString().trim().toLowerCase());
      const colIdx = headers.indexOf(body.match.column.toLowerCase());
      if (colIdx === -1) return jsonResponse({ error: `Column "${body.match.column}" not found` }, 404);
      let deleted = 0;
      // Delete from bottom up to avoid shifting indices
      for (let i = data.length - 1; i >= 1; i--) {
        if (data[i][colIdx]?.toString().trim() === body.match.value) {
          sheet.deleteRow(i + 1);
          deleted++;
        }
      }
      return jsonResponse({ success: true, deleted });
    }

    case 'write_cells': {
      if (!body.range) return jsonResponse({ error: 'Missing range' }, 400);
      const allowedWriteSheets = ['Data'];
      if (!allowedWriteSheets.includes(body.sheet)) {
        return jsonResponse({ error: `write_cells not allowed on sheet "${body.sheet}"` }, 403);
      }
      const r = sheet.getRange(body.range);
      if (Array.isArray(body.values) && Array.isArray(body.values[0])) {
        r.setValues(body.values);
      } else {
        r.setValue(body.values);
      }
      return jsonResponse({ success: true });
    }

    default:
      return jsonResponse({ error: `Unknown action: ${body.action}` }, 400);
  }
}

function jsonResponse(obj, status) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
