eval(require('fs').readFileSync('js/item-restrictions.js','utf8').replace(/const /g,'globalThis.'));
globalThis.PVP_DATA = null;
eval(require('fs').readFileSync('js/pvp-data.js','utf8').replace('const PVP_DATA','PVP_DATA'));

// Fetch from wowhead to confirm which items are actually 2H
const checked = new Set();
const allMH = [];
for (const [spec, data] of Object.entries(PVP_DATA.specs)) {
    for (const item of (data.slots['Main Hand'] || [])) {
        if (checked.has(item.id)) continue;
        checked.add(item.id);
        allMH.push({id: item.id, name: item.name, is2H: ITEM_TWO_HAND_WEAPON.has(item.id), spec, pop: item.popularity});
    }
}

// Known Gladiator 2H weapons from TBC
const GLADIATOR_2H = [
    28298, // Gladiator's Decapitator (2H Axe)
    24557, // Gladiator's War Staff
    28476, // Gladiator's Maul (2H Mace)
    25824, // Gladiator's Greatsword (2H Sword)
    28441, // Deep Thunder
    28442, // Stormherald
    28429, // Lionheart Champion
    28430, // Lionheart Executioner
    28800, // Hammer of the Naaru
    28773, // Gorehowl
    28658, // Terestian's Stranglestaff
    29171, // Earthwarden
    28587, // Legacy
    27903, // Sonic Spear
    22589, // Atiesh
    28308, // Gladiator's Cleaver - actually 1H!
];

console.log('All MH items in PvP data:');
for (const item of allMH.sort((a,b) => a.name.localeCompare(b.name))) {
    const inSet = ITEM_TWO_HAND_WEAPON.has(item.id) ? '✅ in set' : '❌ NOT in set';
    const isGlad2H = GLADIATOR_2H.includes(item.id) ? ' ← KNOWN 2H' : '';
    console.log(`  ${item.id} ${item.name.padEnd(35)} ${inSet}${isGlad2H}`);
}

// Items that should be added
const toAdd = allMH.filter(i => !ITEM_TWO_HAND_WEAPON.has(i.id) && GLADIATOR_2H.includes(i.id));
if (toAdd.length) {
    console.log('\nNeed to add to ITEM_TWO_HAND_WEAPON:');
    for (const i of toAdd) console.log(`  ${i.id}, // ${i.name}`);
}
