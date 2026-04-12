// ──────────────────────────────────────────────
// config.js — Edit this file to connect your Google Sheet
// ──────────────────────────────────────────────

const CONFIG = {
  PUBLISH_ID: '2PACX-1vRKFD-iGUfn7rWfWiZ63tJS8MJcew3gdzIrvaKhG2VXd1dRIJY_Rlzo4BFfoJ9jknlVoyzO0XCy7hMf',

  // Tab GIDs — click each tab and read #gid=XXXXXXXX from the URL
  SHEET_GIDS: {
    QUESTIONS:   0,
    MARKETS:     121572886,
    DATA:        836790020,
    ANNOTATIONS: 1666890327,
  },

  // Default platform colors (used when Markets row has no explicit color)
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

  LINE_DASHES: [
    [],           // solid
    [6, 3],       // dashed
    [2, 2],       // dotted
    [8, 3, 2, 3], // dash-dot
  ],

  // Auto-palette for series without explicit color
  PALETTE: [
    '#58a6ff', '#f97316', '#22c55e', '#a855f7',
    '#f7931a', '#627eea', '#ef4444', '#f59e0b',
    '#00c7b1', '#8b949e',
  ],

  csvUrl(tabKey) {
    const gid = this.SHEET_GIDS[tabKey.toUpperCase()];
    if (gid == null) return null;
    return `https://docs.google.com/spreadsheets/d/e/${this.PUBLISH_ID}/pub?output=csv&gid=${gid}`;
  },
};
