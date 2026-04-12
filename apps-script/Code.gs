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
      case 'metaculus':  prob = fetchMetaculus(m.slug); break;
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

/** Read Markets tab: question_id, platform, slug, label */
function getMarkets(sheet) {
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map((h) => h.toString().trim().toLowerCase());
  const markets = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const r = {};
    headers.forEach((h, j) => (r[h] = row[j]?.toString().trim() || ''));
    if (!r['question_id'] || !r['platform'] || !r['slug']) continue;
    markets.push({
      question_id: r['question_id'],
      platform: r['platform'].toLowerCase(),
      slug: r['slug'],
      label: r['label'] || '',
      url: r['url'] || '',
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

function fetchMetaculus(questionId) {
  try {
    // Metaculus API requires authentication via API token.
    // Set your token in Script Properties: key = METACULUS_API_TOKEN
    const token = PropertiesService.getScriptProperties().getProperty('METACULUS_API_TOKEN');
    if (!token) {
      Logger.log('Metaculus: No API token set. Go to Project Settings → Script Properties and add METACULUS_API_TOKEN.');
      return null;
    }
    const url = `https://www.metaculus.com/api2/questions/${questionId}/`;
    const resp = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: { 'Authorization': `Token ${token}` },
    });
    if (resp.getResponseCode() !== 200) {
      Logger.log(`Metaculus API returned ${resp.getResponseCode()} for question ${questionId}`);
      return null;
    }
    const data = JSON.parse(resp.getContentText());
    // Community prediction median (q2 = 50th percentile, 0-1 scale)
    const cp = data.community_prediction;
    if (cp && cp.full && cp.full.q2 !== undefined) {
      return Math.round(cp.full.q2 * 1000) / 10;
    }
    // Newer API format fallback
    if (data.question && data.question.aggregations) {
      const agg = data.question.aggregations.recency_weighted;
      if (agg && agg.latest && agg.latest.centers) {
        return Math.round(agg.latest.centers[0] * 1000) / 10;
      }
    }
    return null;
  } catch (e) {
    Logger.log(`Metaculus error (${questionId}): ${e}`);
    return null;
  }
}

// ── Backfill from APIs (run manually once) ─────────────────────

/**
 * Optional: Backfill historical data from platform APIs.
 * Run this once manually to seed your History tab with past data.
 * Only Manifold and Polymarket reliably provide history via API.
 */
function backfillHistory() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const marketsSheet = ss.getSheetByName('Markets');
  const historySheet = ss.getSheetByName('History');
  const markets = getMarkets(marketsSheet);
  let totalRows = 0;

  for (const m of markets) {
    let rows = [];
    switch (m.platform) {
      case 'manifold':
        rows = backfillManifold(m.question_id, m.slug);
        break;
      case 'polymarket':
        rows = backfillPolymarket(m.question_id, m.slug);
        break;
    }
    if (rows.length > 0) {
      historySheet
        .getRange(historySheet.getLastRow() + 1, 1, rows.length, 5)
        .setValues(rows);
      totalRows += rows.length;
    }
  }

  Logger.log(`Backfilled ${totalRows} total rows`);
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
