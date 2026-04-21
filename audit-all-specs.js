#!/usr/bin/env node
/**
 * Full audit: compare data.json against wowhead-bis-raw.json for ALL specs/phases.
 * Reports:
 *  - Items in Wowhead but MISSING from data.json
 *  - Items in data.json but NOT in Wowhead (extra items)
 *  - Slot mismatches
 * 
 * Skips: phase 0 (pre-bis, no Wowhead data), PVP specs
 */
const fs = require('fs');

const data = JSON.parse(fs.readFileSync('./data.json', 'utf8'));
const scraped = require('./scraper/output/wowhead-bis-raw.json');

// MH-only items (from Wowhead tooltip data)
const ITEM_MAIN_HAND_ONLY = new Set([
    21673,23056,23554,23556,24453,27512,27538,27543,27741,27846,
    27868,27899,27905,27937,28216,28257,28297,28313,28392,28432,
    28433,28438,28439,28522,28584,28657,28767,28770,28771,28802,
    28931,29153,29155,29175,29185,29348,29353,29371,30058,30095,
    30108,30277,30723,30787,30832,30910,30918,31142,31304,31336,
    31342,32053,32237,32450,32451,32500,32660,32837,32944,32946,
    32963,32964,33283,33354,33467,33468,33495,33687,33737,33743,
    33763,34009,34176,34199,34331,34335,34336,34604,34611,34893,
    34895,34896,35014,35082,35102
]);

// Map data.json spec names to scraped key format
const SPEC_MAP = {
    'Druid-Balance': 'Druid-Balance',
    'Druid-Bear': 'Druid-Feral_Tank',
    'Druid-Cat': 'Druid-Feral_DPS',
    'Druid-Restoration': 'Druid-Restoration',
    'Hunter-Beast Mastery': 'Hunter-Beast_Mastery',
    'Hunter-Marksmanship': 'Hunter-Marksmanship',
    'Hunter-Survival': 'Hunter-Survival',
    'Mage-Arcane': 'Mage-Arcane',
    'Mage-Fire': 'Mage-Fire',
    'Mage-Frost': 'Mage-Frost',
    'Paladin-Holy': 'Paladin-Holy',
    'Paladin-Protection': 'Paladin-Protection',
    'Paladin-Retribution': 'Paladin-Retribution',
    'Priest-Holy': 'Priest-Holy/Disc',
    'Priest-Shadow': 'Priest-Shadow',
    'Rogue-Dps': 'Rogue-Rogue',
    'Shaman-Elemental': 'Shaman-Elemental',
    'Shaman-Enhancement': 'Shaman-Enhancement',
    'Shaman-Restoration': 'Shaman-Restoration',
    'Warlock-Affliction': 'Warlock-Affliction',
    'Warlock-Demonology': 'Warlock-Demonology',
    'Warlock-Destruction': 'Warlock-Destruction',
    'Warrior-Arms': 'Warrior-Arms',
    'Warrior-Fury': 'Warrior-Fury',
    'Warrior-Protection': 'Warrior-Protection',
};

// Normalize slot names between scraped and data.json
function normalizeSlot(slot) {
    const s = slot.toLowerCase().trim();
    if (s === 'two-hand') return 'two hand';
    if (s === 'head' || s === 'helm') return 'head';
    if (s === 'shoulder' || s === 'shoulders') return 'shoulder';
    if (s === 'back' || s === 'cloak') return 'back';
    if (s === 'chest') return 'chest';
    if (s === 'wrist' || s === 'bracer' || s === 'bracers') return 'wrist';
    if (s === 'hands' || s === 'gloves') return 'hands';
    if (s === 'waist' || s === 'belt') return 'waist';
    if (s === 'legs' || s === 'leg') return 'legs';
    if (s === 'feet' || s === 'boots') return 'feet';
    if (s === 'neck' || s === 'necklace') return 'neck';
    if (s === 'ring' || s === 'finger') return 'ring';
    if (s === 'trinket') return 'trinket';
    if (s === 'main hand') return 'main hand';
    if (s === 'off hand' || s === 'off-hand' || s === 'shield') return 'off hand';
    if (s === 'ranged' || s === 'relic' || s === 'ranged/relic' || s === 'idol' || s === 'totem' || s === 'libram' || s === 'wand') return 'ranged';
    if (s === 'weapon') return 'weapon';  // special combined slot
    return s;
}

// Slots we compare (skip "Weapon" combined slot - handled separately via MH/OH)
const GEAR_SLOTS = ['head','shoulder','back','chest','wrist','hands','waist','legs','feet','neck','ring','trinket','main hand','off hand','two hand','ranged'];

