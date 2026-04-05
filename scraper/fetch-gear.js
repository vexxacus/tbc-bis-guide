#!/usr/bin/env node
/**
 * Ironforge.pro Character Gear Scraper
 * 
 * Reads the leaderboard data (from fetch-leaderboard.js) and fetches
 * full gear data for each player via the character API.
 * 
 * API: https://ironforge.pro/api/anniversary/player/{server}/{name}
 * 
 * Features:
 *   - Resumable: skips players already fetched (saved in output/gear-progress.json)
 *   - Rate-limited: configurable delay between requests
 *   - Filterable: by class, spec, bracket, region, top N
 * 
 * Usage:
 *   node scraper/fetch-gear.js                           # Fetch all (SLOW)
 *   node scraper/fetch-gear.js --class Warrior           # Only Warriors
 *   node scraper/fetch-gear.js --spec "Arms"             # Only Arms spec
 *   node scraper/fetch-gear.js --bracket 3v3             # Only 3v3
 *   node scraper/fetch-gear.js --top 100                 # Top 100 per bracket
 *   node scraper/fetch-gear.js --delay 2000              # 2s between requests
 *   node scraper/fetch-gear.js --class Warrior --top 50  # Top 50 Warriors
 */

const fs = require('fs');
const path = require('path');

// ─── Paths ─────────────────────────────────────────────────────────────

const OUTPUT_DIR = path.join(__dirname, 'output');
const LEADERBOARD_FILE = path.join(OUTPUT_DIR, 'leaderboard-raw.json');
const PROGRESS_FILE = path.join(OUTPUT_DIR, 'gear-progress.json');
const GEAR_FILE = path.join(OUTPUT_DIR, 'gear-raw.json');

const BASE_URL = 'https://ironforge.pro/api/anniversary/player';

// ─── CLI Args ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name, fallback) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

const filterClass = getArg('class', null);
const filterSpec = getArg('spec', null);
const filterBracket = getArg('bracket', null);
const filterRegion = getArg('region', null);
const topN = parseInt(getArg('top', '0'), 10);
const delayMs = parseInt(getArg('delay', '1200'), 10);
const dryRun = args.includes('--dry-run');

// ─── Helpers ───────────────────────────────────────────────────────────

async function fetchJSON(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) TBC-BiS-Tool/1.0',
          'Accept': 'application/json',
          'Referer': 'https://ironforge.pro/anniversary/leaderboards/EU/3/'
        }
      });
      if (res.status === 404) return null; // Player not found
      if (res.status === 429) {
        console.log(`      ⏳ Rate limited! Waiting 10s...`);
        await new Promise(r => setTimeout(r, 10000));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt < retries) {
        const wait = 2000 * attempt + Math.random() * 2000;
        console.log(`      ⚠️  Attempt ${attempt} failed: ${err.message}. Retrying in ${(wait/1000).toFixed(1)}s...`);
        await new Promise(r => setTimeout(r, wait));
      } else {
        throw err;
      }
    }
  }
}

function loadProgress() {
  if (fs.existsSync(PROGRESS_FILE)) {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  }
  return { fetched: {}, failed: [], gearData: [] };
}

function saveProgress(progress) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

function uniqueKey(player) {
  return `${player.server}/${player.name}`;
}

// ─── Main ──────────────────────────────────────────────────────────────

