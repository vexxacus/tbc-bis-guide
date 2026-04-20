/**
 * apply-scraped-bis.js
 *
 * Uppdaterar data.json med BiS-data från wowhead-bis-raw.json.
 *
 * Logik per spec + phase:
 *   1. Scrapad BiS (Wowhead/Icy Veins) → rank "BIS" (position 1)
 *   2. LUA Alt-items som INTE finns i scrapad data → rank "Alt" (appended)
 *   3. LUA BIS-item → läggs till som "Alt" om det inte redan finns scrapad
 *   4. Slots som SAKNAS helt i scrapad data → fylls helt från LUA (rank bevaras)
 *   5. Gems, enchants, specName, className — bevaras alltid från LUA
 *
 * Kör: node scraper/apply-scraped-bis.js
 * Eller: npm run apply-scraped-bis
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const RAW_PATH  = path.join(__dirname, 'output', 'wowhead-bis-raw.json');
const DATA_PATH = path.join(__dirname, '..', 'data.json');
const OUT_PATH  = DATA_PATH; // Skriver direkt till data.json (backup skapas)

// ── Phase-index: LUA phase-nyckel → wowhead-bis-raw prefix ─────────────
const PHASE_MAP = {
  1: 'p1',
  2: 'p2',
  3: 'p3',
  4: 'p4',
  5: 'p5',
  // 0 = pre-bis, 5 = sunwell — hanteras om de finns
};

// ── Spec-mappning: LUA className+specName → wowhead-raw spec-del av nyckel
// Format på raw-nyckeln: "{prefix}-{Class}-{Spec}"
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

// ── Slot-namnsmappning: Wowhead/IcyVeins → LUA format ──────────────────
// Scrapad data använder "Helm", LUA använder "Head" etc.
const SCRAPED_TO_LUA_SLOT = {
  'Helm':      'Head',
  'Shoulder':  'Shoulder',
  'Back':      'Back',
  'Chest':     'Chest',
  'Wrist':     'Wrist',
  'Hands':     'Hands',
  'Waist':     'Waist',
  'Legs':      'Legs',
  'Feet':      'Feet',
  'Neck':      'Neck',
  'Ring':      'Ring',
  'Trinket':   'Trinket',
  'Main Hand': 'Main Hand',
  'Off Hand':  'Off Hand',
  'Ranged':    'Ranged/Relic',
  'Two-Hand':  'Two Hand',
  'Head':      'Head',  // om scrapad redan har LUA-format
};

const LUA_TO_SCRAPED_SLOT = Object.fromEntries(
  Object.entries(SCRAPED_TO_LUA_SLOT).map(([k, v]) => [v, k])
);

// ── Hjälpfunktion: normalisera slot till LUA-format ─────────────────────
function toLuaSlot(slot) {
  return SCRAPED_TO_LUA_SLOT[slot] ?? slot;
}

// ── Bygg nya items för en phase från scrapad data + LUA fallback ─────────
function buildPhaseItems(scrapedSlots, luaItems) {
  const result = [];

  // Index LUA-items per slot
  const luaBySlot = {};
  for (const item of luaItems) {
    if (!luaBySlot[item.slot]) luaBySlot[item.slot] = [];
    luaBySlot[item.slot].push(item);
  }

  // Håll koll på alla slots vi hanterar
  const handledLuaSlots = new Set();

  for (const scrapedSlot of scrapedSlots) {
    const luaSlotName = toLuaSlot(scrapedSlot.slot);
    handledLuaSlots.add(luaSlotName);

    // Scrapad BiS-item(s) → rank BIS
    const existingIds = new Set();
    for (const item of scrapedSlot.items) {
      result.push({
        itemId: String(item.itemId),
        slot:   luaSlotName,
        rank:   'BIS',
        name:   item.itemName,
      });
      existingIds.add(String(item.itemId));
    }

    // LUA-items för samma slot som INTE redan finns → rank Alt
    const luaForSlot = luaBySlot[luaSlotName] ?? [];
    for (const luaItem of luaForSlot) {
      if (existingIds.has(String(luaItem.itemId))) continue;
      result.push({
        itemId: String(luaItem.itemId),
        slot:   luaSlotName,
        rank:   'Alt',
        name:   luaItem.name,
      });
      existingIds.add(String(luaItem.itemId));
    }
  }

  // Slots som SAKNAS i scrapad data → lägg till direkt från LUA (bevara rank)
  for (const [luaSlot, luaItems_] of Object.entries(luaBySlot)) {
    if (handledLuaSlots.has(luaSlot)) continue;
    for (const luaItem of luaItems_) {
      result.push({
        itemId: String(luaItem.itemId),
        slot:   luaSlot,
        rank:   luaItem.rank, // BIS/Alt bevaras
        name:   luaItem.name,
      });
    }
  }

  return result;
}

// ── Huvud ────────────────────────────────────────────────────────────────
function main() {
  console.log('🔄 apply-scraped-bis.js\n');

  if (!fs.existsSync(RAW_PATH)) {
    console.error('❌ wowhead-bis-raw.json saknas. Kör scraper/fetch-wowhead-bis.js först.');
    process.exit(1);
  }

  const raw  = JSON.parse(fs.readFileSync(RAW_PATH,  'utf8'));
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));

  // Backup
  const backupPath = DATA_PATH.replace('.json', `.backup-${Date.now()}.json`);
  fs.copyFileSync(DATA_PATH, backupPath);
  console.log(`📦 Backup skapad: ${path.basename(backupPath)}\n`);

  // Räkna tillgängliga scraped specs per phase
  const scrapedPhases = {};
  for (const key of Object.keys(raw)) {
    const [prefix] = key.split('-');
    scrapedPhases[prefix] = (scrapedPhases[prefix] || 0) + 1;
  }
  console.log('📊 Tillgänglig scrapad data:', JSON.stringify(scrapedPhases));
  console.log();

  let totalUpdated = 0;
  let totalFallback = 0;

  for (const luaSpec of data.specs) {
    const luaKey    = `${luaSpec.className} ${luaSpec.specName}`;
    const specPart  = SPEC_KEY_MAP[luaKey];

    if (!specPart) {
      console.warn(`⚠️  Ingen mappning för "${luaKey}"`);
      continue;
    }

    const phaseNums = Object.keys(luaSpec.phases).map(Number).filter(p => PHASE_MAP[p]);

    for (const phaseNum of phaseNums) {
      const prefix    = PHASE_MAP[phaseNum];
      const rawKey    = `${prefix}-${specPart}`;
      const rawSpec   = raw[rawKey];
      const luaPhase  = luaSpec.phases[phaseNum];

      if (!rawSpec || !rawSpec.slots?.length) {
        // Ingen scrapad data → behåll LUA-datan oförändrad
        totalFallback++;
        continue;
      }

      // Bygg nya items
      const newItems = buildPhaseItems(rawSpec.slots, luaPhase.items);

      // Uppdatera items men behåll gems + enchants
      luaSpec.phases[phaseNum] = {
        items:    newItems,
        gems:     luaPhase.gems     || [],
        enchants: luaPhase.enchants || [],
      };

      const bisCount = newItems.filter(i => i.rank === 'BIS').length;
      const altCount = newItems.filter(i => i.rank === 'Alt').length;
      console.log(`  ✅ ${luaKey.padEnd(25)} P${phaseNum}  →  ${String(bisCount).padStart(3)} BIS + ${String(altCount).padStart(3)} Alt  (${newItems.length} totalt)`);
      totalUpdated++;
    }
  }

  // Uppdatera generatedAt
  data.generatedAt = new Date().toISOString();

  fs.writeFileSync(OUT_PATH, JSON.stringify(data, null, 2));

  console.log('\n─────────────────────────────────────────────────');
  console.log(`✅ Klar!`);
  console.log(`   Uppdaterade phase-poster: ${totalUpdated}`);
  console.log(`   Behöll LUA-data (ingen scrapad): ${totalFallback}`);
  console.log(`📄 Sparad: data.json`);
  console.log(`\n👉  Kör sedan:  node sync-data.js  för att uppdatera js/data.js`);
}

main();
