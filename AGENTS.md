# Prediction Watch — Agent & Developer Guide

## Architecture Overview

All graph configuration lives in a **private Google Sheet** published as public CSV.
The frontend is a static GitHub Pages site that fetches those CSVs at load time.
A Google Apps Script runs on time triggers to snapshot API data into the sheet.

```
Google Sheet (private)           GitHub Pages (public)
├── Graphs tab  ─── CSV ──────►  js/data.js (parseQuestions)
├── Sources tab ─── CSV ──────►  js/data.js (parseMarkets)
├── Data tab    ─── CSV ──────►  js/data.js (parseData)
└── Annotations ─── CSV ──────►  js/data.js (parseAnnotations)

Apps Script (server-side)
└── Code.gs ──── reads Sources, writes Data rows on schedule
```

### Sheet Tab GIDs (in `js/config.js`)
| Tab | GID |
|-----|-----|
| Graphs | 0 |
| Sources | 121572886 |
| Data | 836790020 |
| Annotations | 1666890327 |

GIDs survive tab renames. If you add a new tab, create the sheet in Apps Script
(or manually) and update `SHEET_GIDS` in `js/config.js`.

---

## Web App API

The Apps Script is deployed as a web app for reading/writing the sheet from scripts.

**URL:** stored in `apps-script/deploy.sh` as `DEPLOY_ID`. The full exec URL is:
```
https://script.google.com/macros/s/<DEPLOY_ID>/exec
```

**Secret:** set as `WEBAPP_SECRET` in Apps Script → Project Settings → Script Properties.
Store it locally in an environment variable — never commit it.

```bash
export WEBAPP_SECRET="your-secret-here"
WEBAPP="https://script.google.com/macros/s/AKfycbz7Zw9RqWoP-FxmE5zmkay8lR4s9ltlZGLy6Y7YqDKPh_c78bdA67XCKvg6Z_Dc08HR/exec"
```

### API call pattern (POST redirects — must follow manually)

```bash
redirect=$(curl -si -X POST "$WEBAPP" \
  -H 'Content-Type: application/json' \
  -d "{\"secret\":\"$WEBAPP_SECRET\",\"action\":\"read\",\"sheet\":\"Graphs\"}" \
  | grep -i '^location:' | tr -d '\r' | sed 's/^[Ll]ocation: //')
curl -s "$redirect"
```

> **Gotcha:** Google Apps Script POST returns a 302 redirect. `curl -sL` loses the
> POST body on redirect. Always capture the `Location` header and do a separate GET.

### Available actions

| Action | Required fields | Description |
|--------|----------------|-------------|
| `read` | `sheet` | Returns `{headers, rows, count}` |
| `append` | `sheet`, `rows` (2D array) | Appends rows |
| `write_cells` | `sheet`, `range`, `values` | Write to a named range |
| `delete_rows` | `sheet`, `match: {column, value}` | Delete matching rows |
| `run` | `function` | Run an allowlisted Apps Script function |
| `get_sheets` | — | List all tabs with name and GID |

### Allowlisted `run` functions
`recordAllProbabilities`, `backfillHistory`, `backfillPrices`, `recordPrices`,
`backfillIndicators`, `recordIndicators`, `backfillMETR`, `dedupData`,
`migrateToUnifiedData`, `createTrigger`

---

## Adding a New Graph (sheet-only change)

1. **Graphs tab** — add a row:

   | question_id | title | category | sort_order | chart_type | unit | param |
   |-------------|-------|----------|------------|------------|------|-------|
   | `my-graph` | My Graph | My Category | 5 | `probability` | `%` | `1,6,12,24,60` |

   `chart_type` options: `probability`, `percent_change`, `dollar`, `index`, `log_scatter`

   `param` = comma-separated month values for time window toggle buttons
   (e.g. `1,6,12,24,60` → 1M, 6M, 1Y, 2Y, 5Y). Leave empty for no toggles.
   The **last** value is selected by default; buttons that exceed the actual data
   span are pruned (keeping at most one "show all" button).

