// ──────────────────────────────────────────────
// config.js — Edit this file to connect your Google Sheet
// ──────────────────────────────────────────────

const CONFIG = {
  // Published spreadsheet ID (from File → Share → Publish to web URL)
  // Format: https://docs.google.com/spreadsheets/d/e/PUBLISH_ID/pub?output=csv
  PUBLISH_ID: '2PACX-1vRKFD-iGUfn7rWfWiZ63tJS8MJcew3gdzIrvaKhG2VXd1dRIJY_Rlzo4BFfoJ9jknlVoyzO0XCy7hMf',

  // Tab GIDs — click each tab in Sheets and read #gid=XXXXXXXX from the URL
  SHEET_GIDS: {
    QUESTIONS:   0,
    MARKETS:     121572886,
    HISTORY:     21183126,
    ANNOTATIONS: 1666890327,
    PRICES:      451971888,
    INDICATORS:  149061804,
  },

  // Platform display colors (match CSS variables)
  PLATFORM_COLORS: {
    manifold:   '#4f8ff7',
    polymarket: '#a855f7',
    kalshi:     '#22c55e',
    metaculus:  '#f97316',
  },

  PLATFORM_LABELS: {
    manifold:   'Manifold',
    polymarket: 'Polymarket',
    kalshi:     'Kalshi',
    metaculus:  'Metaculus',
  },

  // Line styles to distinguish multiple markets on the same platform
  LINE_DASHES: [
    [],         // solid
    [6, 3],     // dashed
    [2, 2],     // dotted
    [8, 3, 2, 3], // dash-dot
  ],

  // Build a CSV URL for a given tab using the CORS-friendly pub endpoint
  csvUrl(tabKey) {
    const gid = this.SHEET_GIDS[tabKey.toUpperCase()];
    return `https://docs.google.com/spreadsheets/d/e/${this.PUBLISH_ID}/pub?output=csv&gid=${gid}`;
  },
};
