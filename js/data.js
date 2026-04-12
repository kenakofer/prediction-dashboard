// ──────────────────────────────────────────────
// data.js — Fetch and parse CSV data from Google Sheets
// ──────────────────────────────────────────────

const DataService = (() => {
  function fetchCsv(url) {
    return new Promise((resolve, reject) => {
      Papa.parse(url, {
        download: true,
        header: true,
        skipEmptyLines: true,
        complete: (results) => resolve(results.data),
        error: (err) => reject(err),
      });
    });
  }

  /** Parse Questions tab into structured objects */
  function parseQuestions(rows) {
    return rows.map((r) => ({
      id: r.question_id?.trim(),
      title: r.title?.trim(),
      category: r.category?.trim() || 'Uncategorized',
      sortOrder: parseInt(r.sort_order, 10) || 999,
      platforms: {
        manifold:   r.manifold_slug?.trim()   || null,
        polymarket: r.polymarket_slug?.trim() || null,
        kalshi:     r.kalshi_ticker?.trim()    || null,
        metaculus:  r.metaculus_id?.trim()      || null,
      },
    })).filter((q) => q.id);
  }

  /** Parse History tab into a map: questionId → [{timestamp, platform, probability}] */
  function parseHistory(rows) {
    const map = {};
    for (const r of rows) {
      const qid = r.question_id?.trim();
      if (!qid) continue;
      const prob = parseFloat(r.probability);
      if (isNaN(prob)) continue;
      if (!map[qid]) map[qid] = [];
      map[qid].push({
        timestamp: new Date(r.timestamp?.trim()),
        platform: r.platform?.trim().toLowerCase(),
        probability: prob,
      });
    }
    // Sort each question's history by time
    for (const qid in map) {
      map[qid].sort((a, b) => a.timestamp - b.timestamp);
    }
    return map;
  }

  /** Parse Annotations tab into a map: questionId → [{date, note}] */
  function parseAnnotations(rows) {
    const map = {};
    for (const r of rows) {
      const qid = r.question_id?.trim();
      if (!qid) continue;
      if (!map[qid]) map[qid] = [];
      map[qid].push({
        date: new Date(r.date?.trim()),
        note: r.note?.trim() || '',
      });
    }
    return map;
  }

  /** Group questions by category, respecting sort order */
  function groupByCategory(questions) {
    const groups = {};
    for (const q of questions) {
      if (!groups[q.category]) groups[q.category] = [];
      groups[q.category].push(q);
    }
    // Sort questions within each category
    for (const cat in groups) {
      groups[cat].sort((a, b) => a.sortOrder - b.sortOrder);
    }
    return groups;
  }

  /** Get the latest probability for each platform for a question */
  function getLatestProbabilities(historyEntries) {
    const latest = {};
    if (!historyEntries) return latest;
    for (const entry of historyEntries) {
      const key = entry.platform;
      if (!latest[key] || entry.timestamp > latest[key].timestamp) {
        latest[key] = entry;
      }
    }
    return latest;
  }

  /** Main entry point: fetch all 3 CSV tabs and return structured data */
  async function loadAll() {
    const [questionsRaw, historyRaw, annotationsRaw] = await Promise.all([
      fetchCsv(CONFIG.csvUrl(CONFIG.TABS.QUESTIONS)),
      fetchCsv(CONFIG.csvUrl(CONFIG.TABS.HISTORY)),
      fetchCsv(CONFIG.csvUrl(CONFIG.TABS.ANNOTATIONS)),
    ]);

    const questions = parseQuestions(questionsRaw);
    const history = parseHistory(historyRaw);
    const annotations = parseAnnotations(annotationsRaw);
    const categories = groupByCategory(questions);

    return { questions, history, annotations, categories };
  }

  return { loadAll, getLatestProbabilities };
})();
