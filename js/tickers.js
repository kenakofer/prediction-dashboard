// ──────────────────────────────────────────────
// tickers.js — Financial price charts (crypto + stocks)
// ──────────────────────────────────────────────

const TickerService = (() => {
  const COLORS = {
    'BTC-USD':  '#f7931a',
    'ETH-USD':  '#627eea',
    GRMN:       '#00c7b1',
    '^GSPC':    '#22c55e',
    'CL=F':     '#f97316',
  };

  const LABELS = {
    'BTC-USD':  'Bitcoin',
    'ETH-USD':  'Ethereum',
    GRMN:       'Garmin (GRMN)',
    '^GSPC':    'S&P 500',
    'CL=F':     'WTI Crude Oil',
  };

  const WINDOW_DAYS = { '1Y': 365, '2Y': 730, '5Y': 1825 };

  /** Fetch the Prices sheet CSV (written by Apps Script from Yahoo Finance). */
  async function fetchAllPrices() {
    const url = CONFIG.csvUrl('PRICES');
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Prices CSV: HTTP ${resp.status}`);
    const text = await resp.text();
    return parseStockCSV(text);
  }

  function parseStockCSV(csvText) {
    const parsed = Papa.parse(csvText.trim(), { header: true, skipEmptyLines: true });
    const bySymbol = {};
    for (const row of parsed.data) {
      const sym = row.symbol?.trim();
      const price = parseFloat(row.close);
      const date = new Date(row.date?.trim());
      if (!sym || isNaN(price) || isNaN(date.getTime())) continue;
      if (!bySymbol[sym]) bySymbol[sym] = [];
      bySymbol[sym].push({ date, price });
    }
    for (const sym of Object.keys(bySymbol)) {
      bySymbol[sym].sort((a, b) => a.date - b.date);
    }
    return bySymbol;
  }

  return { COLORS, LABELS, WINDOW_DAYS, fetchAllPrices };
})();

const TickerRenderer = (() => {
  /** Filter to last N days and express as % change from the first point. */
  function toPercentChange(points, days) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const windowed = points.filter(p => p.date >= cutoff);
    if (windowed.length === 0) return [];
    const base = windowed[0].price;
    return windowed.map(p => ({ x: p.date, y: ((p.price - base) / base) * 100 }));
  }

  function buildDatasets(allSeries, days) {
    return allSeries.map(s => {
      const pctData = toPercentChange(s.data, days);
      const color = TickerService.COLORS[s.id] || '#888';
      return {
        label: TickerService.LABELS[s.id] || s.id,
        data: pctData,
        borderColor: color,
        backgroundColor: color + '1a',
        borderWidth: 2,
        pointRadius: (ctx) => ctx.dataIndex === pctData.length - 1 ? 4 : 0,
        pointHoverRadius: (ctx) => ctx.dataIndex === pctData.length - 1 ? 6 : 4,
        pointHitRadius: 8,
        tension: 0.1,
        fill: false,
      };
    });
  }

  function createChart(canvas, allSeries, days) {
    return new Chart(canvas, {
      type: 'line',
      data: { datasets: buildDatasets(allSeries, days) },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            type: 'time',
            time: {
              tooltipFormat: 'MMM d, yyyy',
              displayFormats: { day: 'MMM d', week: 'MMM d', month: 'MMM yyyy' },
            },
            grid: { color: 'rgba(48, 54, 61, 0.5)' },
            ticks: { color: '#8b949e', maxTicksLimit: 8 },
          },
          y: {
            ticks: {
              color: '#8b949e',
              callback: v => `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`,
            },
            grid: { color: 'rgba(48, 54, 61, 0.5)' },
          },
        },
        plugins: {
          legend: {
            display: true,
            labels: {
              color: '#8b949e',
              usePointStyle: true,
              pointStyle: 'circle',
              padding: 16,
              font: { size: 12 },
            },
          },
          tooltip: {
            backgroundColor: '#1c2129',
            titleColor: '#e6edf3',
            bodyColor: '#8b949e',
            borderColor: '#30363d',
            borderWidth: 1,
            callbacks: {
              label: ctx => {
                const v = ctx.parsed.y;
                return `${ctx.dataset.label}: ${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
              },
            },
          },
        },
      },
    });
  }

  /** Render a chart card with 1Y / 2Y / 5Y toggle buttons. */
  function renderTickerCard(container, title, allSeries, defaultWindow = '1Y') {
    const card = document.createElement('div');
    card.className = 'chart-card';

    const h3 = document.createElement('h3');
    h3.textContent = title;
    card.appendChild(h3);

    const toggleDiv = document.createElement('div');
    toggleDiv.className = 'window-toggle';
    for (const key of Object.keys(TickerService.WINDOW_DAYS)) {
      const btn = document.createElement('button');
      btn.textContent = key;
      btn.className = 'window-btn' + (key === defaultWindow ? ' active' : '');
      btn.dataset.window = key;
      toggleDiv.appendChild(btn);
    }
    card.appendChild(toggleDiv);

    const wrapper = document.createElement('div');
    wrapper.className = 'chart-wrapper';
    const canvas = document.createElement('canvas');
    wrapper.appendChild(canvas);
    card.appendChild(wrapper);

    container.appendChild(card);

    let chart = createChart(canvas, allSeries, TickerService.WINDOW_DAYS[defaultWindow]);

    toggleDiv.addEventListener('click', (e) => {
      const btn = e.target.closest('.window-btn');
      if (!btn) return;
      toggleDiv.querySelectorAll('.window-btn').forEach(b => b.classList.toggle('active', b === btn));
      const days = TickerService.WINDOW_DAYS[btn.dataset.window];
      chart.data.datasets = buildDatasets(allSeries, days);
      chart.update();
    });
  }

  return { renderTickerCard };
})();

/** Initialise both ticker sections and append them to the given container. */
async function initTickers(container) {
  try {
    const priceData = await TickerService.fetchAllPrices();

    const section = document.createElement('section');
    section.className = 'category-section';
    const h2 = document.createElement('h2');
    h2.className = 'category-title';
    h2.textContent = 'Markets';
    section.appendChild(h2);

    const grid = document.createElement('div');
    grid.className = 'chart-grid';

    const cryptoSeries = ['BTC-USD', 'ETH-USD']
      .filter(sym => priceData[sym]?.length > 0)
      .map(sym => ({ id: sym, data: priceData[sym] }));

    if (cryptoSeries.length > 0) {
      TickerRenderer.renderTickerCard(grid, 'Crypto', cryptoSeries);
    }

    const stockSeries = ['^GSPC', 'CL=F', 'GRMN']
      .filter(sym => priceData[sym]?.length > 0)
      .map(sym => ({ id: sym, data: priceData[sym] }));

    if (stockSeries.length > 0) {
      TickerRenderer.renderTickerCard(grid, 'Stocks & Commodities', stockSeries);
    }

    section.appendChild(grid);
    container.appendChild(section);
  } catch (err) {
    console.error('Tickers failed to load:', err);
    const msg = document.createElement('p');
    msg.style.cssText = 'color:#8b949e;text-align:center;padding:1rem;';
    msg.textContent = `Ticker data unavailable: ${err.message}`;
    container.appendChild(msg);
  }
}
