#!/usr/bin/env node
/**
 * fix-hunter-weapons-v2.js
 *
 * Properly rebuilds Hunter weapon slots from scraped data + Lua fallback.
 *
 * Rules:
 *   1. Scraped "Main Hand" items → only MH (unless rank contains "OH")
 *   2. Scraped "Off Hand" items → only OH
 *   3. Scraped "Weapon" with "x2" → both MH and OH
 *   4. Scraped "Weapon" with "MH"/"OH" → split accordingly
 *   5. Icy Veins "Main Hand" list = all one-handers. They go to MH.
 *      The same items should ALSO go to OH as alternatives.
 *   6. Items that appear ONLY in scraped "Off Hand" should NOT be in MH.
 *   7. Lua-only phases: one-hand items in MH should be duplicated to OH.
 *   8. For P3 (Icy Veins): "Weapon" with same item 2x = MH+OH BIS.
 *      "Main Hand" list = additional MH+OH alternatives.
 *
 * Run: node fix-hunter-weapons-v2.js
 * Then: node sync-data.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const DATA_PATH    = path.join(__dirname, 'data.json');
const SCRAPED_PATH = path.join(__dirname, 'scraper', 'output', 'wowhead-bis-raw.json');

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

function normalizeRank(rank) {
  const r = rank.toLowerCase();
  if (r.includes('bis') || r.includes('best') || r.startsWith('great')) return 'BIS';
  return 'Alt';
}

function makeItem(itemId, slot, rank, name) {
  return { itemId: String(itemId), slot, rank, name };
}

/**
 * Parse scraped data into clean MH, OH, 2H lists.
 * Returns null if no scraped data.
 */
