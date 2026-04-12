# Linking Apps Script to Your Existing Google Sheet

You already have a Google Sheet. Now link the Apps Script code to it.

## Steps

### 1. Open your sheet and create a container-bound script

1. Go to your Google Sheet: https://docs.google.com/spreadsheets/d/1QtVCh1IjjnjoqyUXU-Tz8dTHfBGfiOTJkTp4stE4tVo/edit
2. Click **Extensions → Apps Script**
3. This opens a new Apps Script project (container-bound to your sheet)
4. You'll see a default `Code.gs` file with some placeholder code

### 2. Get the Script ID

In the Apps Script editor:
1. Click the **settings icon** (⚙️) on the left sidebar
2. Under "IDs", copy the **Script ID** (it looks like `AKfycbz...`)

### 3. Link clasp to this script

In your terminal:

```bash
cd apps-script

# Clone the existing script (replace with your Script ID)
clasp clone YOUR_SCRIPT_ID_HERE
```

This creates a `.clasp.json` file that links your local code to the sheet's script.

### 4. Push your code to the script

```bash
./deploy.sh
```

Or manually:
```bash
clasp push --force
```

The `--force` flag overwrites the default placeholder code in the Apps Script editor.

### 5. Verify in the Apps Script editor

1. Go back to the Apps Script editor (or run `clasp open`)
2. You should see your `Code.gs` with all the functions
3. Try running `recordAllProbabilities` to test (it will prompt for permissions)

### 6. Set up triggers (one-time)

In the Apps Script editor:
1. Select the `createTrigger` function from the dropdown
2. Click **Run** (▶)
3. Grant permissions when prompted
4. This sets up twice-daily data collection at 8 AM and 8 PM

### 7. (Optional) Set up Metaculus API token

If you have Metaculus questions:
1. Go to https://www.metaculus.com/ → Profile → Settings → API Access
2. Copy your API token
3. In Apps Script editor: **Project Settings** (⚙️) → **Script Properties**
4. Add property: Key = `METACULUS_API_TOKEN`, Value = your token

---

## Why container-bound vs standalone?

**Container-bound** (recommended for this project):
- Attached to your specific Google Sheet
- `SpreadsheetApp.getActiveSpreadsheet()` works automatically
- Shows up in Extensions → Apps Script in the sheet

**Standalone** (not recommended here):
- Separate from any sheet
- Would need to hardcode the sheet ID or use `SpreadsheetApp.openById()`
- More complex to set up

Since our code uses `getActiveSpreadsheet()`, it expects to be container-bound!

---

## Troubleshooting

**"Exception: You do not have permission to call..."**
→ Run any function once in the Apps Script editor to grant permissions

**"Error: No such file or directory .clasp.json"**
→ Make sure you're in the `apps-script` directory when running `clasp clone`

**"Push failed"**
→ Try `clasp push --force` to overwrite

**Changes not showing up?**
→ Make sure you ran `clasp push` and refresh the Apps Script editor
