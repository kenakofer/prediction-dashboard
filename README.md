# Prediction Watch

A personal dashboard of hand-selected prediction market questions, pulling data from Manifold, Polymarket, Kalshi, and Metaculus.

**Live site:** [https://kenakofer.github.io/prediction-dashboard/](https://kenakofer.github.io/prediction-dashboard/)

## How It Works

```
Google Sheet (private)          GitHub Pages (public)
┌──────────────────────┐        ┌──────────────────────┐
│ Questions tab        │  CSV   │                      │
│ History tab       ───────────→│  Chart.js dashboard  │
│ Annotations tab      │  fetch │                      │
└──────────┬───────────┘        └──────────────────────┘
           │
    Apps Script
    (twice daily)
           │
    ┌──────┴──────┐
    │ Platform    │
    │ APIs        │
    └─────────────┘
```

- **Content** is managed in a private Google Sheet (questions, annotations)
- **Data collection** is automated via Google Apps Script (runs twice daily)
- **Display** is a static GitHub Pages site that fetches published CSV data on page load
- **Charts** overlay probability lines from multiple platforms with annotation markers

## Quick Start

1. **Create the Google Sheet** — See [`apps-script/setup.md`](apps-script/setup.md) for the full sheet structure
2. **Set up the Apps Script** — Paste `apps-script/Code.gs` into Extensions → Apps Script
3. **Publish the sheet** — File → Share → Publish to web
4. **Configure** — Set your Sheet ID in `js/config.js`
5. **Deploy** — Push to GitHub and enable Pages from Settings

## Sheet Structure

| Tab | Purpose |
|-----|---------|
| `Questions` | Master list: ID, title, category, platform identifiers |
| `History` | Time-series data (auto-populated by Apps Script) |
| `Annotations` | Manual date+note markers shown as vertical lines on charts |

## Supported Platforms

| Platform | Identifier | Example |
|----------|-----------|---------|
| Manifold | Slug from URL | `JohnDoe/will-x-happen` |
| Polymarket | Slug or CLOB token ID | `will-x-happen` |
| Kalshi | Market ticker | `PRES-2028-DEM` |
| Metaculus | Numeric question ID | `12345` |

## Project Structure

```
├── index.html              Main page
├── css/style.css           Dark theme
├── js/
│   ├── config.js           Google Sheet ID + colors
│   ├── data.js             CSV fetching + parsing
│   ├── charts.js           Chart.js rendering
│   └── main.js             Orchestrator
├── apps-script/
│   ├── Code.gs             Google Apps Script source
│   └── setup.md            Detailed setup guide
└── README.md
```

## License

MIT
