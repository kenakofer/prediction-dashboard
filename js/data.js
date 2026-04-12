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

  /** Parse Questions tab: question_id, title, category, sort_order */
  function parseQuestions(rows) {
    return rows.map((r) => ({
      id: r.question_id?.trim(),
      title: r.title?.trim(),
      category: r.category?.trim() || 'Uncategorized',
      sortOrder: parseInt(r.sort_order, 10) || 999,
    })).filter((q) => q.id);
  }

  /** Parse Markets tab: question_id, platform, slug, label */
  function parseMarkets(rows) {
    const map = {};
    for (const r of rows) {
      const qid = r.question_id?.trim();
      if (!qid) continue;
      const platform = r.platform?.trim().toLowerCase();
      const slug = r.slug?.trim();
      if (!platform || !slug) continue;
      if (!map[qid]) map[qid] = [];
      map[qid].push({
        platform,
        slug,
        label: r.label?.trim() || CONFIG.PLATFORM_LABELS[platform] || platform,
      });
    }
    return map;
  }

  /**
   * Parse History tab into a map: questionId → [{timestamp, platform, slug, probability}]
   * The slug column links each data point to a specific market entry.
   */
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
        slug: r.slug?.trim() || '',
        probability: prob,
      });
    }
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
    for (const cat in groups) {
      groups[cat].sort((a, b) => a.sortOrder - b.sortOrder);
    }
    return groups;
  }

  /** Get the latest probability for each market (keyed by slug) */
  function getLatestProbabilities(historyEntries) {
    const latest = {};
    if (!historyEntries) return latest;
    for (const entry of historyEntries) {
      const key = entry.slug || entry.platform;
      if (!latest[key] || entry.timestamp > latest[key].timestamp) {
        latest[key] = entry;
      }
    }
    return latest;
  }

  /** Main entry point: fetch all 4 CSV tabs and return structured data */
  async function loadAll() {
    const [questionsRaw, marketsRaw, historyRaw, annotationsRaw] = await Promise.all([
      fetchCsv(CONFIG.csvUrl(CONFIG.TABS.QUESTIONS)),
      fetchCsv(CONFIG.csvUrl(CONFIG.TABS.MARKETS)),
      fetchCsv(CONFIG.csvUrl(CONFIG.TABS.HISTORY)),
      fetchCsv(CONFIG.csvUrl(CONFIG.TABS.ANNOTATIONS)),
    ]);

    const questions = parseQuestions(questionsRaw);
    const markets = parseMarkets(marketsRaw);
    const history = parseHistory(historyRaw);
    const annotations = parseAnnotations(annotationsRaw);
    const categories = groupByCategory(questions);

    return { questions, markets, history, annotations, categories };
  }

  return { loadAll, getLatestProbabilities };
})();