function parseScraped(scrapeKey) {
  const entry = scraped[scrapeKey];
  if (!entry || !entry.slots) return null;

  const mhItems = [];  // { itemId, rank, name }
  const ohItems = [];
  const thItems = [];
  const seenMH = new Set();
  const seenOH = new Set();
  const seen2H = new Set();

  function addMH(itemId, rank, name) {
    if (!seenMH.has(String(itemId))) { seenMH.add(String(itemId)); mhItems.push({ itemId: String(itemId), rank, name }); }
  }
  function addOH(itemId, rank, name) {
    if (!seenOH.has(String(itemId))) { seenOH.add(String(itemId)); ohItems.push({ itemId: String(itemId), rank, name }); }
  }
  function add2H(itemId, rank, name) {
    if (!seen2H.has(String(itemId))) { seen2H.add(String(itemId)); thItems.push({ itemId: String(itemId), rank, name }); }
  }

  // Track which items are EXCLUSIVELY OH (in scraped "Off Hand" but NOT "Main Hand")
  const exclusiveOH = new Set();
  const inScrapedMH = new Set();

  for (const slotData of entry.slots) {
    const sl = slotData.slot.toLowerCase();
    if (!sl.includes('hand') && !sl.includes('weapon') && !sl.includes('two')) continue;

    if (sl === 'main hand') {
      for (const item of slotData.items) {
        inScrapedMH.add(String(item.itemId));
      }
    }
  }

  for (const slotData of entry.slots) {
    const sl = slotData.slot.toLowerCase();
    if (!sl.includes('hand') && !sl.includes('weapon') && !sl.includes('two')) continue;

    // Two-Hand / Two Hand
    if (sl.includes('two')) {
      for (const item of slotData.items) {
        add2H(item.itemId, normalizeRank(item.rank), item.itemName);
      }
      continue;
    }

    // "Weapon" slot
    if (sl === 'weapon') {
      for (const item of slotData.items) {
        const rl = item.rank.toLowerCase();
        const rank = normalizeRank(item.rank);

        if (rl.includes('x2') || rl.includes('×2')) {
          addMH(item.itemId, rank, item.itemName);
          addOH(item.itemId, rank, item.itemName);
        } else if (rl.includes('oh') && !rl.includes('mh')) {
          addOH(item.itemId, rank, item.itemName);
        } else if (rl.includes('mh') && !rl.includes('oh')) {
          addMH(item.itemId, rank, item.itemName);
        } else {
          // No indicator - check if same item appears 2x (Icy Veins pattern)
          const count = slotData.items.filter(i => String(i.itemId) === String(item.itemId)).length;
          if (count >= 2) {
            addMH(item.itemId, rank, item.itemName);
            addOH(item.itemId, rank, item.itemName);
          } else {
            // Single item without indicator → both slots
            addMH(item.itemId, rank, item.itemName);
            addOH(item.itemId, rank, item.itemName);
          }
        }
      }
      continue;
    }

    // "Main Hand" slot
    if (sl === 'main hand') {
      for (const item of slotData.items) {
        const rl = item.rank.toLowerCase();
        const rank = normalizeRank(item.rank);

        if (rl.includes('oh') && !rl.includes('mh')) {
          // Explicitly OH only
          addOH(item.itemId, rank, item.itemName);
        } else if (rl.includes('mh') && rl.includes('oh')) {
          // Explicitly both
          addMH(item.itemId, rank, item.itemName);
          addOH(item.itemId, rank, item.itemName);
        } else if (rl.includes('mh')) {
          // Explicitly MH only
          addMH(item.itemId, rank, item.itemName);
        } else {
          // No MH/OH indicator in rank.
          // For Icy Veins P3: "Main Hand" list = all one-handers for both MH and OH
          // For Wowhead P1: "Main Hand" is specifically MH only (there's a separate "Off Hand")
          // Detect: if there's also a separate "Off Hand" slot, this is MH-only
          const hasOffHandSlot = entry.slots.some(s => s.slot.toLowerCase() === 'off hand');
          addMH(item.itemId, rank, item.itemName);
          if (!hasOffHandSlot) {
            // No separate OH slot → these one-handers can go in OH too
            addOH(item.itemId, rank, item.itemName);
          }
        }
      }
      continue;
    }

    // "Off Hand" slot
    if (sl === 'off hand') {
      for (const item of slotData.items) {
        addOH(item.itemId, normalizeRank(item.rank), item.itemName);
        if (!inScrapedMH.has(String(item.itemId))) {
          exclusiveOH.add(String(item.itemId));
        }
      }
      continue;
    }
  }

  return { mhItems, ohItems, thItems, exclusiveOH, source: entry.url };
}

