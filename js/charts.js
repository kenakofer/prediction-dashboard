// ──────────────────────────────────────────────
// charts.js — Unified chart rendering
// Dispatches by chart_type from the Questions sheet.
// ──────────────────────────────────────────────

const ChartRenderer = (() => {

  // ── Shared helpers ─────────────────────────────

  const DARK = {
    grid: 'rgba(48, 54, 61, 0.5)',
    tick: '#8b949e',
    tooltipBg: '#1c2129',
    tooltipTitle: '#e6edf3',
    tooltipBody: '#8b949e',
    tooltipBorder: '#30363d',
    annotationLine: 'rgba(255, 255, 255, 0.25)',
    annotationBg: 'rgba(22, 27, 34, 0.9)',
  };

  /** Pick a color for a source: explicit > platform default > palette */
  function pickColor(source, index) {
    if (source.color) return source.color;
    if (CONFIG.PLATFORM_COLORS[source.platform]) return CONFIG.PLATFORM_COLORS[source.platform];
    return CONFIG.PALETTE[index % CONFIG.PALETTE.length];
  }

  /** Endpoint-circle pointRadius callback */
  function endpointRadius(size) {
    return (ctx) => ctx.dataIndex === ctx.dataset.data.length - 1 ? size : 0;
  }

  function baseTooltip() {
    return {
      backgroundColor: DARK.tooltipBg,
      titleColor: DARK.tooltipTitle,
      bodyColor: DARK.tooltipBody,
      borderColor: DARK.tooltipBorder,
      borderWidth: 1,
    };
  }

  function timeXAxis(fmt) {
    return {
      type: 'time',
      time: {
        tooltipFormat: fmt || 'MMM d, yyyy',
        displayFormats: { day: 'MMM d', week: 'MMM d', month: 'MMM yyyy' },
      },
      grid: { color: DARK.grid },
      ticks: { color: DARK.tick, maxTicksLimit: 8 },
    };
  }

  function buildAnnotations(annotations) {
    if (!annotations || annotations.length === 0) return {};
    const result = {};
    annotations.forEach((a, i) => {
      result[`anno-${i}`] = {
        type: 'line',
        xMin: a.date, xMax: a.date,
        borderColor: DARK.annotationLine,
        borderWidth: 1, borderDash: [4, 4],
        label: {
          display: true, content: a.note, position: 'start',
          backgroundColor: DARK.annotationBg, color: DARK.tick,
          font: { size: 10 }, padding: { x: 4, y: 3 },
          borderRadius: 4, rotation: -90, xAdjust: -10,
        },
      };
    });
    return result;
  }

  function legendConfig(show) {
    return {
      display: show,
      labels: {
        color: DARK.tick, usePointStyle: true, pointStyle: 'circle',
        padding: 16, font: { size: 12 },
      },
    };
  }

  /** Generate a link URL for a market/source */
  function sourceUrl(source) {
    if (source.url) return source.url;
    const slug = source.slug;
    switch (source.platform) {
      case 'manifold':   return `https://manifold.markets/browse?q=${encodeURIComponent(slug)}`;
      case 'polymarket': return `https://polymarket.com/event/${slug}`;
      case 'kalshi':     return `https://kalshi.com/browse?query=${encodeURIComponent(slug)}`;
      case 'metaculus':  return `https://www.metaculus.com/questions/${slug}/`;
      default:           return null;
    }
  }

  // ── Chart type: probability ────────────────────

  function renderProbability(canvas, graph, sources, graphData, annotations, days) {
    const cutoff = days ? cutoffDate(days) : null;
    const platformCount = {};
    const datasets = (sources || [])
      .filter(s => graphData[s.slug])
      .map((s, i) => {
        const pIdx = platformCount[s.platform] || 0;
        platformCount[s.platform] = pIdx + 1;
        const color = pickColor(s, i);
        const raw = graphData[s.slug];
        const data = (cutoff ? raw.filter(p => p.date >= cutoff) : raw)
          .map(p => ({ x: p.date, y: p.value }));
        return {
          label: s.label,
          data,
          borderColor: color,
          backgroundColor: color + '1a',
          borderWidth: 2,
          borderDash: CONFIG.LINE_DASHES[pIdx % CONFIG.LINE_DASHES.length],
          pointRadius: endpointRadius(4),
          pointHoverRadius: endpointRadius(6),
          pointHitRadius: 8,
          tension: 0.25,
          fill: false,
          _platform: s.platform,
          _slug: s.slug,
        };
      });

    return new Chart(canvas, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true, maintainAspectRatio: true,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: timeXAxis(),
          y: {
            min: 0, max: 100,
            ticks: { color: DARK.tick, callback: v => v + '%', stepSize: 25 },
            grid: { color: DARK.grid },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...baseTooltip(),
            callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%` },
          },
          annotation: { annotations: buildAnnotations(annotations) },
        },
      },
    });
  }

  // ── Chart type: percent_change ─────────────────

  const DEFAULT_WINDOWS = [12, 24, 60]; // months

  function cutoffDate(days) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d;
  }

  function monthLabel(m) {
    if (m % 12 === 0) return `${m / 12}Y`;
    return `${m}M`;
  }

  function parseWindows(param) {
    if (!param) return DEFAULT_WINDOWS;
    const parsed = param.split(',').map(s => parseInt(s.trim(), 10)).filter(n => n > 0);
    return parsed.length > 0 ? parsed : DEFAULT_WINDOWS;
  }

  function toPercentChange(points, days) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const windowed = points.filter(p => p.date >= cutoff);
    if (windowed.length === 0) return [];
    const base = windowed[0].value;
    return windowed.map(p => ({ x: p.date, y: ((p.value - base) / base) * 100 }));
  }

  function buildPctDatasets(sources, graphData, days) {
    return (sources || [])
      .filter(s => graphData[s.slug]?.length > 0)
      .map((s, i) => {
        const color = pickColor(s, i);
        const pctData = toPercentChange(graphData[s.slug], days);
        return {
          label: s.label,
          data: pctData,
          borderColor: color, backgroundColor: color + '1a',
          borderWidth: 2,
          pointRadius: (ctx) => ctx.dataIndex === pctData.length - 1 ? 4 : 0,
          pointHoverRadius: (ctx) => ctx.dataIndex === pctData.length - 1 ? 6 : 4,
          pointHitRadius: 8,
          tension: 0.1, fill: false,
        };
      });
  }

  function renderPercentChange(canvas, graph, sources, graphData, days) {
    return new Chart(canvas, {
      type: 'line',
      data: { datasets: buildPctDatasets(sources, graphData, days || Math.round(parseWindows(graph.param)[0] * 30.44)) },
      options: {
        responsive: true, maintainAspectRatio: true,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: timeXAxis(),
          y: {
            ticks: { color: DARK.tick, callback: v => `${v >= 0 ? '+' : ''}${v.toFixed(0)}%` },
            grid: { color: DARK.grid },
          },
        },
        plugins: {
          legend: legendConfig(true),
          tooltip: {
            ...baseTooltip(),
            callbacks: {
              label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y >= 0 ? '+' : ''}${ctx.parsed.y.toFixed(1)}%`,
            },
          },
        },
      },
    });
  }

  // ── Chart type: dollar ─────────────────────────

  function renderDollar(canvas, graph, sources, graphData, days) {
    const cutoff = days ? cutoffDate(days) : null;
    const datasets = (sources || [])
      .filter(s => graphData[s.slug]?.length > 0)
      .map((s, i) => {
        const color = pickColor(s, i);
        const raw = graphData[s.slug];
        const data = (cutoff ? raw.filter(p => p.date >= cutoff) : raw)
          .map(p => ({ x: p.date, y: p.value }));
        return {
          label: s.label, data,
          borderColor: color, backgroundColor: color + '1a',
          borderWidth: 2,
          pointRadius: endpointRadius(4),
          pointHoverRadius: endpointRadius(6),
          pointHitRadius: 8, tension: 0.25, fill: false,
        };
      });

    const unitStr = graph.unit || '$';
    return new Chart(canvas, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true, maintainAspectRatio: true,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: timeXAxis('MMM yyyy'),
          y: {
            ticks: { color: DARK.tick, callback: v => '$' + v.toFixed(2) },
            grid: { color: DARK.grid },
          },
        },
        plugins: {
          legend: legendConfig(datasets.length > 1),
          tooltip: {
            ...baseTooltip(),
            callbacks: { label: ctx => `${ctx.dataset.label}: $${ctx.parsed.y.toFixed(3)}` },
          },
        },
      },
    });
  }

  // ── Chart type: index ──────────────────────────

  function renderIndex(canvas, graph, sources, graphData, days) {
    const cutoff = days ? cutoffDate(days) : null;
    const datasets = (sources || [])
      .filter(s => graphData[s.slug]?.length > 0)
      .map((s, i) => {
        const color = pickColor(s, i);
        const raw = graphData[s.slug];
        const data = (cutoff ? raw.filter(p => p.date >= cutoff) : raw)
          .map(p => ({ x: p.date, y: p.value }));
        return {
          label: s.label, data,
          borderColor: color, backgroundColor: color + '1a',
          borderWidth: 2,
          pointRadius: endpointRadius(4),
          pointHoverRadius: endpointRadius(6),
          pointHitRadius: 8, tension: 0.25, fill: true,
        };
      });

    return new Chart(canvas, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true, maintainAspectRatio: true,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: timeXAxis('MMM yyyy'),
          y: {
            ticks: { color: DARK.tick },
            grid: { color: DARK.grid },
          },
        },
        plugins: {
          legend: legendConfig(datasets.length > 1),
          tooltip: {
            ...baseTooltip(),
            callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}` },
          },
        },
      },
    });
  }

  // ── Chart type: log_scatter ────────────────────

  function renderLogScatter(canvas, graph, sources, graphData, days) {
    const cutoff = days ? cutoffDate(days) : null;
    // Collect all data points across all series for this graph
    const allPoints = [];
    for (const [series, points] of Object.entries(graphData)) {
      const name = series.includes(':') ? series.split(':').slice(1).join(':') : series;
      const filtered = cutoff ? points.filter(p => p.date >= cutoff) : points;
      for (const p of filtered) {
        allPoints.push({ date: p.date, value: p.value, name });
      }
    }
    allPoints.sort((a, b) => a.date - b.date);

    // Compute frontier (new records over time)
    let maxSoFar = 0;
    const frontier = [];
    for (const p of allPoints) {
      if (p.value > maxSoFar) {
        maxSoFar = p.value;
        frontier.push(p);
      }
    }
    const frontierSet = new Set(frontier);

    return new Chart(canvas, {
      type: 'scatter',
      data: {
        datasets: [
          {
            label: 'Frontier',
            data: frontier.map(p => ({ x: p.date, y: p.value })),
            borderColor: '#22c55e', backgroundColor: '#22c55e',
            pointRadius: 5, pointHoverRadius: 7,
            showLine: true, borderWidth: 2, tension: 0,
          },
          {
            label: 'Non-frontier',
            data: allPoints.filter(p => !frontierSet.has(p)).map(p => ({ x: p.date, y: p.value })),
            borderColor: '#6e7681', backgroundColor: '#6e7681',
            pointRadius: 4, pointHoverRadius: 6,
            showLine: false,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: true,
        interaction: { mode: 'nearest', intersect: true },
        scales: {
          x: timeXAxis(),
          y: {
            type: 'logarithmic',
            ticks: {
              color: DARK.tick,
              callback(v) {
                if (v < 1) return Math.round(v * 60) + 'm';
                if (v < 24) return v + 'h';
                return Math.round(v / 24) + 'd';
              },
            },
            grid: { color: DARK.grid },
          },
        },
        plugins: {
          legend: legendConfig(true),
          tooltip: {
            ...baseTooltip(),
            callbacks: {
              label: ctx => {
                const hours = ctx.raw.y;
                const d = new Date(ctx.raw.x);
                const point = allPoints.find(p =>
                  p.date.getTime() === d.getTime() && Math.abs(p.value - hours) < 0.01
                );
                const name = point?.name || '';
                const timeStr = hours < 1 ? `${Math.round(hours * 60)}m`
                  : hours < 24 ? `${hours.toFixed(1)}h`
                  : `${(hours / 24).toFixed(1)}d`;
                return `${name}: ${timeStr}`;
              },
            },
          },
        },
      },
    });
  }

  // ── Card rendering ─────────────────────────────

  /** Render a graph card: title, optional header, chart */
  function renderGraphCard(container, graph, sources, graphData, annotations) {
    const card = document.createElement('div');
    card.className = 'chart-card';

    // Title
    const h3 = document.createElement('h3');
    h3.textContent = graph.title;
    card.appendChild(h3);

    // Chart-type-specific header
    if (graph.chartType === 'probability') {
      const latestValues = DataService.getLatestValues(graphData);
      const probDiv = document.createElement('div');
      probDiv.className = 'current-prob';
      const parts = [];
      for (const s of (sources || [])) {
        const latest = latestValues[s.slug];
        if (latest) {
          const url = sourceUrl(s);
          const tag = url
            ? `<a class="platform-tag ${s.platform}" href="${url}" target="_blank" rel="noopener">${s.label}</a>`
            : `<span class="platform-tag ${s.platform}">${s.label}</span>`;
          parts.push(`${tag} <span>${latest.value.toFixed(1)}%</span>`);
        }
      }
      probDiv.innerHTML = parts.length ? parts.join('  ') : '<em>No data yet</em>';
      card.appendChild(probDiv);
    }

    // Time window toggle — shown for any chart type with param set
    let toggleDiv = null;
    let windowMonths = null;
    if (graph.param) {
      // Find data span in days to prune redundant windows
      let dataSpanDays = 0;
      for (const points of Object.values(graphData || {})) {
        if (points.length < 2) continue;
        const span = (points[points.length - 1].date - points[0].date) / 86400000;
        if (span > dataSpanDays) dataSpanDays = span;
      }

      // Keep all windows shorter than data span, plus at most one longer
      const allWindows = parseWindows(graph.param);
      if (dataSpanDays > 0) {
        const filtered = [];
        let addedLong = false;
        for (const m of allWindows) {
          if (m * 30.44 <= dataSpanDays) {
            filtered.push(m);
          } else if (!addedLong) {
            filtered.push(m);
            addedLong = true;
          }
        }
        windowMonths = filtered.length > 0 ? filtered : allWindows;
      } else {
        windowMonths = allWindows;
      }

      toggleDiv = document.createElement('div');
      toggleDiv.className = 'window-toggle';
      windowMonths.forEach((m, i) => {
        const btn = document.createElement('button');
        btn.textContent = monthLabel(m);
        const isDefault = i === windowMonths.length - 1;
        btn.className = 'window-btn' + (isDefault ? ' active' : '');
        btn.dataset.months = m;
        toggleDiv.appendChild(btn);
      });
      card.appendChild(toggleDiv);
    }

    // Chart canvas
    const wrapper = document.createElement('div');
    wrapper.className = 'chart-wrapper';
    const canvas = document.createElement('canvas');
    wrapper.appendChild(canvas);
    card.appendChild(wrapper);

    container.appendChild(card);

    // Initial days from last (longest) window
    let currentDays = windowMonths ? Math.round(windowMonths[windowMonths.length - 1] * 30.44) : null;
    let chart = null;

    function buildChart(days) {
      if (chart) chart.destroy();
      switch (graph.chartType) {
        case 'probability':
          return renderProbability(canvas, graph, sources, graphData || {}, annotations, days);
        case 'percent_change':
          return renderPercentChange(canvas, graph, sources, graphData || {}, days);
        case 'dollar':
          return renderDollar(canvas, graph, sources, graphData || {}, days);
        case 'index':
          return renderIndex(canvas, graph, sources, graphData || {}, days);
        case 'log_scatter':
          return renderLogScatter(canvas, graph, sources, graphData || {}, days);
        default:
          console.warn(`Unknown chart_type "${graph.chartType}" for ${graph.id}`);
          return null;
      }
    }

    chart = buildChart(currentDays);

    // Wire up time window toggle
    if (toggleDiv && chart) {
      toggleDiv.addEventListener('click', (e) => {
        const btn = e.target.closest('.window-btn');
        if (!btn) return;
        toggleDiv.querySelectorAll('.window-btn').forEach(b => b.classList.toggle('active', b === btn));
        currentDays = Math.round(parseInt(btn.dataset.months, 10) * 30.44);
        chart = buildChart(currentDays);
      });
    }
  }

  return { renderGraphCard };
})();