let totalMissing = 0;
let totalExtra = 0;
let issuesBySpec = {};

for (const spec of data.specs) {
    const specKey = `${spec.className}-${spec.specName}`;
    const scrapedKey = SPEC_MAP[specKey];
    if (!scrapedKey) {
        console.log(`⚠️  No mapping for ${specKey}`);
        continue;
    }

    for (const [phase, phaseData] of Object.entries(spec.phases)) {
        if (phase === '0') continue; // No Wowhead data for pre-bis

        const sKey = `p${phase}-${scrapedKey}`;
        const scrapedEntry = scraped[sKey];
        if (!scrapedEntry) {
            // console.log(`  ℹ️  No scraped data for ${sKey}`);
            continue;
        }

        // Build scraped items by slot
        const scrapedBySlot = {};
        for (const sl of scrapedEntry.slots) {
            const norm = normalizeSlot(sl.slot);
            if (norm === 'weapon') {
                // Split weapon into MH/OH based on rank hints
                for (const item of sl.items) {
                    const hint = (item.rank || '').toLowerCase();
                    if (hint.includes('oh') || hint.includes('off')) {
                        if (!scrapedBySlot['off hand']) scrapedBySlot['off hand'] = new Set();
                        scrapedBySlot['off hand'].add(String(item.itemId));
                    } else if (hint.includes('x2') || hint.includes('both')) {
                        if (!scrapedBySlot['main hand']) scrapedBySlot['main hand'] = new Set();
                        if (!scrapedBySlot['off hand']) scrapedBySlot['off hand'] = new Set();
                        scrapedBySlot['main hand'].add(String(item.itemId));
                        if (!ITEM_MAIN_HAND_ONLY.has(Number(item.itemId))) {
                            scrapedBySlot['off hand'].add(String(item.itemId));
                        }
                    } else {
                        // Default to MH
                        if (!scrapedBySlot['main hand']) scrapedBySlot['main hand'] = new Set();
                        scrapedBySlot['main hand'].add(String(item.itemId));
                    }
                }
            } else {
                if (!scrapedBySlot[norm]) scrapedBySlot[norm] = new Set();
                for (const item of sl.items) {
                    scrapedBySlot[norm].add(String(item.itemId));
                }
            }
        }

        // Build data.json items by slot
        const dataBySlot = {};
        for (const item of phaseData.items) {
            const norm = normalizeSlot(item.slot);
            if (!dataBySlot[norm]) dataBySlot[norm] = new Set();
            dataBySlot[norm].add(String(item.itemId));
        }

        // Compare each slot
        for (const slot of GEAR_SLOTS) {
            const scrapedItems = scrapedBySlot[slot] || new Set();
            const dataItems = dataBySlot[slot] || new Set();

            // Items in Wowhead but missing from data.json
            for (const id of scrapedItems) {
                if (!dataItems.has(id)) {
                    const scrapedItem = scrapedEntry.slots
                        .flatMap(s => s.items)
                        .find(i => String(i.itemId) === id);
                    const name = scrapedItem ? scrapedItem.itemName : '?';
                    const rank = scrapedItem ? scrapedItem.rank : '?';
                    const key = `${specKey} P${phase}`;
                    if (!issuesBySpec[key]) issuesBySpec[key] = [];
                    issuesBySpec[key].push(`  ❌ MISSING ${slot}: ${id} ${name} (rank: ${rank})`);
                    totalMissing++;
                }
            }

            // Items in data.json but not in Wowhead (only for non-weapon slots where we have scraped data)
            if (scrapedItems.size > 0) {
                for (const id of dataItems) {
                    if (!scrapedItems.has(id)) {
                        const dataItem = phaseData.items.find(i => String(i.itemId) === id && normalizeSlot(i.slot) === slot);
                        const name = dataItem ? dataItem.name : '?';
                        const key = `${specKey} P${phase}`;
                        if (!issuesBySpec[key]) issuesBySpec[key] = [];
                        issuesBySpec[key].push(`  ➕ EXTRA  ${slot}: ${id} ${name}`);
                        totalExtra++;
                    }
                }
            }
        }
    }
}

// Print results
let specCount = 0;
for (const [key, issues] of Object.entries(issuesBySpec).sort()) {
    if (issues.length > 0) {
        specCount++;
        console.log(`\n${key}:`);
        issues.forEach(i => console.log(i));
    }
}

console.log(`\n${'='.repeat(60)}`);
console.log(`SUMMARY: ${totalMissing} missing items, ${totalExtra} extra items across ${specCount} spec-phases`);
console.log(`${'='.repeat(60)}`);
