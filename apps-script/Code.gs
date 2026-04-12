// ══════════════════════════════════════════════════════════════
// Prediction Watch — Google Apps Script
// Fetches current probabilities from prediction market APIs
// and appends them to the History tab. Run via time trigger.
// ══════════════════════════════════════════════════════════════

/** Main entry point — called by time trigger */
function recordAllProbabilities() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const questionsSheet = ss.getSheetByName('Questions');
  const historySheet = ss.getSheetByName('History');

  if (!questionsSheet || !historySheet) {
    Logger.log('ERROR: Missing Questions or History sheet');
    return;
  }

  const questions = getQuestions(questionsSheet);
  const timestamp = new Date().toISOString();
  const newRows = [];

  for (const q of questions) {
    if (q.manifold_slug) {
      const prob = fetchManifold(q.manifold_slug);
      if (prob !== null) newRows.push([q.id, timestamp, 'manifold', prob]);
    }
    if (q.polymarket_slug) {
      const prob = fetchPolymarket(q.polymarket_slug);
      if (prob !== null) newRows.push([q.id, timestamp, 'polymarket', prob]);
    }
    if (q.kalshi_ticker) {
      const prob = fetchKalshi(q.kalshi_ticker);
      if (prob !== null) newRows.push([q.id, timestamp, 'kalshi', prob]);
    }
    if (q.metaculus_id) {
      const prob = fetchMetaculus(q.metaculus_id);
      if (prob !== null) newRows.push([q.id, timestamp, 'metaculus', prob]);
    }
  }

  if (newRows.length > 0) {
    historySheet
      .getRange(historySheet.getLastRow() + 1, 1, newRows.length, 4)
      .setValues(newRows);
    Logger.log(`Recorded ${newRows.length} data points`);
  } else {
    Logger.log('No data points recorded this run');
  }
}

// ── Sheet parsing ─────────────────────────────────────────────

function getQuestions(sheet) {
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map((h) => h.toString().trim().toLowerCase());
  const questions = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const q = {};
    headers.forEach((h, j) => (q[h] = row[j]?.toString().trim() || ''));
    questions.push({
      id: q['question_id'],
      manifold_slug: q['manifold_slug'],
      polymarket_slug: q['polymarket_slug'],
      kalshi_ticker: q['kalshi_ticker'],
      metaculus_id: q['metaculus_id'],
    });
  }

  return questions.filter((q) => q.id);
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
 * Only Manifold and Polymarket reliably provide history.
 */
function backfillHistory() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const questionsSheet = ss.getSheetByName('Questions');
  const historySheet = ss.getSheetByName('History');
  const questions = getQuestions(questionsSheet);
  let totalRows = 0;

  for (const q of questions) {
    // Manifold bet history → probability series
    if (q.manifold_slug) {
      const rows = backfillManifold(q.id, q.manifold_slug);
      if (rows.length > 0) {
        historySheet
          .getRange(historySheet.getLastRow() + 1, 1, rows.length, 4)
          .setValues(rows);
        totalRows += rows.length;
      }
    }

    // Polymarket price history
    if (q.polymarket_slug) {
      const rows = backfillPolymarket(q.id, q.polymarket_slug);
      if (rows.length > 0) {
        historySheet
          .getRange(historySheet.getLastRow() + 1, 1, rows.length, 4)
          .setValues(rows);
        totalRows += rows.length;
      }
    }
  }

  Logger.log(`Backfilled ${totalRows} total rows`);
}

function backfillManifold(questionId, slugOrId) {
  try {
    // First get the market to find the contractId
    const marketUrl = `https://api.manifold.markets/v0/slug/${slugOrId}`;
    const marketResp = UrlFetchApp.fetch(marketUrl, { muteHttpExceptions: true });
    if (marketResp.getResponseCode() !== 200) return [];
    const market = JSON.parse(marketResp.getContentText());
    const contractId = market.id;

    // Fetch bet history (limited to 1000, paginate if needed)
    const betsUrl = `https://api.manifold.markets/v0/bets?contractId=${contractId}&limit=1000`;
    const betsResp = UrlFetchApp.fetch(betsUrl, { muteHttpExceptions: true });
    if (betsResp.getResponseCode() !== 200) return [];
    const bets = JSON.parse(betsResp.getContentText());

    // Sample: take one point per day
    const byDay = {};
    for (const bet of bets) {
      if (bet.probAfter === undefined) continue;
      const day = new Date(bet.createdTime).toISOString().slice(0, 10);
      // Keep latest bet of the day
      byDay[day] = {
        timestamp: new Date(bet.createdTime).toISOString(),
        probability: Math.round(bet.probAfter * 1000) / 10,
      };
    }

    return Object.values(byDay)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      .map((p) => [questionId, p.timestamp, 'manifold', p.probability]);
  } catch (e) {
    Logger.log(`Manifold backfill error (${slugOrId}): ${e}`);
    return [];
  }
}

function backfillPolymarket(questionId, slugOrConditionId) {
  try {
    // Try to get token_id from gamma API
    const gammaUrl = `https://gamma-api.polymarket.com/markets?slug=${encodeURIComponent(slugOrConditionId)}`;
    const gammaResp = UrlFetchApp.fetch(gammaUrl, { muteHttpExceptions: true });
    let tokenId = slugOrConditionId; // fallback to using it directly

    if (gammaResp.getResponseCode() === 200) {
      const gammaData = JSON.parse(gammaResp.getContentText());
      if (Array.isArray(gammaData) && gammaData.length > 0) {
        // clobTokenIds is a JSON-encoded string array: '["tokenId1","tokenId2"]'
        let tokenIds = gammaData[0].clobTokenIds;
        if (typeof tokenIds === 'string') tokenIds = JSON.parse(tokenIds);
        tokenId = (Array.isArray(tokenIds) && tokenIds.length > 0) ? tokenIds[0] : slugOrConditionId;
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
      Math.round(parseFloat(point.p) * 1000) / 10,
    ]);
  } catch (e) {
    Logger.log(`Polymarket backfill error (${slugOrConditionId}): ${e}`);
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