(async () => {
  console.log('⚔️  TBC Anniversary Character Gear Scraper');
  console.log(`   Delay between requests: ${delayMs}ms`);
  if (filterClass) console.log(`   Class filter: ${filterClass}`);
  if (filterSpec) console.log(`   Spec filter: ${filterSpec}`);
  if (filterBracket) console.log(`   Bracket filter: ${filterBracket}`);
  if (filterRegion) console.log(`   Region filter: ${filterRegion}`);
  if (topN) console.log(`   Top N per bracket: ${topN}`);
  if (dryRun) console.log(`   🏳️  DRY RUN — no requests will be made`);
  console.log('');

  // Load leaderboard data
  if (!fs.existsSync(LEADERBOARD_FILE)) {
    console.error('❌ Leaderboard data not found! Run fetch-leaderboard.js first.');
    process.exit(1);
  }

  const leaderboard = JSON.parse(fs.readFileSync(LEADERBOARD_FILE, 'utf8'));
  
  // Collect unique players to fetch (avoid duplicates across brackets)
  const playerMap = new Map();

  for (const [key, bracket] of Object.entries(leaderboard.leaderboards)) {
    const [region, bracketName] = key.split('_');

    if (filterRegion && region !== filterRegion.toUpperCase()) continue;
    if (filterBracket && bracketName !== filterBracket) continue;

    let players = bracket.players;

    if (filterClass) {
      players = players.filter(p => p.class && p.class.toLowerCase() === filterClass.toLowerCase());
    }
    if (filterSpec) {
      players = players.filter(p => p.spec && p.spec.toLowerCase() === filterSpec.toLowerCase());
    }
    if (topN > 0) {
      players = players.slice(0, topN);
    }

    for (const player of players) {
      const pKey = uniqueKey(player);
      if (!playerMap.has(pKey)) {
        playerMap.set(pKey, {
          ...player,
          brackets: [bracketName]
        });
      } else {
        // Player appears in multiple brackets — merge bracket info
        const existing = playerMap.get(pKey);
        if (!existing.brackets.includes(bracketName)) {
          existing.brackets.push(bracketName);
        }
        // Keep highest rating
        if (player.rating > existing.rating) {
          existing.rating = player.rating;
          existing.spec = player.spec;
        }
      }
    }
  }

  const uniquePlayers = Array.from(playerMap.values());
  console.log(`📋 ${uniquePlayers.length} unique players to fetch gear for`);

  // Load progress (for resuming)
  const progress = loadProgress();
  const alreadyFetched = Object.keys(progress.fetched).length;
  if (alreadyFetched > 0) {
    console.log(`   ♻️  Resuming — ${alreadyFetched} already fetched`);
  }

  if (dryRun) {
    console.log('\n🏳️  Dry run complete. Would fetch:');
    const byClass = {};
    uniquePlayers.forEach(p => {
      const cls = p.class || 'Unknown';
      byClass[cls] = (byClass[cls] || 0) + 1;
    });
    Object.entries(byClass).sort((a, b) => b[1] - a[1]).forEach(([cls, count]) => {
      console.log(`   ${cls}: ${count}`);
    });
    process.exit(0);
  }

  // Fetch gear for each player
  let fetchedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  const startTime = Date.now();

  for (let i = 0; i < uniquePlayers.length; i++) {
    const player = uniquePlayers[i];
    const pKey = uniqueKey(player);

    // Skip if already fetched
    if (progress.fetched[pKey]) {
      skippedCount++;
      continue;
    }

    const encodedName = encodeURIComponent(player.name);
    const url = `${BASE_URL}/${player.server}/${encodedName}`;
    const pct = ((i / uniquePlayers.length) * 100).toFixed(1);
    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    
    process.stdout.write(`  [${pct}%] ${i + 1}/${uniquePlayers.length} (${elapsed}m) ${player.name} (${player.spec} ${player.class}, ${player.rating})... `);

    try {
      const data = await fetchJSON(url);
      
      if (data && data.info) {
        const gear = data.info.gear || [];
        const gearSummary = gear.map(g => ({
          id: g.id,
          name: g.name,
          slot: g.slot,
          quality: g.quality,
          gems: (g.gems || []).map(gem => ({ id: gem.id, name: gem.name })),
          enchantId: g.enchant_id || null,
          enchantName: g.enchant || null
        }));

        progress.fetched[pKey] = {
          name: player.name,
          server: player.server,
          region: player.region,
          class: data.info.class || player.class,
          spec: data.info.spec || player.spec,
          race: data.info.race || player.race,
          faction: data.info.faction || player.faction,
          guild: data.info.guild || null,
          gearscore: data.info.gearscore || null,
          rating: player.rating,
          ranking: player.ranking,
          brackets: player.brackets,
          gear: gearSummary,
          fetchedAt: new Date().toISOString()
        };

        fetchedCount++;
        console.log(`✅ ${gear.length} items`);
      } else {
        console.log(`⚠️  No gear data`);
        progress.fetched[pKey] = { name: player.name, server: player.server, gear: [], error: 'no_data' };
      }
    } catch (err) {
      console.log(`❌ ${err.message}`);
      progress.failed.push({ ...player, error: err.message });
      failedCount++;
    }

    // Save progress every 25 players
    if (fetchedCount % 25 === 0) {
      saveProgress(progress);
    }

    // Rate limit
    await new Promise(r => setTimeout(r, delayMs + Math.random() * 500));
  }

  // Final save
  saveProgress(progress);

  // ─── Build final output ──────────────────────────────────────────────

  const gearEntries = Object.values(progress.fetched).filter(p => p.gear && p.gear.length > 0);

  const finalOutput = {
    meta: {
      season: 1,
      scrapedAt: new Date().toISOString(),
      totalPlayers: gearEntries.length,
      filters: { class: filterClass, spec: filterSpec, bracket: filterBracket, region: filterRegion, topN }
    },
    players: gearEntries
  };

  fs.writeFileSync(GEAR_FILE, JSON.stringify(finalOutput, null, 2));

  // ─── Summary ─────────────────────────────────────────────────────────

  const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log('\n═══════════════════════════════════════════');
  console.log('📋 GEAR SCRAPING SUMMARY');
  console.log('═══════════════════════════════════════════');
  console.log(`   ✅ Fetched: ${fetchedCount}`);
  console.log(`   ♻️  Skipped (already done): ${skippedCount}`);
  console.log(`   ❌ Failed: ${failedCount}`);
  console.log(`   ⏱️  Time: ${totalTime} minutes`);
  console.log(`   💾 Saved to: ${GEAR_FILE}`);
  console.log(`   📦 File size: ${(fs.statSync(GEAR_FILE).size / 1024).toFixed(1)} KB`);
  console.log('');

  // Item frequency preview
  console.log('🔝 Most popular items (preview):');
  const itemFreq = {};
  gearEntries.forEach(player => {
    player.gear.forEach(item => {
      const key = `${item.id}:${item.name}`;
      if (!itemFreq[key]) itemFreq[key] = { id: item.id, name: item.name, slot: item.slot, count: 0 };
      itemFreq[key].count++;
    });
  });

  Object.values(itemFreq)
    .sort((a, b) => b.count - a.count)
    .slice(0, 15)
    .forEach(item => {
      const pct = ((item.count / gearEntries.length) * 100).toFixed(1);
      console.log(`   ${pct}% — [${item.id}] ${item.name} (${item.slot})`);
    });

  console.log('\n✅ Done!');
})();
