#!/usr/bin/env node
/**
 * PvP BiS Frequency Analyzer
 * 
 * Reads the scraped gear data and produces a weighted BiS list per class/spec.
 * 
 * Algorithm:
 *   1. Group players by class + spec
 *   2. For each slot, count how often each item appears
 *   3. Calculate popularity % and assign tier (gold/strong/viable/niche)
 *   4. Detect rating gates (items that only appear at high ratings)
 *   5. Detect PvE flex slots (items without Resilience in PvP sets)
 *   6. Output: pvp-bis-data.json
 * 
 * Usage:
 *   node scraper/analyze-gear.js
 *   node scraper/analyze-gear.js --min-players 5    # Require 5+ players per spec
 *   node scraper/analyze-gear.js --threshold 5      # Ignore items < 5% usage
 */

const fs = require('fs');
const path = require('path');

// ─── Paths ─────────────────────────────────────────────────────────────

const OUTPUT_DIR = path.join(__dirname, 'output');
const GEAR_FILE = path.join(OUTPUT_DIR, 'gear-raw.json');
const ANALYSIS_FILE = path.join(OUTPUT_DIR, 'pvp-bis-data.json');

// ─── CLI Args ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name, fallback) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

const minPlayers = parseInt(getArg('min-players', '3'), 10);
const outlierThreshold = parseInt(getArg('threshold', '5'), 10);

// ─── Known PvP items (for PvE flex detection) ──────────────────────────

