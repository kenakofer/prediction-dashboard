# Apps Script Deployment Guide

## Using `clasp` to sync code with Google Apps Script

`clasp` (Command Line Apps Script Projects) lets you develop Apps Script locally and push changes from Git.

### One-time setup

1. **Login to clasp**
   ```bash
   clasp login
   ```
   This opens a browser to authorize clasp with your Google account.

2. **Create or clone the Apps Script project**

   **Option A: Create a new standalone script**
   ```bash
   cd apps-script
   clasp create --type standalone --title "Prediction Watch Data Collector"
   ```

   **Option B: Link to an existing script** (if you already created one in the sheet)
   - Go to your Google Sheet → Extensions → Apps Script
   - Click the settings icon (⚙️) → Copy the **Script ID**
   - Then run:
     ```bash
     cd apps-script
     clasp clone <SCRIPT_ID>
     ```

3. **Configure clasp settings**

   After creating/cloning, clasp creates a `.clasp.json` file in `apps-script/`:
   ```json
   {
     "scriptId": "YOUR_SCRIPT_ID",
     "rootDir": "."
   }
   ```

### Daily workflow: Push changes

Whenever you edit `apps-script/Code.gs`:

```bash
cd apps-script
clasp push
```

This uploads all `.gs`, `.js`, and `.html` files to your Apps Script project.

### Pull changes from Apps Script

If you make edits in the online editor:

```bash
cd apps-script
clasp pull
```

### Open the script in your browser

```bash
cd apps-script
clasp open
```

### Deploy as a web app or API (optional)

```bash
clasp deploy --description "v1.0"
```

---

## Alternative: Quick sync script

If you prefer not to use clasp, here's a manual approach:

**`apps-script/sync.sh`** (copy/paste reminder):
```bash
#!/bin/bash
echo "📋 Code.gs contents below. Copy and paste into Apps Script editor:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
cat Code.gs
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Then go to: https://script.google.com/home"
```

---

## Recommended Git workflow

Add `.clasp.json` to Git (it's safe to commit the script ID):

```bash
cd apps-script
git add .clasp.json
git commit -m "Add clasp configuration"
```

Your `.gitignore` should already exclude sensitive files. The script ID is public information once deployed.
