#!/usr/bin/env node
/**
 * Ironforge.pro TBC Anniversary Arena Leaderboard Scraper
 * 
 * Uses the discovered internal JSON API to fetch arena leaderboard data.
 * No Puppeteer needed for this step — pure HTTP requests.
 * 
 * API pattern:
 *   https://ironforge.pro/api/anniversary/leaderboards/{season}/{region}/{bracket}/
 * 
 * Usage:
 *   node scraper/fetch-leaderboard.js                    # All defaults (EU+US, 2v2+3v3)
 *   node scraper/fetch-leaderboard.js --region EU        # EU only
 *   node scraper/fetch-leaderboard.js --bracket 3        # 3v3 only
 *   node scraper/fetch-leaderboard.js --class Warrior    # Filter by class
 *   node scraper/fetch-leaderboard.js --top 50           # Top 50 only
 * 
 * Output: scraper/output/leaderboard-raw.json
 */

const fs = require('fs');
const path = require('path');

// ─── Config ────────────────────────────────────────────────────────────

const SEASON = 1; // TBC Anniversary Season 1
const BASE_URL = 'https://ironforge.pro/api/anniversary/leaderboards';

const REGIONS = ['EU', 'US'];
const BRACKETS = [2, 3]; // 2v2, 3v3  (5v5 optional)

const WOW_CLASSES = [
  'Druid', 'Hunter', 'Mage', 'Paladin', 'Priest',
  'Rogue', 'Shaman', 'Warlock', 'Warrior'
];

// ─── CLI Args ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name, fallback) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

const filterRegion = getArg('region', null);
const filterBracket = getArg('bracket', null);
const filterClass = getArg('class', null);
const topN = parseInt(getArg('top', '0'), 10);

const regions = filterRegion ? [filterRegion.toUpperCase()] : REGIONS;
const brackets = filterBracket ? [parseInt(filterBracket, 10)] : BRACKETS;

// ─── Fetch with retry ──────────────────────────────────────────────────

async function fetchJSON(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (err) {
      console.error(`  ⚠️  Attempt ${attempt}/${retries} failed: ${err.message}`);
      if (attempt < retries) {
        const delay = 1000 * attempt + Math.random() * 1000;
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
}

// ─── Main ──────────────────────────────────────────────────────────────

(async () => {
  console.log('🏟️  TBC Anniversary Arena Leaderboard Scraper');
  console.log(`   Season: ${SEASON}`);
  console.log(`   Regions: ${regions.join(', ')}`);
  console.log(`   Brackets: ${brackets.map(b => `${b}v${b}`).join(', ')}`);
  if (filterClass) console.log(`   Class filter: ${filterClass}`);
  if (topN) console.log(`   Top N: ${topN}`);
  console.log('');

  const allData = {};
  let totalPlayers = 0;

  for (const region of regions) {
    for (const bracket of brackets) {
      const key = `${region}_${bracket}v${bracket}`;
      const url = `${BASE_URL}/${SEASON}/${region}/${bracket}/`;
      
      console.log(`📡 Fetching ${key}...`);
      console.log(`   ${url}`);

      try {
        const json = await fetchJSON(url);
        
        if (!json.data || !Array.isArray(json.data)) {
          console.log(`   ❌ No data array found in response`);
          continue;
        }

        let players = json.data;
        console.log(`   ✅ ${players.length} players fetched`);

        // Apply class filter
        if (filterClass) {
          players = players.filter(p => 
            p.class.toLowerCase() === filterClass.toLowerCase()
          );
          console.log(`   🔍 ${players.length} ${filterClass}s after class filter`);
        }

        // Apply top N
        if (topN > 0) {
          players = players.slice(0, topN);
        }

        // Enrich with metadata
        players = players.map(p => ({
          ...p,
          region,
          bracket: `${bracket}v${bracket}`,
          season: SEASON,
          scrapedAt: new Date().toISOString()
        }));

        allData[key] = {
          updated: json.updated ? new Date(json.updated).toISOString() : null,
          playerCount: players.length,
          players
        };

        totalPlayers += players.length;

        // Print summary per class/spec
        const specCounts = {};
        players.forEach(p => {
          const label = `${p.spec} ${p.class}`;
          specCounts[label] = (specCounts[label] || 0) + 1;
        });

        const sorted = Object.entries(specCounts)
          .sort((a, b) => b[1] - a[1]);
        
        console.log(`   📊 Top specs:`);
        sorted.slice(0, 10).forEach(([spec, count]) => {
          const pct = ((count / players.length) * 100).toFixed(1);
          const bar = '█'.repeat(Math.ceil(count / players.length * 20));
          console.log(`      ${bar} ${spec}: ${count} (${pct}%)`);
        });
        console.log('');

        // Rate limit — be polite
        await new Promise(r => setTimeout(r, 1500));

      } catch (err) {
        console.error(`   ❌ Failed: ${err.message}`);
      }
    }
  }

  // ─── Save output ─────────────────────────────────────────────────────

  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const outputFile = path.join(outputDir, 'leaderboard-raw.json');
  const output = {
    meta: {
      season: SEASON,
      regions,
      brackets: brackets.map(b => `${b}v${b}`),
      totalPlayers,
      scrapedAt: new Date().toISOString(),
      filters: { region: filterRegion, bracket: filterBracket, class: filterClass, topN }
    },
    leaderboards: allData
  };

  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
  console.log(`💾 Saved ${totalPlayers} players to ${outputFile}`);
  console.log(`   File size: ${(fs.statSync(outputFile).size / 1024).toFixed(1)} KB`);

  // ─── Print overall summary ───────────────────────────────────────────

  console.log('\n═══════════════════════════════════════════');
  console.log('📋 SUMMARY');
  console.log('═══════════════════════════════════════════');

  // Overall class distribution
  const allPlayers = Object.values(allData).flatMap(d => d.players);
  const classCounts = {};
  allPlayers.forEach(p => {
    classCounts[p.class] = (classCounts[p.class] || 0) + 1;
  });

  console.log('\nClass distribution (all brackets):');
  Object.entries(classCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([cls, count]) => {
      const pct = ((count / allPlayers.length) * 100).toFixed(1);
      const bar = '█'.repeat(Math.ceil(count / allPlayers.length * 30));
      console.log(`  ${bar} ${cls}: ${count} (${pct}%)`);
    });

  // Rating distribution
  const ratingBuckets = { '2200+': 0, '2000-2199': 0, '1850-1999': 0, '1700-1849': 0, '1500-1699': 0, '<1500': 0 };
  allPlayers.forEach(p => {
    if (p.rating >= 2200) ratingBuckets['2200+']++;
    else if (p.rating >= 2000) ratingBuckets['2000-2199']++;
    else if (p.rating >= 1850) ratingBuckets['1850-1999']++;
    else if (p.rating >= 1700) ratingBuckets['1700-1849']++;
    else if (p.rating >= 1500) ratingBuckets['1500-1699']++;
    else ratingBuckets['<1500']++;
  });

  console.log('\nRating distribution:');
  Object.entries(ratingBuckets).forEach(([bucket, count]) => {
    const pct = ((count / allPlayers.length) * 100).toFixed(1);
    console.log(`  ${bucket}: ${count} (${pct}%)`);
  });

  console.log('\n✅ Done!');
})();
