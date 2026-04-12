// ──────────────────────────────────────────────
// main.js — Dashboard orchestrator
// ──────────────────────────────────────────────

(async function () {
  const loadingEl = document.getElementById('loading');
  const errorEl = document.getElementById('error-banner');
  const containerEl = document.getElementById('dashboard-container');

  try {
    const { questions, markets, data, annotations, categories } =
      await DataService.loadAll();

    // Find latest timestamp across all data
    let latestTs = null;
    for (const graphData of Object.values(data)) {
      for (const seriesPoints of Object.values(graphData)) {
        for (const p of seriesPoints) {
          if (!latestTs || p.date > latestTs) latestTs = p.date;
        }
      }
    }
    if (latestTs) {
      document.getElementById('last-updated').textContent =
        `Last updated: ${latestTs.toLocaleString()}`;
    }

    // Platform legend — show each prediction platform that has at least one source
    const predictionPlatforms = new Set(['manifold', 'polymarket', 'kalshi', 'metaculus']);
    const usedPlatforms = new Set();
    for (const sourceList of Object.values(markets)) {
      for (const s of sourceList) {
        if (predictionPlatforms.has(s.platform)) usedPlatforms.add(s.platform);
      }
    }
    if (usedPlatforms.size > 0) {
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
    }

    // Render categories — sorted by minimum sort_order of their graphs
    const catOrder = Object.keys(categories).sort((a, b) => {
      const minA = Math.min(...categories[a].map(g => g.sortOrder));
      const minB = Math.min(...categories[b].map(g => g.sortOrder));
      return minA - minB;
    });

    for (const catName of catOrder) {
      const section = document.createElement('section');
      section.className = 'category-section';

      const h2 = document.createElement('h2');
      h2.className = 'category-title';
      h2.textContent = catName;
      section.appendChild(h2);

      const grid = document.createElement('div');
      grid.className = 'chart-grid';

      for (const graph of categories[catName]) {
        ChartRenderer.renderGraphCard(
          grid,
          graph,
          markets[graph.id] || [],
          data[graph.id] || {},
          annotations[graph.id] || []
        );
      }

      section.appendChild(grid);
      containerEl.appendChild(section);
    }

    loadingEl.classList.add('hidden');
  } catch (err) {
    loadingEl.classList.add('hidden');
    console.error('Failed to load dashboard data:', err);
    errorEl.textContent = `Failed to load data. Error: ${err.message || err}`;
    errorEl.classList.remove('hidden');
  }
})();
