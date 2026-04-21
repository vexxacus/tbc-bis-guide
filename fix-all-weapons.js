#!/usr/bin/env node
/**
 * fix-all-weapons.js
 *
 * Fixes weapon slot data for ALL specs in data.json by properly interpreting
 * scraped Wowhead/IcyVeins data + Lua fallback.
 *
 * Handles:
 *  - "Weapon" slot with MH/OH/x2/All/Pair in rank → split to MH + OH
 *  - "Main Hand" without separate "Off Hand" → duplicate one-handers to OH
 *  - Items exclusive to "Off Hand" removed from MH
 *  - Lua-only phases: one-hand MH items duplicated to OH for dual-wield specs
 *
 * Dual-wield specs: Rogue, Enhancement Shaman, Fury Warrior, all Hunters
 * Caster/healer MH+OH: Mages, Warlocks, Priests, Elemental/Resto Shaman,
 *   Holy Paladin, Balance/Resto Druid (these use MH + Off Hand/Shield)
 *
 * Run: node fix-all-weapons.js
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

// ── Spec key mapping ────────────────────────────────────────────────────
const SPEC_KEY_MAP = {
  'Druid Balance':        'Druid-Balance',
  'Druid Bear':           'Druid-Feral_Tank',
  'Druid Cat':            'Druid-Feral_DPS',
  'Druid Restoration':    'Druid-Restoration',
  'Hunter Beast Mastery': 'Hunter-Beast_Mastery',
  'Hunter Marksmanship':  'Hunter-Marksmanship',
  'Hunter Survival':      'Hunter-Survival',
  'Mage Arcane':          'Mage-Arcane',
  'Mage Fire':            'Mage-Fire',
  'Mage Frost':           'Mage-Frost',
  'Paladin Holy':         'Paladin-Holy',
  'Paladin Protection':   'Paladin-Protection',
  'Paladin Retribution':  'Paladin-Retribution',
  'Priest Holy':          'Priest-Holy/Disc',
  'Priest Shadow':        'Priest-Shadow',
  'Rogue Dps':            'Rogue-Rogue',
  'Shaman Elemental':     'Shaman-Elemental',
  'Shaman Enhancement':   'Shaman-Enhancement',
  'Shaman Restoration':   'Shaman-Restoration',
  'Warlock Affliction':   'Warlock-Affliction',
  'Warlock Demonology':   'Warlock-Demonology',
  'Warlock Destruction':  'Warlock-Destruction',
  'Warrior Arms':         'Warrior-Arms',
  'Warrior Fury':         'Warrior-Fury',
  'Warrior Protection':   'Warrior-Protection',
};

// Specs that dual-wield (one-hand items can go in both MH and OH)
const DUAL_WIELD_SPECS = new Set([
  'Hunter Beast Mastery', 'Hunter Marksmanship', 'Hunter Survival',
  'Rogue Dps',
  'Shaman Enhancement',
  'Warrior Fury',
]);

// Specs that use MH + OH (caster off-hand/shield) but NOT one-handers in both slots
// For these, we only duplicate to OH if Wowhead explicitly says so
const MH_OH_SPECS = new Set([
  'Mage Arcane', 'Mage Fire', 'Mage Frost',
  'Warlock Affliction', 'Warlock Demonology', 'Warlock Destruction',
  'Priest Holy', 'Priest Shadow',
  'Shaman Elemental', 'Shaman Restoration',
  'Paladin Holy', 'Paladin Protection',
  'Druid Balance', 'Druid Restoration',
  'Warrior Arms', 'Warrior Protection',
]);

let totalChanges = 0;

function normalizeRank(rank) {
  const r = rank.toLowerCase();
  if (r.includes('bis') || r.includes('best') || r.startsWith('great') || r.startsWith('good')) return 'BIS';
  return 'Alt';
}

function makeItem(itemId, slot, rank, name) {
  return { itemId: String(itemId), slot, rank, name };
}

/**
 * Determine if a "Weapon" slot item with no MH/OH indicator should go to both slots.
 * Check for hints: "x2", "All", "Pair", same item listed twice, speed hints like "2.6"
 */
function parseWeaponRankHints(rank, itemId, allItems) {
  const rl = rank.toLowerCase();

  // Explicit MH/OH
  if (rl.includes('x2') || rl.includes('×2') || rl.includes('all') || rl.includes('pair')) return 'both';
  if (rl.includes('oh') && !rl.includes('mh')) return 'oh';
  if (rl.includes('mh') && !rl.includes('oh')) return 'mh';
  if (rl.includes('mh') && rl.includes('oh')) return 'both';

  // "Dagger" hint for rogues (often OH-specific) - but could be both
  // We'll default to "both" for daggers since rogues can use them in both slots

  // Same item appearing twice in list = both slots
  const count = allItems.filter(i => String(i.itemId) === String(itemId)).length;
  if (count >= 2) return 'both';

  // Default: assume both slots (most weapon items for DW specs can go either way)
  return 'both';
}

