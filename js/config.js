// ──────────────────────────────────────────────
// config.js — Edit this file to connect your Google Sheet
// ──────────────────────────────────────────────

const CONFIG = {
  // Replace with your Google Sheet ID (the long string in the sheet URL)
  // Example: https://docs.google.com/spreadsheets/d/THIS_PART_HERE/edit
  SHEET_ID: '1QtVCh1IjjnjoqyUXU-Tz8dTHfBGfiOTJkTp4stE4tVo',

  // Tab names in your Google Sheet (must match exactly)
  TABS: {
    QUESTIONS: 'Questions',
    HISTORY: 'History',
    ANNOTATIONS: 'Annotations',
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

  // Build a CSV URL for a given tab
  csvUrl(tabName) {
    return `https://docs.google.com/spreadsheets/d/${this.SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`;
  },
};