2. **Sources tab** — add one row per data series:

   | question_id | platform | slug | label | url | param | color |
   |-------------|----------|------|-------|-----|-------|-------|
   | `my-graph` | `manifold` | `my-market-slug` | Manifold | `https://...` | | |

   `platform` values: `manifold`, `polymarket`, `kalshi`, `metaculus`, `yahoo`, `bls`, `metr`

   `color` = optional hex override (e.g. `#f7931a`); falls back to platform color then palette.

That's it — no code changes needed for existing platforms.

---

## Adding a New Platform (requires code changes)

1. **`apps-script/Code.gs`** — add a `fetchMyPlatform(slug)` function returning
   probability 0–100 (or price), and wire it into `recordAllProbabilities()` /
   `backfillHistory()`.

2. **`js/charts.js`** — if it's a prediction platform, add to `predictionPlatforms`
   set in `main.js` and to `CONFIG.PLATFORM_COLORS` / `CONFIG.PLATFORM_LABELS` in
   `config.js`.

3. Deploy: `cd apps-script && ./deploy.sh`

---

## Deploying Apps Script Changes

```bash
cd apps-script && ./deploy.sh
```

This does `clasp push --force` (answers yes to manifest prompt) then
`clasp deploy -i <DEPLOY_ID>` to update the live web app in one step.

> **Gotcha:** If the deployment ID ever changes (e.g. the web app was deleted and
> recreated), update `DEPLOY_ID` in `deploy.sh`. The URL pattern is
> `https://script.google.com/macros/s/<DEPLOY_ID>/exec`.

---

## Data Sheet Schema

**Graphs tab** columns: `question_id`, `title`, `category`, `sort_order`, `chart_type`, `unit`, `param`

**Sources tab** columns: `question_id`, `platform`, `slug`, `label`, `url`, `param`, `color`

> `param` in Sources is used for Metaculus: set to the cutoff date string for CDF
> probability-before-date calculation (e.g. `Tue Jan 01 2030 00:00:00 GMT-0800`).

**Data tab** columns: `graph_id`, `date`, `series`, `value`
- `graph_id` matches `question_id` in Graphs
- `series` matches `slug` in Sources (join key)
- `value` is probability (0–100), price, index value, or hours depending on chart type

**Annotations tab** columns: `question_id`, `date`, `note`
- Renders as a vertical dotted line with label on probability charts

---

## Common Gotchas

### Google Sheets date auto-conversion
`setValues()` auto-converts strings like `"2030-01-01"` to Date objects.
Apps Script helper `sheetDateStr(v)` handles this:
```js
function sheetDateStr(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'UTC', 'yyyy-MM-dd');
  return v?.toString().trim().substring(0, 10) || '';
}
```

### Deduplication
`appendDataRows(sheet, rows, existing)` checks `graph_id|date|series` keys before
writing. Always pass the result of `getExistingDataKeys(sheet)` to avoid duplicates
when re-running backfills.

### BLS API (gas prices, CPI)
Free, no key needed. `fetchBLS(seriesIds, startYear, endYear)` — series IDs come
from Sources rows with `platform=bls` and `slug=<BLS_SERIES_ID>`.
Monthly data; M13 (annual average) is skipped. Max 20-year span per call.

### Yahoo Finance
`fetchYahooHistory(symbol, rangeDays)` — `symbol` is the Yahoo ticker (e.g. `BTC-USD`,
`^GSPC`, `CL=F`). Requires `User-Agent` header; no CORS so must be called from Apps Script.

### Metaculus API
Requires `Authorization: Token <token>` (not Bearer). Token stored in Script
Properties as `METACULUS_API_TOKEN`. Returns a CDF over dates; `param` in Sources
specifies the cutoff date for computing "probability before date X".

### CORS & CSV publishing
The sheet must be published: File → Share → Publish to web → Entire Document.
Use the `pub?output=csv&gid=<GID>` URL format — these have `Access-Control-Allow-Origin: *`.

### Manifold backfill
Uses `/v0/bets` endpoint, samples one point per day (last bet of the day).
Only Manifold and Polymarket have public history APIs; Kalshi and Metaculus
data is collected going forward only.
