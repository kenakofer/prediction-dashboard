// ──────────────────────────────────────────────
// charts.js — Render Chart.js time-series charts
// ──────────────────────────────────────────────

const ChartRenderer = (() => {
  const PLATFORMS = ['manifold', 'polymarket', 'kalshi', 'metaculus'];

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
          padding: 4,
          borderRadius: 4,
        },
      };
    });
    return result;
  }

  /** Build datasets for a single question (one line per platform) */
  function buildDatasets(historyEntries) {
    if (!historyEntries) return [];
    // Group by platform
    const byPlatform = {};
    for (const entry of historyEntries) {
      if (!byPlatform[entry.platform]) byPlatform[entry.platform] = [];
      byPlatform[entry.platform].push({
        x: entry.timestamp,
        y: entry.probability,
      });
    }

    return PLATFORMS
      .filter((p) => byPlatform[p])
      .map((p) => ({
        label: CONFIG.PLATFORM_LABELS[p],
        data: byPlatform[p],
        borderColor: CONFIG.PLATFORM_COLORS[p],
        backgroundColor: CONFIG.PLATFORM_COLORS[p] + '1a',
        borderWidth: 2,
        pointRadius: 0,
        pointHitRadius: 8,
        tension: 0.25,
        fill: false,
      }));
  }

  /** Create a chart on a canvas element */
  function createChart(canvas, question, historyEntries, annotations) {
    const datasets = buildDatasets(historyEntries);
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
            grid: {
              color: 'rgba(48, 54, 61, 0.5)',
            },
            ticks: {
              color: '#8b949e',
              maxTicksLimit: 8,
            },
          },
          y: {
            min: 0,
            max: 100,
            ticks: {
              color: '#8b949e',
              callback: (v) => v + '%',
              stepSize: 25,
            },
            grid: {
              color: 'rgba(48, 54, 61, 0.5)',
            },
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
          annotation: {
            annotations: annotationObjects,
          },
        },
      },
    });
  }

  /** Build the full HTML card for a question and render its chart */
  function renderQuestionCard(container, question, historyEntries, annotations) {
    const card = document.createElement('div');
    card.className = 'chart-card';

    // Title
    const h3 = document.createElement('h3');
    h3.textContent = question.title;
    card.appendChild(h3);

    // Current probabilities
    const latestProbs = DataService.getLatestProbabilities(historyEntries);
    const probDiv = document.createElement('div');
    probDiv.className = 'current-prob';
    const probParts = [];
    for (const p of PLATFORMS) {
      if (latestProbs[p]) {
        probParts.push(
          `<span class="platform-tag ${p}">${CONFIG.PLATFORM_LABELS[p]}</span> <span>${latestProbs[p].probability.toFixed(1)}%</span>`
        );
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

    // Platform links
    const linksDiv = document.createElement('div');
    linksDiv.className = 'links';
    const links = [];
    if (question.platforms.manifold)
      links.push(`<a href="https://manifold.markets/browse?q=${encodeURIComponent(question.title)}" target="_blank">Manifold ↗</a>`);
    if (question.platforms.polymarket)
      links.push(`<a href="https://polymarket.com/event/${question.platforms.polymarket}" target="_blank">Polymarket ↗</a>`);
    if (question.platforms.kalshi)
      links.push(`<a href="https://kalshi.com/markets/${question.platforms.kalshi}" target="_blank">Kalshi ↗</a>`);
    if (question.platforms.metaculus)
      links.push(`<a href="https://www.metaculus.com/questions/${question.platforms.metaculus}/" target="_blank">Metaculus ↗</a>`);
    linksDiv.innerHTML = links.join('');
    card.appendChild(linksDiv);

    container.appendChild(card);

    // Render chart (after DOM insertion so canvas has dimensions)
    createChart(canvas, question, historyEntries, annotations);
  }

  return { renderQuestionCard };
})();