// Gladiator S1 item IDs (partial list — we'll also detect by name pattern)
const PVP_NAME_PATTERNS = [
  /gladiator/i,
  /general('s|s)/i,
  /sergeant('s|s)/i,
  /marshal('s|s)/i,
  /warlord('s|s)/i,
  /commander('s|s)/i,
  /lieutenant/i,
  /medallion of the/i,
  /insignia of the/i,
  /battlemaster/i,
  /vindicator/i,
  /veteran/i,
];

function isPvPItem(item) {
  if (!item || !item.name) return false;
  return PVP_NAME_PATTERNS.some(p => p.test(item.name));
}

// ─── Tier classification ───────────────────────────────────────────────

function getTier(popularity) {
  if (popularity >= 70) return 'gold';       // 🥇 De facto BiS
  if (popularity >= 40) return 'strong';     // 🥈 Strong pick
  if (popularity >= 15) return 'viable';     // 🥉 Viable
  if (popularity >= outlierThreshold) return 'niche'; // ⚪ Niche
  return 'outlier'; // ❌ Below threshold
}

const TIER_EMOJI = {
  gold: '🥇',
  strong: '🥈',
  viable: '🥉',
  niche: '⚪',
  outlier: '❌'
};

// ─── Slot normalization ────────────────────────────────────────────────

// Ironforge uses various slot names — normalize them
function normalizeSlot(slot) {
  if (!slot) return 'Unknown';
  const map = {
    'head': 'Head',
    'neck': 'Neck',
    'shoulders': 'Shoulders', 'shoulder': 'Shoulders',
    'back': 'Back', 'cloak': 'Back',
    'chest': 'Chest', 'robe': 'Chest',
    'wrist': 'Wrist', 'bracers': 'Wrist', 'bracer': 'Wrist',
    'hands': 'Hands', 'gloves': 'Hands',
    'waist': 'Waist', 'belt': 'Waist',
    'legs': 'Legs', 'leggings': 'Legs',
    'feet': 'Feet', 'boots': 'Feet',
    'ring 1': 'Ring', 'ring 2': 'Ring', 'finger': 'Ring', 'ring': 'Ring',
    'trinket 1': 'Trinket', 'trinket 2': 'Trinket', 'trinket': 'Trinket',
    'main hand': 'Main Hand', 'main-hand': 'Main Hand',
    'off hand': 'Off Hand', 'off-hand': 'Off Hand', 'offhand': 'Off Hand', 'shield': 'Off Hand',
    'two-hand': 'Two-Hand', 'two hand': 'Two-Hand',
    'ranged': 'Ranged', 'relic': 'Ranged', 'wand': 'Ranged', 'thrown': 'Ranged', 'gun': 'Ranged', 'bow': 'Ranged', 'crossbow': 'Ranged', 'idol': 'Ranged', 'totem': 'Ranged', 'libram': 'Ranged',
  };
  return map[slot.toLowerCase()] || slot;
}

// ─── Rating bracket detection ──────────────────────────────────────────

const RATING_BRACKETS = [2200, 2000, 1850, 1700, 1500];

function detectRatingGate(itemUsers, allPlayersInSpec) {
  // Need a meaningful sample size to detect rating gates
  // With <10 players, statistical noise dominates
  if (allPlayersInSpec.length < 10) {
    return { minRating: null, avgRating: null, ratingGate: null };
  }

  // Find the minimum rating where this item appears
  const ratings = itemUsers.map(u => u.rating).sort((a, b) => a - b);
  const minRating = ratings[0];
  const avgRating = Math.round(ratings.reduce((a, b) => a + b, 0) / ratings.length);

  // Check if item is significantly more common at high ratings
  // by comparing usage % in top half vs bottom half of the spec's players
  const specRatings = allPlayersInSpec.map(p => p.rating).sort((a, b) => a - b);
  const medianRating = specRatings[Math.floor(specRatings.length / 2)];

  const highRatedUsers = itemUsers.filter(u => u.rating >= medianRating).length;
  const lowRatedUsers = itemUsers.filter(u => u.rating < medianRating).length;
  const highRatedTotal = allPlayersInSpec.filter(p => p.rating >= medianRating).length;
  const lowRatedTotal = allPlayersInSpec.filter(p => p.rating < medianRating).length;

  const highPct = highRatedTotal > 0 ? (highRatedUsers / highRatedTotal * 100) : 0;
  const lowPct = lowRatedTotal > 0 ? (lowRatedUsers / lowRatedTotal * 100) : 0;

  // If usage in top half is >2x bottom half, it's rating-gated
  let ratingGate = null;
  if (highPct > 0 && lowPct === 0) {
    // Only used by high-rated players
    ratingGate = RATING_BRACKETS.find(b => minRating >= b) || minRating;
  } else if (highPct > lowPct * 2 && lowPct < 20) {
    ratingGate = medianRating;
  }

  return { minRating, avgRating, ratingGate };
}

// ─── Main ──────────────────────────────────────────────────────────────

(async () => {
  console.log('📊 PvP BiS Frequency Analyzer');
  console.log(`   Min players per spec: ${minPlayers}`);
  console.log(`   Outlier threshold: ${outlierThreshold}%`);
  console.log('');

  // Load gear data
  if (!fs.existsSync(GEAR_FILE)) {
    console.error('❌ Gear data not found! Run fetch-gear.js first.');
    process.exit(1);
  }

  const gearData = JSON.parse(fs.readFileSync(GEAR_FILE, 'utf8'));
  const players = gearData.players.filter(p => p.gear && p.gear.length > 0 && p.class && p.spec);

  console.log(`📋 Loaded ${players.length} players with gear data\n`);

  // ─── Group by class + spec ───────────────────────────────────────────

  const specGroups = {};
  players.forEach(player => {
    const key = `${player.class}|${player.spec}`;
    if (!specGroups[key]) specGroups[key] = [];
    specGroups[key].push(player);
  });

  console.log('Specs found:');
  Object.entries(specGroups)
    .sort((a, b) => b[1].length - a[1].length)
    .forEach(([key, group]) => {
      const [cls, spec] = key.split('|');
      console.log(`   ${spec} ${cls}: ${group.length} players`);
    });
  console.log('');

  // ─── Analyze each spec ──────────────────────────────────────────────

  const bisData = {};

  for (const [specKey, specPlayers] of Object.entries(specGroups)) {
    const [className, specName] = specKey.split('|');

    if (specPlayers.length < minPlayers) {
      console.log(`⏭️  Skipping ${specName} ${className} (only ${specPlayers.length} players, need ${minPlayers})`);
      continue;
    }

    console.log(`\n═══════════════════════════════════════════`);
    console.log(`⚔️  ${specName} ${className} (${specPlayers.length} players)`);
    console.log(`═══════════════════════════════════════════`);

    const totalPlayers = specPlayers.length;
    const avgRating = Math.round(specPlayers.reduce((a, p) => a + p.rating, 0) / totalPlayers);
    const minRating = Math.min(...specPlayers.map(p => p.rating));
    const maxRating = Math.max(...specPlayers.map(p => p.rating));

    console.log(`   Rating range: ${minRating} — ${maxRating} (avg: ${avgRating})`);

    // Group items by normalized slot
    const slotItems = {};

    specPlayers.forEach(player => {
      player.gear.forEach(item => {
        const slot = normalizeSlot(item.slot);
        if (!slotItems[slot]) slotItems[slot] = {};
        
        const itemKey = item.id;
        if (!slotItems[slot][itemKey]) {
          slotItems[slot][itemKey] = {
            id: item.id,
            name: item.name,
            slot,
            quality: item.quality || 'Unknown',
            isPvP: isPvPItem(item),
            users: [],
            gems: {},     // Track gem popularity
            enchants: {}  // Track enchant popularity
          };
        }

        slotItems[slot][itemKey].users.push({
          name: player.name,
          rating: player.rating,
          region: player.region
        });

        // Track gems
        if (item.gems) {
          item.gems.forEach(gem => {
            if (gem && gem.id) {
              const gemKey = gem.id;
              if (!slotItems[slot][itemKey].gems[gemKey]) {
                slotItems[slot][itemKey].gems[gemKey] = { id: gem.id, name: gem.name, count: 0 };
              }
              slotItems[slot][itemKey].gems[gemKey].count++;
            }
          });
        }

        // Track enchants
        if (item.enchantId) {
          const enchKey = item.enchantId;
          if (!slotItems[slot][itemKey].enchants[enchKey]) {
            slotItems[slot][itemKey].enchants[enchKey] = { id: item.enchantId, name: item.enchantName, count: 0 };
          }
          slotItems[slot][itemKey].enchants[enchKey].count++;
        }
      });
    });

    // Build BiS list per slot
    const specBiS = {
      class: className,
      spec: specName,
      playerCount: totalPlayers,
      ratingRange: { min: minRating, max: maxRating, avg: avgRating },
      slots: {}
    };

    // Ordered slot list
    const SLOT_ORDER = [
      'Head', 'Neck', 'Shoulders', 'Back', 'Chest', 'Wrist',
      'Hands', 'Waist', 'Legs', 'Feet', 'Ring', 'Trinket',
      'Main Hand', 'Off Hand', 'Two-Hand', 'Ranged'
    ];

    for (const slot of SLOT_ORDER) {
      if (!slotItems[slot]) continue;

      const items = Object.values(slotItems[slot])
        .map(item => {
          const popularity = Math.round((item.users.length / totalPlayers) * 100);
          const ratingInfo = detectRatingGate(item.users, specPlayers);
          
          // Top gems for this item
          const topGems = Object.values(item.gems)
            .sort((a, b) => b.count - a.count)
            .slice(0, 3)
            .map(g => ({ id: g.id, name: g.name, usage: Math.round((g.count / item.users.length) * 100) }));

          // Top enchant for this item
          const topEnchants = Object.values(item.enchants)
            .sort((a, b) => b.count - a.count)
            .slice(0, 2)
            .map(e => ({ id: e.id, name: e.name, usage: Math.round((e.count / item.users.length) * 100) }));

          return {
            id: item.id,
            name: item.name,
            slot,
            quality: item.quality,
            popularity,
            tier: getTier(popularity),
            isPvP: item.isPvP,
            isPvEFlex: !item.isPvP && popularity >= outlierThreshold,
            ratingGate: ratingInfo.ratingGate,
            avgUserRating: ratingInfo.avgRating,
            userCount: item.users.length,
            topGems,
            topEnchants
          };
        })
        .filter(item => item.popularity >= outlierThreshold) // Remove outliers
        .sort((a, b) => b.popularity - a.popularity);

      if (items.length > 0) {
        specBiS.slots[slot] = items;

        // Print
        console.log(`\n   📦 ${slot}:`);
        items.forEach(item => {
          const emoji = TIER_EMOJI[item.tier];
          const pveMark = item.isPvEFlex ? ' ⚔️PvE' : '';
          const rateMark = item.ratingGate ? ` 🔒${item.ratingGate}+` : '';
          console.log(`      ${emoji} ${item.popularity}% — [${item.id}] ${item.name} (${item.quality})${pveMark}${rateMark}`);
          
          if (item.topGems.length > 0) {
            const gemStr = item.topGems.map(g => `${g.name} (${g.usage}%)`).join(', ');
            console.log(`         💎 Gems: ${gemStr}`);
          }
          if (item.topEnchants.length > 0) {
            const enchStr = item.topEnchants.map(e => `${e.name} (${e.usage}%)`).join(', ');
            console.log(`         ✨ Enchant: ${enchStr}`);
          }
        });
      }
    }

    // ─── PvE Flex Slot Analysis ────────────────────────────────────────

    const flexSlots = {};
    for (const [slot, items] of Object.entries(specBiS.slots)) {
      const pveItems = items.filter(i => i.isPvEFlex);
      if (pveItems.length > 0) {
        flexSlots[slot] = pveItems.map(i => `${i.name} (${i.popularity}%)`);
      }
    }

    if (Object.keys(flexSlots).length > 0) {
      console.log(`\n   🔄 PvE Flex Slots detected:`);
      for (const [slot, items] of Object.entries(flexSlots)) {
        console.log(`      ${slot}: ${items.join(', ')}`);
      }
    }

    specBiS.flexSlots = flexSlots;
    bisData[specKey] = specBiS;
  }

  // ─── Save output ────────────────────────────────────────────────────

  const output = {
    meta: {
      season: 1,
      analyzedAt: new Date().toISOString(),
      totalPlayers: players.length,
      specsAnalyzed: Object.keys(bisData).length,
      outlierThreshold,
      minPlayersPerSpec: minPlayers
    },
    specs: bisData
  };

  fs.writeFileSync(ANALYSIS_FILE, JSON.stringify(output, null, 2));

  // ─── Final Summary ──────────────────────────────────────────────────

  console.log('\n\n═══════════════════════════════════════════');
  console.log('📋 ANALYSIS COMPLETE');
  console.log('═══════════════════════════════════════════');
  console.log(`   Specs analyzed: ${Object.keys(bisData).length}`);
  console.log(`   Total players: ${players.length}`);
  console.log(`   💾 Saved to: ${ANALYSIS_FILE}`);
  console.log(`   📦 File size: ${(fs.statSync(ANALYSIS_FILE).size / 1024).toFixed(1)} KB`);

  // Global most popular items
  console.log('\n🏆 Global most popular PvP items (all specs):');
  const globalItems = {};
  players.forEach(player => {
    player.gear.forEach(item => {
      if (!globalItems[item.id]) {
        globalItems[item.id] = { id: item.id, name: item.name, count: 0, specs: new Set() };
      }
      globalItems[item.id].count++;
      globalItems[item.id].specs.add(`${player.spec} ${player.class}`);
    });
  });

  Object.values(globalItems)
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)
    .forEach(item => {
      const pct = ((item.count / players.length) * 100).toFixed(1);
      const specCount = item.specs.size;
      console.log(`   ${pct}% — [${item.id}] ${item.name} (${specCount} specs)`);
    });

  console.log('\n✅ Done!');
})();
