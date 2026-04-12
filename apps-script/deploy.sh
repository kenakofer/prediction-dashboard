#!/bin/bash
# Quick deployment script for Apps Script code

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
clasp push

echo ""
echo "✅ Code pushed to Apps Script!"
echo ""
echo "📝 Next steps:"
echo "  - Run 'clasp open' to view in browser"
echo "  - Or go to: https://script.google.com/home"
