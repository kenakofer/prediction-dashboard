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

function fetchManifold(slugOrId) {
  try {
    // slugOrId can be a full slug like "user/question-slug" or just a market ID
    const url = `https://api.manifold.markets/v0/slug/${slugOrId}`;
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) {
      // Try as market ID
      const url2 = `https://api.manifold.markets/v0/market/${slugOrId}`;
      const resp2 = UrlFetchApp.fetch(url2, { muteHttpExceptions: true });
      if (resp2.getResponseCode() !== 200) return null;
      const data = JSON.parse(resp2.getContentText());
      return Math.round(data.probability * 1000) / 10;
    }
    const data = JSON.parse(resp.getContentText());
    return Math.round(data.probability * 1000) / 10; // e.g. 65.3
  } catch (e) {
    Logger.log(`Manifold error (${slugOrId}): ${e}`);
    return null;
  }
}

function fetchPolymarket(slugOrId) {
  try {
    // Try the gamma API to look up by slug
    const url = `https://gamma-api.polymarket.com/markets?slug=${encodeURIComponent(slugOrId)}`;
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return null;
    const data = JSON.parse(resp.getContentText());

    if (Array.isArray(data) && data.length > 0) {
      const market = data[0];
      const price = parseFloat(market.outcomePrices?.[0] || market.bestAsk || market.lastTradePrice);
      if (!isNaN(price)) return Math.round(price * 1000) / 10;
    }

    // If slug didn't work, try as condition_id via CLOB
    const url2 = `https://clob.polymarket.com/market/${slugOrId}`;
    const resp2 = UrlFetchApp.fetch(url2, { muteHttpExceptions: true });
    if (resp2.getResponseCode() !== 200) return null;
    const data2 = JSON.parse(resp2.getContentText());
    const tokens = data2.tokens;
    if (tokens && tokens.length > 0) {
      const yesToken = tokens.find((t) => t.outcome === 'Yes') || tokens[0];
      const price2 = parseFloat(yesToken.price);
      if (!isNaN(price2)) return Math.round(price2 * 1000) / 10;
    }

    return null;
  } catch (e) {
    Logger.log(`Polymarket error (${slugOrId}): ${e}`);
    return null;
  }
}

function fetchKalshi(ticker) {
  try {
    const url = `https://trading-api.kalshi.com/trade-api/v2/markets/${ticker}`;
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return null;
    const data = JSON.parse(resp.getContentText());
    const market = data.market;
    if (!market) return null;
    // yes_ask is in cents (0-100)
    const prob = market.last_price || market.yes_ask || market.yes_bid;
    if (prob !== undefined) return Math.round(prob * 10) / 10;
    return null;
  } catch (e) {
    Logger.log(`Kalshi error (${ticker}): ${e}`);
    return null;
  }
}

function fetchMetaculus(questionId) {
  try {
    const url = `https://www.metaculus.com/api2/questions/${questionId}/`;
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return null;
    const data = JSON.parse(resp.getContentText());
    // Community prediction median
    const cp = data.community_prediction;
    if (cp && cp.full && cp.full.q2 !== undefined) {
      return Math.round(cp.full.q2 * 1000) / 10;
    }
    // Fallback to aggregate forecasts
    if (data.forecasts && data.forecasts.latest) {
      return Math.round(data.forecasts.latest.center * 1000) / 10;
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
        tokenId = gammaData[0].clobTokenIds?.[0] || slugOrConditionId;
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
