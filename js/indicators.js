// ──────────────────────────────────────────────
// indicators.js — Economic indicators & METR time horizons
// ──────────────────────────────────────────────

const IndicatorService = (() => {
  /** Fetch Indicators sheet CSV and parse by series name. */
  async function fetchIndicators() {
    const gid = CONFIG.SHEET_GIDS.INDICATORS;
    if (!gid) return {};
    const url = CONFIG.csvUrl('INDICATORS');
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Indicators CSV: HTTP ${resp.status}`);
    const text = await resp.text();
    const parsed = Papa.parse(text.trim(), { header: true, skipEmptyLines: true });
    const bySeries = {};
    for (const row of parsed.data) {
      const series = row.series?.trim();
      const value = parseFloat(row.value);
      const date = new Date(row.date?.trim());
      if (!series || isNaN(value) || isNaN(date.getTime())) continue;
      if (!bySeries[series]) bySeries[series] = [];
      bySeries[series].push({ date, value });
    }
    for (const s of Object.keys(bySeries)) {
      bySeries[s].sort((a, b) => a.date - b.date);
    }
    return bySeries;
  }

  /** Fetch METR time horizon data (embedded JSON in their page). */
  async function fetchMETR() {
    // We use a CORS proxy or direct fetch — metr.org allows cross-origin
    try {
      const resp = await fetch('https://metr.org/time-horizons/');
      if (!resp.ok) throw new Error(`METR: HTTP ${resp.status}`);
      const html = await resp.text();

      // Extract the v1.1 benchmark data (the latest version)
      const match = html.match(/const\s+benchmarkDataV1_1\s*=\s*(\{[\s\S]*?\});/);
      if (!match) {
        // Fallback to v1.0
        const match1 = html.match(/const\s+benchmarkDataV1\s*=\s*(\{[\s\S]*?\});/);
        if (!match1) throw new Error('Could not find METR benchmark data in page');
        return parseMETRData(JSON.parse(match1[1]));
      }
      return parseMETRData(JSON.parse(match[1]));
    } catch (e) {
      console.warn('METR fetch failed (CORS?), trying fallback:', e.message);
      return null;
    }
  }

  function parseMETRData(benchmarkData) {
    const results = benchmarkData.results || {};
    const points = [];
    for (const [key, model] of Object.entries(results)) {
      const metrics = model.metrics || {};
      const p50 = metrics.p50_horizon_length?.estimate;
      const releaseDate = model.release_date;
      if (p50 == null || !releaseDate) continue;
      // Clean up model name
      let name = key.replace(/_inspect$/, '').replace(/_/g, ' ');
      name = name.replace(/\b\w/g, c => c.toUpperCase());
      points.push({ date: new Date(releaseDate), hours: p50, name });
    }
    points.sort((a, b) => a.date - b.date);
    return points;
  }

  return { fetchIndicators, fetchMETR };
})();

const IndicatorRenderer = (() => {
  const GAS_COLORS = {
    'Gas-Regular':  '#22c55e',
    'Gas-Premium':  '#f59e0b',
    'Gas-Diesel':   '#ef4444',
  };
  const GAS_LABELS = {
    'Gas-Regular':  'Regular',
    'Gas-Premium':  'Premium',
    'Gas-Diesel':   'Diesel',
  };

  function createGasChart(canvas, indicatorData) {
    const datasets = Object.entries(GAS_COLORS)
      .filter(([key]) => indicatorData[key]?.length > 0)
      .map(([key, color]) => ({
        label: GAS_LABELS[key],
        data: indicatorData[key].map(p => ({ x: p.date, y: p.value })),
        borderColor: color,
        backgroundColor: color + '1a',
        borderWidth: 2,
        pointRadius: (ctx) => ctx.dataIndex === ctx.dataset.data.length - 1 ? 4 : 0,
        pointHoverRadius: (ctx) => ctx.dataIndex === ctx.dataset.data.length - 1 ? 6 : 4,
        pointHitRadius: 8,
        tension: 0.25,
        fill: false,
      }));

    return new Chart(canvas, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            type: 'time',
            time: { tooltipFormat: 'MMM yyyy', displayFormats: { month: 'MMM yyyy' } },
            grid: { color: 'rgba(48, 54, 61, 0.5)' },
            ticks: { color: '#8b949e', maxTicksLimit: 8 },
          },
          y: {
            ticks: { color: '#8b949e', callback: v => '$' + v.toFixed(2) },
            grid: { color: 'rgba(48, 54, 61, 0.5)' },
          },
        },
        plugins: {
          legend: {
            display: true,
            labels: { color: '#8b949e', usePointStyle: true, pointStyle: 'circle', padding: 16, font: { size: 12 } },
          },
          tooltip: {
            backgroundColor: '#1c2129', titleColor: '#e6edf3', bodyColor: '#8b949e',
            borderColor: '#30363d', borderWidth: 1,
            callbacks: { label: ctx => `${ctx.dataset.label}: $${ctx.parsed.y.toFixed(3)}` },
          },
        },
      },
    });
  }

  function createCPIChart(canvas, cpiData) {
    const color = '#58a6ff';
    return new Chart(canvas, {
      type: 'line',
      data: {
        datasets: [{
          label: 'CPI-U (All Items)',
          data: cpiData.map(p => ({ x: p.date, y: p.value })),
          borderColor: color,
          backgroundColor: color + '1a',
          borderWidth: 2,
          pointRadius: (ctx) => ctx.dataIndex === ctx.dataset.data.length - 1 ? 4 : 0,
          pointHoverRadius: (ctx) => ctx.dataIndex === ctx.dataset.data.length - 1 ? 6 : 4,
          pointHitRadius: 8,
          tension: 0.25,
          fill: true,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            type: 'time',
            time: { tooltipFormat: 'MMM yyyy', displayFormats: { month: 'MMM yyyy' } },
            grid: { color: 'rgba(48, 54, 61, 0.5)' },
            ticks: { color: '#8b949e', maxTicksLimit: 8 },
          },
          y: {
            ticks: { color: '#8b949e' },
            grid: { color: 'rgba(48, 54, 61, 0.5)' },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1c2129', titleColor: '#e6edf3', bodyColor: '#8b949e',
            borderColor: '#30363d', borderWidth: 1,
            callbacks: { label: ctx => `CPI: ${ctx.parsed.y.toFixed(1)}` },
          },
        },
      },
    });
  }

  function createMETRChart(canvas, metrData) {
    // Frontier line: only models that set new records at time of release
    let maxSoFar = 0;
    const frontier = [];
    for (const p of metrData) {
      if (p.hours > maxSoFar) {
        maxSoFar = p.hours;
        frontier.push(p);
      }
    }

    return new Chart(canvas, {
      type: 'scatter',
      data: {
        datasets: [
          {
            label: 'Frontier',
            data: frontier.map(p => ({ x: p.date, y: p.hours })),
            borderColor: '#22c55e',
            backgroundColor: '#22c55e',
            pointRadius: 5,
            pointHoverRadius: 7,
            showLine: true,
            borderWidth: 2,
            tension: 0,
          },
          {
            label: 'Non-frontier',
            data: metrData.filter(p => !frontier.includes(p)).map(p => ({ x: p.date, y: p.hours })),
            borderColor: '#6e7681',
            backgroundColor: '#6e7681',
            pointRadius: 4,
            pointHoverRadius: 6,
            showLine: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        interaction: { mode: 'nearest', intersect: true },
        scales: {
          x: {
            type: 'time',
            time: { tooltipFormat: 'MMM d, yyyy', displayFormats: { month: 'MMM yyyy', quarter: 'MMM yyyy' } },
            grid: { color: 'rgba(48, 54, 61, 0.5)' },
            ticks: { color: '#8b949e', maxTicksLimit: 8 },
          },
          y: {
            type: 'logarithmic',
            ticks: {
              color: '#8b949e',
              callback: function(v) {
                if (v < 1) return Math.round(v * 60) + 'm';
                if (v < 24) return v + 'h';
                return Math.round(v / 24) + 'd';
              },
            },
            grid: { color: 'rgba(48, 54, 61, 0.5)' },
          },
        },
        plugins: {
          legend: {
            display: true,
            labels: { color: '#8b949e', usePointStyle: true, pointStyle: 'circle', padding: 16, font: { size: 12 } },
          },
          tooltip: {
            backgroundColor: '#1c2129', titleColor: '#e6edf3', bodyColor: '#8b949e',
            borderColor: '#30363d', borderWidth: 1,
            callbacks: {
              label: ctx => {
                const p = ctx.raw;
                const hours = p.y;
                const name = metrData.find(m => m.date.getTime() === new Date(p.x).getTime() && Math.abs(m.hours - hours) < 0.01)?.name || '';
                const timeStr = hours < 1 ? `${Math.round(hours * 60)}m` : hours < 24 ? `${hours.toFixed(1)}h` : `${(hours / 24).toFixed(1)}d`;
                return `${name}: ${timeStr}`;
              },
            },
          },
        },
      },
    });
  }

  function renderCard(container, title, renderFn) {
    const card = document.createElement('div');
    card.className = 'chart-card';
    const h3 = document.createElement('h3');
    h3.textContent = title;
    card.appendChild(h3);
    const wrapper = document.createElement('div');
    wrapper.className = 'chart-wrapper';
    const canvas = document.createElement('canvas');
    wrapper.appendChild(canvas);
    card.appendChild(wrapper);
    container.appendChild(card);
    renderFn(canvas);
  }

  return { createGasChart, createCPIChart, createMETRChart, renderCard };
})();

/** Initialize indicators section. */
async function initIndicators(container) {
  const results = await Promise.allSettled([
    IndicatorService.fetchIndicators(),
    IndicatorService.fetchMETR(),
  ]);

  const indicatorData = results[0].status === 'fulfilled' ? results[0].value : {};
  const metrData = results[1].status === 'fulfilled' ? results[1].value : null;

  const hasGas = ['Gas-Regular', 'Gas-Premium', 'Gas-Diesel'].some(k => indicatorData[k]?.length > 0);
  const hasCPI = indicatorData['CPI']?.length > 0;
  const hasMETR = metrData && metrData.length > 0;

  if (!hasGas && !hasCPI && !hasMETR) return;

  const section = document.createElement('section');
  section.className = 'category-section';
  const h2 = document.createElement('h2');
  h2.className = 'category-title';
  h2.textContent = 'Economic & AI Indicators';
  section.appendChild(h2);

  const grid = document.createElement('div');
  grid.className = 'chart-grid';

  if (hasGas) {
    IndicatorRenderer.renderCard(grid, 'US Gas Prices ($/gal)', canvas => {
      IndicatorRenderer.createGasChart(canvas, indicatorData);
    });
  }

  if (hasCPI) {
    IndicatorRenderer.renderCard(grid, 'US Consumer Price Index', canvas => {
      IndicatorRenderer.createCPIChart(canvas, indicatorData['CPI']);
    });
  }

  if (hasMETR) {
    IndicatorRenderer.renderCard(grid, 'METR Agent Time Horizon (50% success)', canvas => {
      IndicatorRenderer.createMETRChart(canvas, metrData);
    });
  }

  section.appendChild(grid);
  container.appendChild(section);
}
