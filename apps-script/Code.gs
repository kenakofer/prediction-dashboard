// ══════════════════════════════════════════════════════════════
// Prediction Watch — Google Apps Script
// Fetches current probabilities from prediction market APIs
// and appends them to the History tab. Run via time trigger.
// ══════════════════════════════════════════════════════════════

/** Main entry point — called by time trigger */
function recordAllProbabilities() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const marketsSheet = ss.getSheetByName('Markets');
  const historySheet = ss.getSheetByName('History');

  if (!marketsSheet || !historySheet) {
    Logger.log('ERROR: Missing Markets or History sheet');
    return;
  }

  const markets = getMarkets(marketsSheet);
  const timestamp = new Date().toISOString();
  const newRows = [];

  for (const m of markets) {
    let prob = null;
    switch (m.platform) {
      case 'manifold':   prob = fetchManifold(m.slug); break;
      case 'polymarket': prob = fetchPolymarket(m.slug); break;
      case 'kalshi':     prob = fetchKalshi(m.slug); break;
      case 'metaculus':  prob = fetchMetaculus(m.slug, m.param); break;
      default:
        Logger.log(`Unknown platform: ${m.platform}`);
    }
    if (prob !== null) {
      newRows.push([m.question_id, timestamp, m.platform, m.slug, prob]);
    }
  }

  if (newRows.length > 0) {
    historySheet
      .getRange(historySheet.getLastRow() + 1, 1, newRows.length, 5)
      .setValues(newRows);
    Logger.log(`Recorded ${newRows.length} data points`);
  } else {
    Logger.log('No data points recorded this run');
  }
}

// ── Sheet parsing ─────────────────────────────────────────────

/** Read Markets tab: question_id, platform, slug, label, url, param */
function getMarkets(sheet) {
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map((h) => h.toString().trim().toLowerCase());
  const markets = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const r = {};
    headers.forEach((h, j) => {
      const v = row[j];
      // Sheets auto-converts date strings (e.g. "2030-01-01") to Date objects; convert back to ISO
      if (v instanceof Date) {
        r[h] = Utilities.formatDate(v, 'UTC', 'yyyy-MM-dd');
      } else {
        r[h] = v?.toString().trim() || '';
      }
    });
    if (!r['question_id'] || !r['platform'] || !r['slug']) continue;
    markets.push({
      question_id: r['question_id'],
      platform: r['platform'].toLowerCase(),
      slug: r['slug'],
      label: r['label'] || '',
      url: r['url'] || '',
      param: r['param'] || '',  // e.g. "2030-01-01" for Metaculus date questions
    });
  }

  return markets;
}

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

    // Try v3 API first — it has the 201-point CDF needed for date questions
    const v3url = `https://www.metaculus.com/api/questions/${questionId}/`;
    const v3resp = UrlFetchApp.fetch(v3url, {
      muteHttpExceptions: true,
      headers: { 'Authorization': `Token ${token}` },
    });

    if (v3resp.getResponseCode() === 200) {
      const data = JSON.parse(v3resp.getContentText());
      const q = data.question || data;
      const agg = q.aggregations && q.aggregations.recency_weighted;

      // Date question with a cutoff date: read CDF and compute P(date < cutoffDate)
      if (cutoffDate && agg && agg.latest && Array.isArray(agg.latest.forecaster_count !== undefined ? null : agg.latest.centers)) {
        // centers[0] is the median for continuous; use CDF if available
      }
      if (cutoffDate && agg && agg.latest && Array.isArray(agg.latest.histogram)) {
        // CDF may be in 'histogram' field for v3 date questions
        const result = calcCdfAtCutoff(q, agg.latest, cutoffDate);
        if (result !== null) return result;
      }

      // Try direct CDF field (v3 format for continuous/date questions)
      if (cutoffDate && agg && agg.latest && Array.isArray(agg.latest.cdf)) {
        const result = calcCdfAtCutoff(q, agg.latest, cutoffDate);
        if (result !== null) return result;
      }

      // Binary question — return community median probability
      if (agg && agg.latest && Array.isArray(agg.latest.centers)) {
        return Math.round(agg.latest.centers[0] * 1000) / 10;
      }
    }

    // Fall back to v2 API (works for binary questions)
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

    // Date question with cutoff: use v2 community_prediction distribution
    if (cutoffDate) {
      const result = calcCdfAtCutoffV2(v2data, cutoffDate);
      if (result !== null) return result;
    }

    // Binary: community prediction median
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

  // Try v3 with auth
  const v3resp = UrlFetchApp.fetch(`https://www.metaculus.com/api/questions/${questionId}/`, {
    muteHttpExceptions: true, headers: { 'Authorization': `Token ${token}` },
  });
  Logger.log(`v3 status: ${v3resp.getResponseCode()}`);
  if (v3resp.getResponseCode() === 200) {
    const d = JSON.parse(v3resp.getContentText());
    const q = d.question || d;
    Logger.log(`possibilities: ${JSON.stringify(q.possibilities || q.scaling || 'none')}`);
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
 * Read existing History rows and return a Set of "qid|date|platform|slug" keys
 * for deduplication when backfilling.
 */
function getExistingHistoryKeys(historySheet) {
  const keys = new Set();
  const data = historySheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const qid = data[i][0]?.toString().trim();
    const ts = data[i][1]?.toString().trim();
    const platform = data[i][2]?.toString().trim();
    const slug = data[i][3]?.toString().trim();
    if (!qid || !ts) continue;
    // Key by date (YYYY-MM-DD) to deduplicate at day level
    const day = ts.length >= 10 ? ts.slice(0, 10) : ts;
    keys.add(`${qid}|${day}|${platform}|${slug}`);
  }
  return keys;
}

