/**
 * merge-p3-lua.js
 *
 * Slår ihop Phase 3 BiS-data:
 *   - Icy Veins (wowhead-bis-raw.json) = primär BiS (rank 1)
 *   - LUA data.json = alternativa items (rank 2+)
 *
 * Logik per slot:
 *   1. Icy Veins-items behålls som rank "BiS" (rank 1)
 *   2. LUA Alt-items läggs till om item-ID inte redan finns
 *   3. LUA BIS-item läggs till om item-ID inte redan finns (som "Alt")
 *
 * Kör: node scraper/merge-p3-lua.js
 */

const fs   = require('fs');
const path = require('path');

const RAW_PATH  = path.join(__dirname, 'output', 'wowhead-bis-raw.json');
const DATA_PATH = path.join(__dirname, '..', 'data.json');

// ── Slot-namnsmappning LUA → Icy Veins ──────────────────────────────────
// LUA använder "Head", Icy Veins "Helm" etc.
const SLOT_MAP = {
  'Head':          'Helm',
  'Shoulder':      'Shoulder',
  'Back':          'Back',
  'Chest':         'Chest',
  'Wrist':         'Wrist',
  'Hands':         'Hands',
  'Waist':         'Waist',
  'Legs':          'Legs',
  'Feet':          'Feet',
  'Neck':          'Neck',
  'Ring':          'Ring',
  'Trinket':       'Trinket',
  'Main Hand':     'Main Hand',
  'Off Hand':      'Off Hand',
  'Ranged/Relic':  'Ranged',
  'Two-Hand':      'Two-Hand',
};

// ── Spec-mappning LUA className+specName → wowhead-bis-raw.json key ─────
// Format: "p3-{Class}-{Spec}"
const SPEC_MAP = {
  'Druid Balance':        'p3-Druid-Balance',
  'Druid Bear':           'p3-Druid-Feral_Tank',
  'Druid Cat':            'p3-Druid-Feral_DPS',
  'Druid Restoration':    'p3-Druid-Restoration',
  'Hunter Beast Mastery': 'p3-Hunter-Beast_Mastery',
  'Hunter Marksmanship':  'p3-Hunter-Marksmanship',
  'Hunter Survival':      'p3-Hunter-Survival',
  'Mage Arcane':          'p3-Mage-Arcane',
  'Mage Fire':            'p3-Mage-Fire',
  'Mage Frost':           'p3-Mage-Frost',
  'Paladin Holy':         'p3-Paladin-Holy',
  'Paladin Protection':   'p3-Paladin-Protection',
  'Paladin Retribution':  'p3-Paladin-Retribution',
  'Priest Holy':          'p3-Priest-Holy/Disc',
  'Priest Shadow':        'p3-Priest-Shadow',
  'Rogue Dps':            'p3-Rogue-Rogue',
  'Shaman Elemental':     'p3-Shaman-Elemental',
  'Shaman Enhancement':   'p3-Shaman-Enhancement',
  'Shaman Restoration':   'p3-Shaman-Restoration',
  'Warlock Affliction':   'p3-Warlock-Affliction',
  'Warlock Demonology':   'p3-Warlock-Demonology',
  'Warlock Destruction':  'p3-Warlock-Destruction',
  'Warrior Arms':         'p3-Warrior-Arms',
  'Warrior Fury':         'p3-Warrior-Fury',
  'Warrior Protection':   'p3-Warrior-Protection',
};

// ── Huvud ────────────────────────────────────────────────────────────────
function main() {
  const raw  = JSON.parse(fs.readFileSync(RAW_PATH,  'utf8'));
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));

  let totalAdded   = 0;
  let totalSkipped = 0;
  let specsUpdated = 0;

  for (const [luaId, luaSpec] of Object.entries(data.specs)) {
    const luaKey  = `${luaSpec.className} ${luaSpec.specName}`;
    const rawKey  = SPEC_MAP[luaKey];

    if (!rawKey) {
      console.warn(`⚠️  Ingen mappning för "${luaKey}" – hoppar`);
      continue;
    }

    const rawSpec = raw[rawKey];
    if (!rawSpec) {
      console.warn(`⚠️  "${rawKey}" saknas i wowhead-bis-raw.json – hoppar`);
      continue;
    }

    // LUA Phase 3 = index "3"
    const luaPhase = luaSpec.phases?.['3'];
    if (!luaPhase?.items?.length) {
      console.warn(`⚠️  Ingen LUA-data för "${luaKey}" phase 3 – hoppar`);
      continue;
    }

    let added   = 0;
    let skipped = 0;

    // Grupp-indexera LUA-items per slot
    const luaBySlot = {};
    for (const item of luaPhase.items) {
      const mappedSlot = SLOT_MAP[item.slot] ?? item.slot;
      if (!luaBySlot[mappedSlot]) luaBySlot[mappedSlot] = [];
      luaBySlot[mappedSlot].push(item);
    }

    // Gå igenom varje slot i Icy Veins-datan
    for (const slotEntry of rawSpec.slots) {
      const slotName = slotEntry.slot;

      // Bygg upp ett set av redan befintliga item-IDs (Icy Veins)
      const existingIds = new Set(slotEntry.items.map(i => String(i.itemId)));

      const luaItems = luaBySlot[slotName] ?? [];

      // Lägg till LUA-items som saknas
      for (const luaItem of luaItems) {
        const luaId = String(luaItem.itemId);
        if (existingIds.has(luaId)) {
          skipped++;
          continue;
        }
        slotEntry.items.push({
          rank:     'Alt',
          itemName: luaItem.name,
          itemId:   luaId,
          source:   '',       // LUA har ingen source-text
        });
        existingIds.add(luaId);
        added++;
      }
    }

    // Hantera LUA-slots som INTE finns i Icy Veins alls (t.ex. extra slots)
    for (const [slotName, luaItems] of Object.entries(luaBySlot)) {
      const existsInRaw = rawSpec.slots.some(s => s.slot === slotName);
      if (existsInRaw) continue;  // redan hanterat ovan

      // Skapa ny slot med LUA-items
      const newSlot = {
        slot:  slotName,
        items: luaItems.map(i => ({
          rank:     i.rank === 'BIS' ? 'BiS' : 'Alt',
          itemName: i.name,
          itemId:   String(i.itemId),
          source:   '',
        })),
      };
      rawSpec.slots.push(newSlot);
      added += newSlot.items.length;
    }

    totalAdded   += added;
    totalSkipped += skipped;
    specsUpdated++;

    const totalItems = rawSpec.slots.reduce((n, s) => n + s.items.length, 0);
    console.log(`  ✅ ${rawKey.padEnd(30)} +${String(added).padStart(3)} LUA-items  (totalt ${totalItems} items, ${rawSpec.slots.length} slots)`);
  }

  fs.writeFileSync(RAW_PATH, JSON.stringify(raw, null, 2));

  console.log('\n─────────────────────────────────────────');
  console.log(`✅ Klar! ${specsUpdated} specs uppdaterade`);
  console.log(`   Tillagda LUA-items:   ${totalAdded}`);
  console.log(`   Duplicater hoppade:   ${totalSkipped}`);
  console.log(`📄 Sparad: ${RAW_PATH}`);
}

main();
