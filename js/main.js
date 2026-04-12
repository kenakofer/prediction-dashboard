// ──────────────────────────────────────────────
// main.js — Dashboard orchestrator
// ──────────────────────────────────────────────

(async function () {
  const loadingEl = document.getElementById('loading');
  const errorEl = document.getElementById('error-banner');
  const containerEl = document.getElementById('categories-container');

  try {
    const { questions, markets, history, annotations, categories } =
      await DataService.loadAll();

    // Show last-updated timestamp from most recent history entry
    let latestTs = null;
    for (const entries of Object.values(history)) {
      for (const e of entries) {
        if (!latestTs || e.timestamp > latestTs) latestTs = e.timestamp;
      }
    }
    if (latestTs) {
      document.getElementById('last-updated').textContent =
        `Last updated: ${latestTs.toLocaleString()}`;
    }

    // Platform legend — show each platform that has at least one market
    const usedPlatforms = new Set();
    for (const marketList of Object.values(markets)) {
      for (const m of marketList) usedPlatforms.add(m.platform);
    }
    const legend = document.createElement('div');
    legend.className = 'platform-legend';
    for (const [key, label] of Object.entries(CONFIG.PLATFORM_LABELS)) {
      if (!usedPlatforms.has(key)) continue;
      legend.innerHTML += `
        <div class="legend-item">
          <span class="legend-dot" style="background:${CONFIG.PLATFORM_COLORS[key]}"></span>
          ${label}
        </div>`;
    }
    containerEl.appendChild(legend);

    // Render categories
    const categoryNames = Object.keys(categories).sort();
    for (const catName of categoryNames) {
      const section = document.createElement('section');
      section.className = 'category-section';

      const h2 = document.createElement('h2');
      h2.className = 'category-title';
      h2.textContent = catName;
      section.appendChild(h2);

      const grid = document.createElement('div');
      grid.className = 'chart-grid';

      for (const question of categories[catName]) {
        ChartRenderer.renderQuestionCard(
          grid,
          question,
          markets[question.id] || [],
          history[question.id] || [],
          annotations[question.id] || []
        );
      }

      section.appendChild(grid);
      containerEl.appendChild(section);
    }

    loadingEl.classList.add('hidden');

    // Load ticker charts independently (non-blocking, has its own error handling)
    initTickers(document.getElementById('tickers-container'));
  } catch (err) {
    loadingEl.classList.add('hidden');
    console.error('Failed to load dashboard data:', err);
    errorEl.textContent = `Failed to load data. Make sure your Google Sheet is published to the web. Error: ${err.message || err}`;
    errorEl.classList.remove('hidden');
  }
})();