/**
 * Parse scraped weapon data for one entry.
 */
function parseScraped(scrapeKey) {
  const entry = scraped[scrapeKey];
  if (!entry || !entry.slots) return null;

  const mhItems = [];
  const ohItems = [];
  const thItems = [];
  const seenMH = new Set();
  const seenOH = new Set();
  const seen2H = new Set();

  function addMH(id, rank, name) { id = String(id); if (!seenMH.has(id)) { seenMH.add(id); mhItems.push({ itemId: id, rank, name }); } }
  function addOH(id, rank, name) { id = String(id); if (!seenOH.has(id)) { seenOH.add(id); ohItems.push({ itemId: id, rank, name }); } }
  function add2H(id, rank, name) { id = String(id); if (!seen2H.has(id)) { seen2H.add(id); thItems.push({ itemId: id, rank, name }); } }

  // First pass: collect which items are in scraped MH vs OH slots
  const inScrapedMH = new Set();
  const inScrapedOH = new Set();
  for (const slotData of entry.slots) {
    const sl = slotData.slot.toLowerCase();
    if (sl === 'main hand') slotData.items.forEach(i => inScrapedMH.add(String(i.itemId)));
    if (sl === 'off hand') slotData.items.forEach(i => inScrapedOH.add(String(i.itemId)));
  }
  const hasOffHandSlot = entry.slots.some(s => s.slot.toLowerCase() === 'off hand');

  // Items exclusively in OH (not in MH)
  const exclusiveOH = new Set();

  for (const slotData of entry.slots) {
    const sl = slotData.slot.toLowerCase();
    if (!sl.includes('hand') && !sl.includes('weapon') && !sl.includes('two')) continue;

    // Two-Hand
    if (sl.includes('two')) {
      for (const item of slotData.items) {
        add2H(item.itemId, normalizeRank(item.rank), item.itemName);
      }
      continue;
    }

    // "Weapon" slot
    if (sl === 'weapon') {
      for (const item of slotData.items) {
        const rank = normalizeRank(item.rank);
        const hint = parseWeaponRankHints(item.rank, item.itemId, slotData.items);

        if (hint === 'both') {
          addMH(item.itemId, rank, item.itemName);
          addOH(item.itemId, rank, item.itemName);
        } else if (hint === 'mh') {
          addMH(item.itemId, rank, item.itemName);
        } else if (hint === 'oh') {
          addOH(item.itemId, rank, item.itemName);
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
          addOH(item.itemId, rank, item.itemName);
        } else if (rl.includes('mh') && rl.includes('oh')) {
          addMH(item.itemId, rank, item.itemName);
          addOH(item.itemId, rank, item.itemName);
        } else if (rl.includes('mh')) {
          addMH(item.itemId, rank, item.itemName);
        } else {
          // No explicit indicator
          addMH(item.itemId, rank, item.itemName);
          // If no separate OH slot exists, these can also go to OH
          if (!hasOffHandSlot) {
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

/**
 * Fix weapons for one spec + phase.
 */
function fixPhase(specKey, specData, phase, phaseData) {
  const scrapeKey = `p${phase}-${SPEC_KEY_MAP[specKey]}`;
  const parsed = parseScraped(scrapeKey);

  const currentMH = phaseData.items.filter(i => i.slot === 'Main Hand');
  const currentOH = phaseData.items.filter(i => i.slot === 'Off Hand');
  const current2H = phaseData.items.filter(i => i.slot === 'Two Hand');
  const nonWeapon = phaseData.items.filter(i => !['Main Hand', 'Off Hand', 'Two Hand'].includes(i.slot));

  const isDW = DUAL_WIELD_SPECS.has(specKey);
  const changes = [];

  if (parsed) {
    // ═══ SCRAPED DATA AVAILABLE ═══
    const newMH = [], newOH = [], new2H = [];
    const seenMH = new Set(), seenOH = new Set(), seen2H = new Set();

    // 1. Scraped MH (skip OH-exclusive)
    for (const item of parsed.mhItems) {
      if (parsed.exclusiveOH.has(item.itemId)) continue;
      seenMH.add(item.itemId);
      newMH.push(makeItem(item.itemId, 'Main Hand', item.rank, item.name));
    }

    // 2. Scraped OH
    for (const item of parsed.ohItems) {
      seenOH.add(item.itemId);
      newOH.push(makeItem(item.itemId, 'Off Hand', item.rank, item.name));
    }

    // 3. Scraped 2H
    for (const item of parsed.thItems) {
      seen2H.add(item.itemId);
      new2H.push(makeItem(item.itemId, 'Two Hand', item.rank, item.name));
    }

    // 4. Lua MH items not in scraped
    for (const item of currentMH) {
      if (seenMH.has(item.itemId)) continue;
      if (parsed.exclusiveOH.has(item.itemId)) continue;
      seenMH.add(item.itemId);
      newMH.push(makeItem(item.itemId, 'Main Hand', 'Alt', item.name));
      // For DW specs: also add to OH
      if (isDW && !seenOH.has(item.itemId)) {
        seenOH.add(item.itemId);
        newOH.push(makeItem(item.itemId, 'Off Hand', 'Alt', item.name));
      }
    }

    // 5. Lua OH items not in scraped
    for (const item of currentOH) {
      if (seenOH.has(item.itemId)) continue;
      seenOH.add(item.itemId);
      newOH.push(makeItem(item.itemId, 'Off Hand', 'Alt', item.name));
    }

    // 6. Lua 2H items not in scraped
    for (const item of current2H) {
      if (seen2H.has(item.itemId)) continue;
      seen2H.add(item.itemId);
      new2H.push(makeItem(item.itemId, 'Two Hand', 'Alt', item.name));
    }

    // Report
    const removedMH = currentMH.filter(i => !newMH.some(n => n.itemId === i.itemId));
    const addedOH = newOH.filter(n => !currentOH.some(i => i.itemId === n.itemId));
    for (const r of removedMH) changes.push(`✂️  MH removed: ${r.name} (${r.itemId})`);
    for (const a of addedOH) changes.push(`➕ OH added: ${a.name} (${a.itemId}) rank=${a.rank}`);

    phaseData.items = [...nonWeapon, ...newMH, ...newOH, ...new2H];

  } else if (isDW) {
    // ═══ LUA ONLY + DUAL WIELD ═══
    // Duplicate MH one-handers to OH
    const newOH = [...currentOH];
    const seenOH = new Set(currentOH.map(i => i.itemId));

    for (const item of currentMH) {
      if (seenOH.has(item.itemId)) continue;
      seenOH.add(item.itemId);
      newOH.push(makeItem(item.itemId, 'Off Hand', item.rank, item.name));
      changes.push(`➕ OH duplicated: ${item.name} (${item.itemId}) rank=${item.rank}`);
    }

    phaseData.items = [...nonWeapon, ...currentMH, ...newOH, ...current2H];
  }
  // For non-DW Lua-only: leave as-is

  return changes;
}

// ── Main ────────────────────────────────────────────────────────────────
console.log('🔧 Fixing weapon slots for ALL specs...\n');

for (const spec of data.specs) {
  const specKey = `${spec.className} ${spec.specName}`;
  if (!SPEC_KEY_MAP[specKey]) continue;

  let specChanges = 0;

  for (const phase of Object.keys(spec.phases).sort()) {
    const changes = fixPhase(specKey, spec, phase, spec.phases[phase]);
    if (changes.length) {
      if (specChanges === 0) console.log(`\n═══ ${specKey} ═══`);
      const mh = spec.phases[phase].items.filter(i => i.slot === 'Main Hand').length;
      const oh = spec.phases[phase].items.filter(i => i.slot === 'Off Hand').length;
      const th = spec.phases[phase].items.filter(i => i.slot === 'Two Hand').length;
      console.log(`  P${phase}: ${changes.length} changes (MH=${mh} OH=${oh} 2H=${th})`);
      if (changes.length <= 10) {
        changes.forEach(c => console.log(`    ${c}`));
      } else {
        changes.slice(0, 5).forEach(c => console.log(`    ${c}`));
        console.log(`    ... and ${changes.length - 5} more`);
      }
      specChanges += changes.length;
      totalChanges += changes.length;
    }
  }

  if (specChanges === 0) {
    // Quick summary
    const allOK = Object.entries(spec.phases).every(([p, ph]) => {
      const mh = ph.items.filter(i => i.slot === 'Main Hand').length;
      const oh = ph.items.filter(i => i.slot === 'Off Hand').length;
      return mh === 0 || oh > 0;
    });
    if (!allOK) console.log(`⚠️  ${specKey}: no changes but may have issues`);
  }
}

data.generatedAt = new Date().toISOString();
fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));

console.log(`\n${'═'.repeat(50)}`);
console.log(`✅ Done! ${totalChanges} total changes across all specs.`);
console.log(`📄 Saved: data.json`);
console.log(`\n👉 Next: node sync-data.js && npx firebase deploy --only hosting`);
