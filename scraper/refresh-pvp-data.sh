#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
# PvP BiS Data Refresh — Run weekly to update arena gear data
# Usage: ./scraper/refresh-pvp-data.sh [--top N]
#
# Crontab example (every Sunday at 03:00):
#   0 3 * * 0 cd /path/to/tbc-bis-app && ./scraper/refresh-pvp-data.sh >> scraper/output/refresh.log 2>&1
# ═══════════════════════════════════════════════════════════════════════

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="$SCRIPT_DIR/output"
TOP="${1:---top 200}"

echo ""
echo "══════════════════════════════════════════════════════════"
echo "  PvP Data Refresh — $(date '+%Y-%m-%d %H:%M:%S')"
echo "══════════════════════════════════════════════════════════"

cd "$PROJECT_DIR"

# Step 1: Fetch leaderboard
echo ""
echo "─── Step 1/4: Fetching leaderboard ───"
node scraper/fetch-leaderboard.js

# Step 2: Clear old gear progress to force full re-fetch
echo ""
echo "─── Step 2/4: Clearing old gear progress ───"
rm -f "$OUTPUT_DIR/gear-progress.json"
rm -f "$OUTPUT_DIR/gear-raw.json"

# Step 3: Fetch gear data
echo ""
echo "─── Step 3/4: Fetching gear data ($TOP) ───"
node scraper/fetch-gear.js $TOP

# Step 4: Run frequency analysis
echo ""
echo "─── Step 4/4: Running frequency analysis ───"
node scraper/analyze-gear.js

# Step 5: Convert to JS
echo ""
echo "─── Converting to js/pvp-data.js ───"
node -e "
const data = require('./scraper/output/pvp-bis-data.json');
const output = 'const PVP_DATA = ' + JSON.stringify(data) + ';';
require('fs').writeFileSync('js/pvp-data.js', output, 'utf-8');
console.log('Written js/pvp-data.js:', (output.length/1024).toFixed(1), 'KB');
console.log('Specs:', Object.keys(data.specs).length);
console.log('Players analyzed:', data.meta.totalPlayers);
console.log('Analyzed at:', data.meta.analyzedAt);
"

echo ""
echo "══════════════════════════════════════════════════════════"
echo "  ✅ Refresh complete — $(date '+%Y-%m-%d %H:%M:%S')"
echo "══════════════════════════════════════════════════════════"