/**
 * Optional: Backfill historical data from platform APIs.
 * Safe to run multiple times — skips dates already in History.
 * Note: Only Manifold and Polymarket provide public history APIs.
 * Kalshi and Metaculus do not expose historical data publicly.
 */
function backfillHistory() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const marketsSheet = ss.getSheetByName('Markets');
  const historySheet = ss.getSheetByName('History');
  const markets = getMarkets(marketsSheet);
  const existingKeys = getExistingHistoryKeys(historySheet);
  let totalRows = 0;
  let skippedRows = 0;

  for (const m of markets) {
    let rows = [];
    switch (m.platform) {
      case 'manifold':
        rows = backfillManifold(m.question_id, m.slug);
        break;
      case 'polymarket':
        rows = backfillPolymarket(m.question_id, m.slug);
        break;
      case 'kalshi':
        Logger.log(`Kalshi: No public history API for ${m.slug} — data collected going forward only`);
        break;
      case 'metaculus':
        Logger.log(`Metaculus: No public history API for question ${m.slug} — data collected going forward only`);
        break;
    }

    // Deduplicate against existing history
    const newRows = [];
    for (const row of rows) {
      const day = row[1].slice(0, 10); // timestamp → YYYY-MM-DD
      const key = `${row[0]}|${day}|${row[2]}|${row[3]}`;
      if (existingKeys.has(key)) {
        skippedRows++;
      } else {
        newRows.push(row);
        existingKeys.add(key); // prevent intra-batch dupes too
      }
    }

    if (newRows.length > 0) {
      historySheet
        .getRange(historySheet.getLastRow() + 1, 1, newRows.length, 5)
        .setValues(newRows);
      totalRows += newRows.length;
    }
  }

  Logger.log(`Backfilled ${totalRows} new rows (${skippedRows} duplicates skipped)`);
}

function backfillManifold(questionId, slug) {
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

    // Sample: one point per day
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
      .map((p) => [questionId, p.timestamp, 'manifold', slug, p.probability]);
  } catch (e) {
    Logger.log(`Manifold backfill error (${slug}): ${e}`);
    return [];
  }
}

function backfillPolymarket(questionId, slug) {
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

    return history.map((point) => [
      questionId,
      new Date(point.t * 1000).toISOString(),
      'polymarket',
      slug,
      Math.round(parseFloat(point.p) * 1000) / 10,
    ]);
  } catch (e) {
    Logger.log(`Polymarket backfill error (${slug}): ${e}`);
    return [];
  }
}

// ── Setup helper ──────────────────────────────────────────────

/** Run this once to set up the time trigger */
function createTrigger() {
  // Delete existing triggers for this function
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'recordAllProbabilities') {
      ScriptApp.deleteTrigger(trigger);
    }
  }

  // Twice daily: 8 AM and 8 PM
  ScriptApp.newTrigger('recordAllProbabilities')
    .timeBased()
    .atHour(8)
    .everyDays(1)
    .create();

  ScriptApp.newTrigger('recordAllProbabilities')
    .timeBased()
    .atHour(20)
    .everyDays(1)
    .create();

  Logger.log('Triggers created: 8 AM and 8 PM daily');
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
  const secret = PropertiesService.getScriptProperties().getProperty('WEBAPP_SECRET');
  if (!secret || e.parameter.secret !== secret) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }
  const sheetName = e.parameter.sheet;
  if (!sheetName) return jsonResponse({ error: 'Missing sheet parameter' }, 400);
  return handleAction({ action: 'read', sheet: sheetName });
}

function handleAction(body) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
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
