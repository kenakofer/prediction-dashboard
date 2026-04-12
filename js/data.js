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

  // ── Questions (Graphs) ─────────────────────────

  /** Parse Questions tab: question_id, title, category, sort_order, chart_type, unit, param */
  function parseQuestions(rows) {
    return rows.map((r) => ({
      id: r.question_id?.trim(),
      title: r.title?.trim(),
      category: r.category?.trim() || 'Uncategorized',
      sortOrder: parseInt(r.sort_order, 10) || 999,
      chartType: r.chart_type?.trim() || 'probability',
      unit: r.unit?.trim() || '%',
      param: r.param?.trim() || '',
    })).filter((q) => q.id);
  }

  // ── Markets (Sources) ──────────────────────────

  /** Parse Markets tab: question_id, platform, slug, label, url, param, color */
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
        url: r.url?.trim() || '',
        param: r.param?.trim() || '',
        color: r.color?.trim() || '',
      });
    }
    return map;
  }

  // ── Data (unified time-series) ─────────────────

  /**
   * Parse unified Data tab: graph_id, date, series, value
   * Returns { graphId: { series: [{date, value}] } }
   */
  function parseData(rows) {
    const map = {};
    for (const r of rows) {
      const gid = r.graph_id?.trim();
      if (!gid) continue;
      const value = parseFloat(r.value);
      if (isNaN(value)) continue;
      const date = new Date(r.date?.trim());
      if (isNaN(date.getTime())) continue;
      const series = r.series?.trim() || '';

      if (!map[gid]) map[gid] = {};
      if (!map[gid][series]) map[gid][series] = [];
      map[gid][series].push({ date, value });
    }
    // Sort each series by date
    for (const gid of Object.keys(map)) {
      for (const s of Object.keys(map[gid])) {
        map[gid][s].sort((a, b) => a.date - b.date);
      }
    }
    return map;
  }

  // ── Annotations ────────────────────────────────

  /** Parse Annotations tab: question_id, date, note */
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

  // ── Helpers ────────────────────────────────────

  /** Group questions by category, respecting sort order */
  function groupByCategory(questions) {
    const groups = {};
    for (const q of questions) {
      if (!groups[q.category]) groups[q.category] = [];
      groups[q.category].push(q);
    }
    // Sort within each category; also compute min sort_order per category for section ordering
    for (const cat in groups) {
      groups[cat].sort((a, b) => a.sortOrder - b.sortOrder);
    }
    return groups;
  }

  /** Get the latest value for each series in a graph's data */
  function getLatestValues(graphData) {
    const latest = {};
    if (!graphData) return latest;
    for (const [series, points] of Object.entries(graphData)) {
      if (points.length > 0) {
        const last = points[points.length - 1];
        latest[series] = { date: last.date, value: last.value };
      }
    }
    return latest;
  }

  // ── Main loader ────────────────────────────────

  async function loadAll() {
    const dataUrl = CONFIG.csvUrl('DATA');
    if (!dataUrl) throw new Error('DATA sheet GID not configured — run migration first');

    const [questionsRaw, marketsRaw, dataRaw, annotationsRaw] = await Promise.all([
      fetchCsv(CONFIG.csvUrl('QUESTIONS')),
      fetchCsv(CONFIG.csvUrl('MARKETS')),
      fetchCsv(dataUrl),
      fetchCsv(CONFIG.csvUrl('ANNOTATIONS')),
    ]);

    const questions = parseQuestions(questionsRaw);
    const markets = parseMarkets(marketsRaw);
    const data = parseData(dataRaw);
    const annotations = parseAnnotations(annotationsRaw);
    const categories = groupByCategory(questions);

    return { questions, markets, data, annotations, categories };
  }

  return { loadAll, getLatestValues };
})();
