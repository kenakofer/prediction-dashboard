// ──────────────────────────────────────────────
// charts.js — Render Chart.js time-series charts
// ──────────────────────────────────────────────

const ChartRenderer = (() => {

  /** Build annotation objects for vertical dotted lines */
  function buildAnnotations(annotations) {
    if (!annotations || annotations.length === 0) return {};
    const result = {};
    annotations.forEach((a, i) => {
      result[`anno-${i}`] = {
        type: 'line',
        xMin: a.date,
        xMax: a.date,
        borderColor: 'rgba(255, 255, 255, 0.25)',
        borderWidth: 1,
        borderDash: [4, 4],
        label: {
          display: true,
          content: a.note,
          position: 'start',
          backgroundColor: 'rgba(22, 27, 34, 0.9)',
          color: '#8b949e',
          font: { size: 10 },
          padding: { x: 4, y: 3 },
          borderRadius: 4,
          rotation: -90,
          xAdjust: -10,
        },
      };
    });
    return result;
  }

  /**
   * Build datasets from Markets + History.
   * Each market entry gets its own line. Multiple markets on the same platform
   * share a color but use different dash styles.
   */
  function buildDatasets(marketsForQuestion, historyEntries) {
    if (!marketsForQuestion || !historyEntries) return [];

    // Index history by slug for fast lookup
    const bySlug = {};
    for (const entry of historyEntries) {
      const key = entry.slug || '';
      if (!bySlug[key]) bySlug[key] = [];
      bySlug[key].push({ x: entry.timestamp, y: entry.probability });
    }

    // Track how many markets we've seen per platform (for dash style rotation)
    const platformCount = {};

    return marketsForQuestion
      .filter((m) => bySlug[m.slug])
      .map((m) => {
        const pIdx = platformCount[m.platform] || 0;
        platformCount[m.platform] = pIdx + 1;
        const dash = CONFIG.LINE_DASHES[pIdx % CONFIG.LINE_DASHES.length];

        return {
          label: m.label,
          data: bySlug[m.slug],
          borderColor: CONFIG.PLATFORM_COLORS[m.platform] || '#888',
          backgroundColor: (CONFIG.PLATFORM_COLORS[m.platform] || '#888') + '1a',
          borderWidth: 2,
          borderDash: dash,
          pointRadius: 0,
          pointHitRadius: 8,
          tension: 0.25,
          fill: false,
          // Stash platform for link generation
          _platform: m.platform,
          _slug: m.slug,
        };
      });
  }

  /** Create a chart on a canvas element */
  function createChart(canvas, marketsForQuestion, historyEntries, annotations) {
    const datasets = buildDatasets(marketsForQuestion, historyEntries);
    const annotationObjects = buildAnnotations(annotations);

    return new Chart(canvas, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        scales: {
          x: {
            type: 'time',
            time: {
              tooltipFormat: 'MMM d, yyyy',
              displayFormats: {
                day: 'MMM d',
                week: 'MMM d',
                month: 'MMM yyyy',
              },
            },
            grid: { color: 'rgba(48, 54, 61, 0.5)' },
            ticks: { color: '#8b949e', maxTicksLimit: 8 },
          },
          y: {
            min: 0,
            max: 100,
            ticks: {
              color: '#8b949e',
              callback: (v) => v + '%',
              stepSize: 25,
            },
            grid: { color: 'rgba(48, 54, 61, 0.5)' },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1c2129',
            titleColor: '#e6edf3',
            bodyColor: '#8b949e',
            borderColor: '#30363d',
            borderWidth: 1,
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%`,
            },
          },
          annotation: { annotations: annotationObjects },
        },
      },
    });
  }

  /** Generate a link URL for a market */
  function marketUrl(market) {
    // Use explicit URL from the Markets sheet if provided
    if (market.url) return market.url;
    // Auto-generate fallback
    const slug = market.slug;
    switch (market.platform) {
      case 'manifold':   return `https://manifold.markets/browse?q=${encodeURIComponent(slug)}`;
      case 'polymarket': return `https://polymarket.com/event/${slug}`;
      case 'kalshi':     return `https://kalshi.com/browse?query=${encodeURIComponent(slug)}`;
      case 'metaculus':  return `https://www.metaculus.com/questions/${slug}/`;
      default:           return null;
    }
  }

  /** Build the full HTML card for a question and render its chart */
  function renderQuestionCard(container, question, marketsForQuestion, historyEntries, annotations) {
    const card = document.createElement('div');
    card.className = 'chart-card';

    // Title
    const h3 = document.createElement('h3');
    h3.textContent = question.title;
    card.appendChild(h3);

    // Current probabilities — one tag per market (clickable, links to market URL)
    const latestProbs = DataService.getLatestProbabilities(historyEntries);
    const probDiv = document.createElement('div');
    probDiv.className = 'current-prob';
    const probParts = [];
    for (const m of (marketsForQuestion || [])) {
      const latest = latestProbs[m.slug];
      if (latest) {
        const url = marketUrl(m);
        const tagHtml = url
          ? `<a class="platform-tag ${m.platform}" href="${url}" target="_blank" rel="noopener">${m.label}</a>`
          : `<span class="platform-tag ${m.platform}">${m.label}</span>`;
        probParts.push(`${tagHtml} <span>${latest.probability.toFixed(1)}%</span>`);
      }
    }
    probDiv.innerHTML = probParts.length ? probParts.join('  ') : '<em>No data yet</em>';
    card.appendChild(probDiv);

    // Chart canvas
    const wrapper = document.createElement('div');
    wrapper.className = 'chart-wrapper';
    const canvas = document.createElement('canvas');
    wrapper.appendChild(canvas);
    card.appendChild(wrapper);

    container.appendChild(card);

    // Render chart (after DOM insertion so canvas has dimensions)
    createChart(canvas, marketsForQuestion, historyEntries, annotations);
  }

  return { renderQuestionCard };
})();