function fixSpec(specName) {
  const spec = data.specs.find(s => s.className === 'Hunter' && s.specName === specName);
  if (!spec) return;

  console.log(`\n═══ Hunter ${specName} ═══`);

  for (const phase of Object.keys(spec.phases).sort()) {
    const phaseData = spec.phases[phase];
    const scrapeKey = `p${phase}-Hunter-${SPEC_KEY_MAP[specName]}`;
    const parsed = parseScraped(scrapeKey);

    const currentMH = phaseData.items.filter(i => i.slot === 'Main Hand');
    const currentOH = phaseData.items.filter(i => i.slot === 'Off Hand');
    const current2H = phaseData.items.filter(i => i.slot === 'Two Hand');
    const nonWeapon = phaseData.items.filter(i => !['Main Hand', 'Off Hand', 'Two Hand'].includes(i.slot));

    const changes = [];

    if (parsed) {
      // ═══ SCRAPED DATA AVAILABLE ═══
      const newMH = [];
      const newOH = [];
      const new2H = [];
      const seenMH = new Set();
      const seenOH = new Set();
      const seen2H = new Set();

      // 1. Scraped MH items (but NOT items exclusive to OH)
      for (const item of parsed.mhItems) {
        if (parsed.exclusiveOH.has(item.itemId)) continue; // Don't put OH-only items in MH
        seenMH.add(item.itemId);
        newMH.push(makeItem(item.itemId, 'Main Hand', item.rank, item.name));
      }

      // 2. Scraped OH items
      for (const item of parsed.ohItems) {
        seenOH.add(item.itemId);
        newOH.push(makeItem(item.itemId, 'Off Hand', item.rank, item.name));
      }

      // 3. Scraped 2H items
      for (const item of parsed.thItems) {
        seen2H.add(item.itemId);
        new2H.push(makeItem(item.itemId, 'Two Hand', item.rank, item.name));
      }

      // 4. Lua MH items not in scraped → add as Alt MH (skip OH-exclusive items)
      for (const item of currentMH) {
        if (seenMH.has(item.itemId)) continue;
        if (parsed.exclusiveOH.has(item.itemId)) continue;
        seenMH.add(item.itemId);
        newMH.push(makeItem(item.itemId, 'Main Hand', 'Alt', item.name));
        // Also add to OH if not there yet (it's a one-hander)
        if (!seenOH.has(item.itemId)) {
          seenOH.add(item.itemId);
          newOH.push(makeItem(item.itemId, 'Off Hand', 'Alt', item.name));
        }
      }

      // 5. Lua OH items not in scraped → add as Alt OH
      for (const item of currentOH) {
        if (seenOH.has(item.itemId)) continue;
        seenOH.add(item.itemId);
        newOH.push(makeItem(item.itemId, 'Off Hand', 'Alt', item.name));
      }

      // 6. Lua 2H items not in scraped → add as Alt
      for (const item of current2H) {
        if (seen2H.has(item.itemId)) continue;
        seen2H.add(item.itemId);
        new2H.push(makeItem(item.itemId, 'Two Hand', 'Alt', item.name));
      }

      // Report changes
      const removedFromMH = currentMH.filter(i => !newMH.some(n => n.itemId === i.itemId));
      const addedToOH = newOH.filter(n => !currentOH.some(i => i.itemId === n.itemId));

      for (const r of removedFromMH) {
        changes.push(`  ✂️  Removed from MH: ${r.name} (${r.itemId})`);
      }
      for (const a of addedToOH) {
        changes.push(`  ➕ Added to OH: ${a.name} (${a.itemId}) rank=${a.rank}`);
      }

      phaseData.items = [...nonWeapon, ...newMH, ...newOH, ...new2H];

    } else {
      // ═══ LUA ONLY — no scraped data ═══
      // Duplicate one-hand MH items to OH (if not already there)
      const newOH = [...currentOH];
      const seenOH = new Set(currentOH.map(i => i.itemId));

      for (const item of currentMH) {
        if (seenOH.has(item.itemId)) continue;
        // Don't duplicate 2H-only items; all MH items for hunters are one-handers
        seenOH.add(item.itemId);
        newOH.push(makeItem(item.itemId, 'Off Hand', item.rank, item.name));
        changes.push(`  ➕ Duplicated to OH: ${item.name} (${item.itemId}) rank=${item.rank}`);
      }

      phaseData.items = [...nonWeapon, ...currentMH, ...newOH, ...current2H];
    }

    const mhCount = phaseData.items.filter(i => i.slot === 'Main Hand').length;
    const ohCount = phaseData.items.filter(i => i.slot === 'Off Hand').length;
    const thCount = phaseData.items.filter(i => i.slot === 'Two Hand').length;

    if (changes.length) {
      console.log(`  Phase ${phase}: ${changes.length} changes (MH=${mhCount} OH=${ohCount} 2H=${thCount})`);
      changes.forEach(c => console.log(c));
      totalChanges += changes.length;
    } else {
      console.log(`  Phase ${phase}: OK (MH=${mhCount} OH=${ohCount} 2H=${thCount})`);
    }
  }
}

console.log('🔧 Fixing Hunter weapon slots (v2)...\n');

for (const specName of HUNTER_SPECS) {
  fixSpec(specName);
}

data.generatedAt = new Date().toISOString();
fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));

console.log(`\n${'─'.repeat(50)}`);
console.log(`✅ Done! ${totalChanges} total changes.`);
console.log(`📄 Saved: data.json`);
console.log(`\n👉 Next: node sync-data.js`);
