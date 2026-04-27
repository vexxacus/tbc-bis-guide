const fs = require('fs');
const src = fs.readFileSync('./js/pvp-data.js','utf8');
eval(src);

const allEnchants = [];
const missingIcons = [];

for (const [spec, data] of Object.entries(PVP_DATA.specs)) {
  for (const [slot, items] of Object.entries(data.slots)) {
    for (const item of items) {
      // Check enchants
      if (item.topEnchants) {
        for (const e of item.topEnchants) {
          allEnchants.push({spec, slot, itemName: item.name, enchId: e.id, enchName: e.name, usage: e.usage});
        }
      }
    }
  }
}

console.log('Total enchant entries:', allEnchants.length);

// Group by enchant ID to see unique enchants
const byId = {};
allEnchants.forEach(e => {
  const key = e.enchId || 'NO_ID';
  if (!byId[key]) byId[key] = {id: e.enchId, name: e.enchName, count: 0};
  byId[key].count++;
});

console.log('\nUnique enchants:', Object.keys(byId).length);
console.log('\nAll unique enchants (id -> name):');
Object.values(byId).sort((a,b) => b.count - a.count).forEach(e => {
  console.log(`  ${e.id}\t${e.name}\t(x${e.count})`);
});

// Now check: are these spell IDs or enchant IDs?
// Wowhead spell tooltip: /spell=XXXXX
// The link we generate is tbc.wowhead.com/spell=ID
// But these might be enchantment IDs (item enchant IDs), not spell IDs
console.log('\n--- Checking Holy Paladin bracers ---');
const holyPala = PVP_DATA.specs['Paladin|Holy'];
if (holyPala) {
  const wrist = holyPala.slots['wrist'] || holyPala.slots['Wrist'] || holyPala.slots['wrists'];
  if (wrist) {
    console.log('Wrist items:', JSON.stringify(wrist, null, 2));
  } else {
    console.log('Available slots:', Object.keys(holyPala.slots));
  }
}
