# Google Apps Script Setup Guide

## 1. Create the Google Sheet

Create a new Google Sheet with **3 tabs** (exact names matter):

### Tab: `Questions`

| question_id | title | category | sort_order | manifold_slug | polymarket_slug | kalshi_ticker | metaculus_id |
|---|---|---|---|---|---|---|---|
| us-pres-2028 | Will a Democrat win the 2028 presidential election? | Politics | 1 | will-a-democrat-win-the-2028-us-pres | democrat-2028 | PRES-2028-DEM | 12345 |
| ai-agi-2030 | Will AGI be achieved by 2030? | AI | 1 | will-agi-be-achieved-by-2030 | | | 3479 |

**Notes:**
- `question_id`: A short unique identifier you choose (e.g., `us-pres-2028`)
- `manifold_slug`: The slug from the Manifold URL. For `https://manifold.markets/JohnDoe/will-x-happen`, use `JohnDoe/will-x-happen`
- `polymarket_slug`: The slug from the Polymarket URL, or the CLOB token ID
- `kalshi_ticker`: The ticker from Kalshi (e.g., `PRES-2028-DEM`)
- `metaculus_id`: The numeric question ID from the Metaculus URL
- Leave cells **blank** for platforms that don't have the question

### Tab: `History`

| question_id | timestamp | platform | probability |
|---|---|---|---|
| us-pres-2028 | 2026-01-15T08:00:00Z | manifold | 52.3 |
| us-pres-2028 | 2026-01-15T08:00:00Z | kalshi | 51.0 |

This tab will be **auto-populated** by the Apps Script. Just create the header row.

### Tab: `Annotations`

| question_id | date | note |
|---|---|---|
| us-pres-2028 | 2026-03-15 | Candidate X drops out |
| ai-agi-2030 | 2026-06-01 | Major AI breakthrough announced |

Add annotations manually whenever you want a vertical dotted line + label on a chart.

---

## 2. Publish the Sheet to the Web

1. Open your Google Sheet
2. Go to **File → Share → Publish to web**
3. Select **Entire Document** and **Comma-separated values (.csv)**
4. Click **Publish**
5. Copy the **Sheet ID** from your sheet's URL:
   `https://docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`

---

## 3. Configure the Frontend

Edit `js/config.js` and replace `YOUR_GOOGLE_SHEET_ID_HERE` with your Sheet ID.

---

## 4. Set Up the Apps Script

1. In your Google Sheet, go to **Extensions → Apps Script**
2. Delete the default `Code.gs` content
3. Paste the entire contents of `apps-script/Code.gs` from this repo
4. Click **Save** (💾)

### Run the setup:

1. In the Apps Script editor, select `createTrigger` from the function dropdown
2. Click **Run** (▶)
3. Grant the necessary permissions when prompted
4. This sets up **twice-daily** automatic data collection (8 AM and 8 PM)

### Set up Metaculus API token (optional):

Metaculus requires authentication. If you have Metaculus questions in your sheet:
1. Go to [metaculus.com](https://www.metaculus.com/) → Profile → Settings → API Access
2. Copy your API token
3. In the Apps Script editor, go to **Project Settings** (⚙️) → **Script Properties**
4. Add a property: Key = `METACULUS_API_TOKEN`, Value = your token

### Optional: Backfill historical data

1. Select `backfillHistory` from the function dropdown
2. Click **Run** (▶)
3. This pulls historical data from Manifold and Polymarket APIs

### Test manually:

1. Select `recordAllProbabilities` from the function dropdown
2. Click **Run** (▶)
3. Check the **History** tab — new rows should appear

---

## 5. Verify Everything Works

1. Check that History tab has data
2. Open your GitHub Pages URL: `https://kenakofer.github.io/prediction-dashboard/`
3. You should see your charts!

---

## Troubleshooting

- **No data showing?** Make sure the sheet is published to the web and the Sheet ID is correct in `config.js`
- **API errors in Apps Script?** Check **View → Executions** in the Apps Script editor for logs
- **Polymarket not working?** Polymarket's API may require the CLOB token ID rather than a slug. Find it in the network tab of browser dev tools on the Polymarket page.
- **Charts empty?** Check the browser console (F12) for errors. Verify CSV URLs load in a new tab.
