#!/usr/bin/env node
/**
 * fix-hunter-weapons.js
 *
 * Fixes Hunter weapon slot data in data.json by properly interpreting
 * scraped Wowhead/IcyVeins data:
 *
 *  1. "Weapon" slot with items listed 2x or with MH/OH/x2 in rank
 *     → split into Main Hand + Off Hand
 *  2. "Main Hand" slot with "OH" in rank → copy item to Off Hand too
 *  3. "Main Hand" slot with "MH/OH" in rank → put in both slots
 *  4. Phase 0 (pre-bis, Lua only) — fix green items ranked as BIS
 *     by demoting to Alt (unless it's genuinely the only option)
 *  5. For phases with NO scrape data, use Lua data but fix OH from
 *     "One-Hand" items that only ended up in MH
 *
 * Run: node fix-hunter-weapons.js
 * Then: node sync-data.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const DATA_PATH    = path.join(__dirname, 'data.json');
const SCRAPED_PATH = path.join(__dirname, 'scraper', 'output', 'wowhead-bis-raw.json');

// Load item quality
const qualityFile = fs.readFileSync(path.join(__dirname, 'js', 'item-quality.js'), 'utf8');
const qualityMap  = JSON.parse(qualityFile.match(/\{.*\}/)[0]);

const data    = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
const scraped = JSON.parse(fs.readFileSync(SCRAPED_PATH, 'utf8'));

// Backup
const backupPath = DATA_PATH.replace('.json', `.backup-${Date.now()}.json`);
fs.copyFileSync(DATA_PATH, backupPath);
console.log(`📦 Backup: ${path.basename(backupPath)}\n`);

const HUNTER_SPECS = ['Beast Mastery', 'Marksmanship', 'Survival'];
const SPEC_KEY_MAP = {
  'Beast Mastery': 'Beast_Mastery',
  'Marksmanship':  'Marksmanship',
  'Survival':      'Survival',
};

let totalChanges = 0;

// ── Normalize rank from Wowhead to our BIS/Alt system ───────────────────
function normalizeRank(rank) {
  const r = rank.toLowerCase();
  if (r.includes('bis') || r.includes('best') || r === 'great mh' || r === 'great oh') return 'BIS';
  return 'Alt';
}

// ── Parse weapon data from a scraped entry ──────────────────────────────
// Returns { mainHand: [...], offHand: [...], twoHand: [...] }
function parseScrapedWeapons(scrapeEntry) {
  if (!scrapeEntry || !scrapeEntry.slots) return null;

  const mainHand = [];
  const offHand  = [];
  const twoHand  = [];
  const seenMH   = new Set();
  const seenOH   = new Set();
  const seen2H   = new Set();

  for (const slotData of scrapeEntry.slots) {
    const slotName  = slotData.slot;
    const slotLower = slotName.toLowerCase();

    // Skip non-weapon slots
    if (!slotLower.includes('hand') && !slotLower.includes('weapon') && !slotLower.includes('two')) continue;

    // Two-Hand / Two Hand
    if (slotLower.includes('two')) {
      for (const item of slotData.items) {
        if (!seen2H.has(item.itemId)) {
          seen2H.add(item.itemId);
          twoHand.push({ itemId: String(item.itemId), name: item.itemName, rank: normalizeRank(item.rank), rawRank: item.rank });
        }
      }
      continue;
    }

    // "Weapon" slot — needs to be split
    if (slotLower === 'weapon') {
      for (const item of slotData.items) {
        const rankLower = item.rank.toLowerCase();
        const rank = normalizeRank(item.rank);

        if (rankLower.includes('x2') || rankLower.includes('×2')) {
          // Same item in both MH and OH
          if (!seenMH.has(item.itemId)) {
            seenMH.add(item.itemId);
            mainHand.push({ itemId: String(item.itemId), name: item.itemName, rank, rawRank: item.rank });
          }
          if (!seenOH.has(item.itemId)) {
            seenOH.add(item.itemId);
            offHand.push({ itemId: String(item.itemId), name: item.itemName, rank, rawRank: item.rank });
          }
        } else if (rankLower.includes('oh') && !rankLower.includes('mh')) {
          if (!seenOH.has(item.itemId)) {
            seenOH.add(item.itemId);
            offHand.push({ itemId: String(item.itemId), name: item.itemName, rank, rawRank: item.rank });
          }
        } else if (rankLower.includes('mh') && !rankLower.includes('oh')) {
          if (!seenMH.has(item.itemId)) {
            seenMH.add(item.itemId);
            mainHand.push({ itemId: String(item.itemId), name: item.itemName, rank, rawRank: item.rank });
          }
        } else {
          // No MH/OH indicator — could be listed twice (Icy Veins pattern: same item 2x = MH+OH)
          // Check if same itemId appears multiple times
          const count = slotData.items.filter(i => i.itemId === item.itemId).length;
          if (count >= 2) {
            if (!seenMH.has(item.itemId)) {
              seenMH.add(item.itemId);
              mainHand.push({ itemId: String(item.itemId), name: item.itemName, rank, rawRank: item.rank });
            }
            if (!seenOH.has(item.itemId)) {
              seenOH.add(item.itemId);
              offHand.push({ itemId: String(item.itemId), name: item.itemName, rank, rawRank: item.rank });
            }
          } else {
            // Single item in "Weapon" without MH/OH — assume both
            if (!seenMH.has(item.itemId)) {
              seenMH.add(item.itemId);
              mainHand.push({ itemId: String(item.itemId), name: item.itemName, rank, rawRank: item.rank });
            }
            if (!seenOH.has(item.itemId)) {
              seenOH.add(item.itemId);
              offHand.push({ itemId: String(item.itemId), name: item.itemName, rank, rawRank: item.rank });
            }
          }
        }
      }
      continue;
    }

    // "Main Hand" slot — may contain OH items via rank
    if (slotLower === 'main hand') {
      for (const item of slotData.items) {
        const rankLower = item.rank.toLowerCase();
        const rank = normalizeRank(item.rank);

        const isMH = rankLower.includes('mh') || (!rankLower.includes('oh'));
        const isOH = rankLower.includes('oh');

        if (isMH && !seenMH.has(item.itemId)) {
          seenMH.add(item.itemId);
          mainHand.push({ itemId: String(item.itemId), name: item.itemName, rank, rawRank: item.rank });
        }
        if (isOH && !seenOH.has(item.itemId)) {
          seenOH.add(item.itemId);
          offHand.push({ itemId: String(item.itemId), name: item.itemName, rank, rawRank: item.rank });
        }
      }
      continue;
    }

    // "Off Hand" slot
    if (slotLower === 'off hand') {
      for (const item of slotData.items) {
        if (!seenOH.has(item.itemId)) {
          seenOH.add(item.itemId);
          offHand.push({ itemId: String(item.itemId), name: item.itemName, rank: normalizeRank(item.rank), rawRank: item.rank });
        }
      }
      continue;
    }
  }

  return { mainHand, offHand, twoHand };
}

// ── Apply fix for one spec+phase ────────────────────────────────────────
function fixPhaseWeapons(spec, phase, phaseData) {
  const scrapeKey   = `p${phase}-Hunter-${SPEC_KEY_MAP[spec]}`;
  const scrapeEntry = scraped[scrapeKey];
  const changes     = [];

  const parsed = parseScrapedWeapons(scrapeEntry);

  // Get current weapon items
  const currentMH = phaseData.items.filter(i => i.slot === 'Main Hand');
  const currentOH = phaseData.items.filter(i => i.slot === 'Off Hand');
  const current2H = phaseData.items.filter(i => i.slot === 'Two Hand');
  const nonWeaponItems = phaseData.items.filter(i => !['Main Hand', 'Off Hand', 'Two Hand'].includes(i.slot));

  if (!parsed) {
    // No scraped data — Lua only. Fix green BIS items.
    let newMH = [...currentMH];
    let newOH = [...currentOH];

    // Demote green items from BIS to Alt if there are non-green items
    for (const slot of [{ items: newMH, name: 'Main Hand' }, { items: newOH, name: 'Off Hand' }]) {
      const hasNonGreenBIS = slot.items.some(i => {
        const q = qualityMap[i.itemId];
        return (q === undefined || q >= 3) && i.rank === 'BIS';
      });
      if (hasNonGreenBIS) {
        for (const item of slot.items) {
          const q = qualityMap[item.itemId];
          if (q !== undefined && q <= 2 && item.rank === 'BIS') {
            changes.push(`  Demoted green BIS → Alt: ${item.name} (${item.itemId}) in ${slot.name}`);
            item.rank = 'Alt';
          }
        }
      }
    }

    phaseData.items = [...nonWeaponItems, ...newMH, ...newOH, ...current2H];
    return changes;
  }

  // We have scraped data — rebuild weapon slots
  const newMH = [];
  const newOH = [];
  const new2H = [];
  const seenMH = new Set();
  const seenOH = new Set();
  const seen2H = new Set();

  // 1. Add scraped items first (with their scraped rank)
  for (const item of parsed.mainHand) {
    seenMH.add(item.itemId);
    newMH.push({ itemId: item.itemId, slot: 'Main Hand', rank: item.rank, name: item.name });
  }
  for (const item of parsed.offHand) {
    seenOH.add(item.itemId);
    newOH.push({ itemId: item.itemId, slot: 'Off Hand', rank: item.rank, name: item.name });
  }
  for (const item of parsed.twoHand) {
    seen2H.add(item.itemId);
    new2H.push({ itemId: item.itemId, slot: 'Two Hand', rank: item.rank, name: item.name });
  }

  // 2. Add Lua items not in scraped data as Alt
  for (const item of currentMH) {
    if (!seenMH.has(item.itemId)) {
      seenMH.add(item.itemId);
      newMH.push({ ...item, rank: 'Alt' });
    }
  }
  for (const item of currentOH) {
    if (!seenOH.has(item.itemId)) {
      seenOH.add(item.itemId);
      newOH.push({ ...item, rank: 'Alt' });
    }
  }
  for (const item of current2H) {
    if (!seen2H.has(item.itemId)) {
      seen2H.add(item.itemId);
      new2H.push({ ...item, rank: 'Alt' });
    }
  }

  // Log changes
  const oldOHCount = currentOH.length;
  const newOHCount = newOH.length;
  if (newOHCount > oldOHCount) {
    changes.push(`  Added ${newOHCount - oldOHCount} Off Hand items (was ${oldOHCount}, now ${newOHCount})`);
    for (const item of newOH) {
      if (!currentOH.some(i => i.itemId === item.itemId)) {
        changes.push(`    + OH: ${item.name} (${item.itemId}) rank=${item.rank}`);
      }
    }
  }

  // Check for rank changes
  for (const item of newMH) {
    const old = currentMH.find(i => i.itemId === item.itemId);
    if (old && old.rank !== item.rank) {
      changes.push(`  MH rank change: ${item.name} (${item.itemId}) ${old.rank} → ${item.rank}`);
    }
  }

  phaseData.items = [...nonWeaponItems, ...newMH, ...newOH, ...new2H];
  return changes;
}

// ── Main ────────────────────────────────────────────────────────────────
console.log('🔧 Fixing Hunter weapon slots...\n');

for (const specName of HUNTER_SPECS) {
  const spec = data.specs.find(s => s.className === 'Hunter' && s.specName === specName);
  if (!spec) continue;

  console.log(`\n═══ Hunter ${specName} ═══`);

  for (const phase of Object.keys(spec.phases).sort()) {
    const phaseData = spec.phases[phase];
    const changes = fixPhaseWeapons(specName, phase, phaseData);

    if (changes.length) {
      console.log(`  Phase ${phase}: ${changes.length} change(s)`);
      changes.forEach(c => console.log(`  ${c}`));
      totalChanges += changes.length;
    } else {
      const mh = phaseData.items.filter(i => i.slot === 'Main Hand').length;
      const oh = phaseData.items.filter(i => i.slot === 'Off Hand').length;
      const th = phaseData.items.filter(i => i.slot === 'Two Hand').length;
      console.log(`  Phase ${phase}: OK (MH=${mh} OH=${oh} 2H=${th})`);
    }
  }
}

// Save
data.generatedAt = new Date().toISOString();
fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));

console.log(`\n${'─'.repeat(50)}`);
console.log(`✅ Done! ${totalChanges} total changes applied.`);
console.log(`📄 Saved: data.json`);
console.log(`\n👉 Next: node sync-data.js && node audit-hunter-weapons.js`);
