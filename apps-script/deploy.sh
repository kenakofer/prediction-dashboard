#!/bin/bash
# Quick deployment script for Apps Script code
# Pushes code AND redeploys the web app in one step.

set -e

cd "$(dirname "$0")"

# Check if clasp is configured
if [ ! -f .clasp.json ]; then
  echo "❌ No .clasp.json found."
  echo ""
  echo "First-time setup:"
  echo "  1. Run: clasp login"
  echo "  2. Then either:"
  echo "     - clasp create --type standalone --title \"Prediction Watch Data Collector\""
  echo "     - clasp clone <SCRIPT_ID>  (if script already exists)"
  echo ""
  exit 1
fi

echo "🚀 Pushing Apps Script code..."
clasp push --force

# Deployment ID from the published web app URL
DEPLOY_ID="AKfycbz7Zw9RqWoP-FxmE5zmkay8lR4s9ltlZGLy6Y7YqDKPh_c78bdA67XCKvg6Z_Dc08HR"

echo "🔄 Redeploying web app..."
if clasp deploy -i "$DEPLOY_ID" 2>/dev/null; then
  echo "✅ Web app redeployed!"
else
  echo "⚠️  Auto-redeploy failed. Please redeploy manually:"
  echo "   clasp open → Deploy → Manage deployments → Edit → New version → Deploy"
fi

echo ""
echo "✅ Done! Code pushed and web app updated."
