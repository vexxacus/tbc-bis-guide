const d = JSON.parse(require('fs').readFileSync('data.json','utf8'));

console.log("=== RANDOM ENCHANT ITEMS (nbsp in name) ===\n");

// 1. Find all random enchant items and whether they're first in slot
const SIM_DPS_SPECS = [
  'Druid-Balance','Druid-Cat',
  'Hunter-Beast Mastery','Hunter-Marksmanship','Hunter-Survival',
  'Mage-Arcane','Mage-Fire','Mage-Frost',
  'Paladin-Retribution',
  'Priest-Shadow',
  'Rogue-Dps',
  'Shaman-Elemental','Shaman-Enhancement',
  'Warlock-Affliction','Warlock-Demonology','Warlock-Destruction',
  'Warrior-Arms','Warrior-Fury'
];

let issues = [];
Object.values(d.specs).forEach(sp => {
  const key = sp.className + '-' + sp.specName;
  const hasSim = SIM_DPS_SPECS.includes(key);
  Object.keys(sp.phases).forEach(ph => {
    const items = sp.phases[ph].items;
    const seen = {};
    items.forEach((it, i) => {
      if (!seen[it.slot]) {
        seen[it.slot] = true;
        if (it.name && it.name.indexOf('nbsp') >= 0) {
          const label = `${key} P${ph} | ${it.slot} FIRST: ${it.name} (${it.itemId})`;
          if (hasSim) {
            issues.push('❌ SIM AFFECTED: ' + label);
          } else {
            issues.push('⚠️  Display only: ' + label);
          }
        }
      } else {
        if (it.name && it.name.indexOf('nbsp') >= 0) {
          // Not first, just note it
        }
      }
    });
  });
});

if (issues.length === 0) {
  console.log("✅ No random enchant items are first in any slot\n");
} else {
  issues.forEach(i => console.log(i));
  console.log();
}

// Count all random enchant items
let allRandom = [];
Object.values(d.specs).forEach(sp => {
  Object.keys(sp.phases).forEach(ph => {
    sp.phases[ph].items.forEach(it => {
      if (it.name && it.name.indexOf('nbsp') >= 0) {
        allRandom.push(`${sp.className}-${sp.specName} P${ph} | ${it.slot} ${it.rank}: ${it.name} (${it.itemId})`);
      }
    });
  });
});
console.log(`Total random enchant items in data: ${allRandom.length}`);
allRandom.forEach(r => console.log('  ' + r));

// 2. Check for missing enchants in SIM specs
console.log("\n=== ENCHANT AUDIT FOR SIM SPECS ===\n");

const ENCHANT_SLOTS = ['Head','Shoulder','Back','Chest','Wrist','Hands','Legs','Feet','Main Hand','Off Hand','Two Hand','Ranged'];

Object.values(d.specs).forEach(sp => {
  const key = sp.className + '-' + sp.specName;
  if (!SIM_DPS_SPECS.includes(key)) return;
  
  Object.keys(sp.phases).forEach(ph => {
    const enchants = sp.phases[ph].enchants || [];
    const items = sp.phases[ph].items;
    const enchantSlots = enchants.map(e => e.slot);
    
    // Check which slots have items but no enchants
    const itemSlots = [...new Set(items.map(i => i.slot))];
    const missing = ENCHANT_SLOTS.filter(s => {
      const hasItem = itemSlots.includes(s);
      const hasEnchant = enchantSlots.includes(s);
      return hasItem && !hasEnchant;
    });
    
    if (missing.length > 0) {
      console.log(`⚠️  ${key} P${ph} missing enchants for: ${missing.join(', ')}`);
    }
  });
});

// 3. Check for duplicate enchant slots (multiple enchants for same slot)
console.log("\n=== DUPLICATE ENCHANT CHECK ===\n");
let dupFound = false;
Object.values(d.specs).forEach(sp => {
  const key = sp.className + '-' + sp.specName;
  if (!SIM_DPS_SPECS.includes(key)) return;
  
  Object.keys(sp.phases).forEach(ph => {
    const enchants = sp.phases[ph].enchants || [];
    const slotCounts = {};
    enchants.forEach(e => {
      slotCounts[e.slot] = (slotCounts[e.slot] || 0) + 1;
    });
    Object.keys(slotCounts).forEach(s => {
      if (slotCounts[s] > 1) {
        dupFound = true;
        console.log(`⚠️  ${key} P${ph} has ${slotCounts[s]} enchants for ${s}`);
      }
    });
  });
});
if (!dupFound) console.log("✅ No duplicate enchants found");

// 4. Check enchant IDs exist (basic sanity)
console.log("\n=== ENCHANT ID SANITY CHECK ===\n");
let badEnchants = [];
Object.values(d.specs).forEach(sp => {
  const key = sp.className + '-' + sp.specName;
  if (!SIM_DPS_SPECS.includes(key)) return;
  
  Object.keys(sp.phases).forEach(ph => {
    const enchants = sp.phases[ph].enchants || [];
    enchants.forEach(e => {
      const id = parseInt(e.itemId);
      if (!id || id <= 0) {
        badEnchants.push(`${key} P${ph} | ${e.slot}: invalid enchant ID "${e.itemId}"`);
      }
    });
  });
});
if (badEnchants.length === 0) {
  console.log("✅ All enchant IDs are valid numbers");
} else {
  badEnchants.forEach(b => console.log('❌ ' + b));
}

// 5. Check for items with ID 0 or empty
console.log("\n=== ITEM ID SANITY CHECK ===\n");
let badItems = [];
Object.values(d.specs).forEach(sp => {
  const key = sp.className + '-' + sp.specName;
  Object.keys(sp.phases).forEach(ph => {
    sp.phases[ph].items.forEach(it => {
      const id = parseInt(it.itemId);
      if (!id || id <= 0) {
        badItems.push(`${key} P${ph} | ${it.slot}: invalid item ID "${it.itemId}" (${it.name})`);
      }
    });
  });
});
if (badItems.length === 0) {
  console.log("✅ All item IDs are valid numbers");
} else {
  badItems.forEach(b => console.log('❌ ' + b));
}

// 6. Check shadow priest for random enchant wowsims IDs
console.log("\n=== SHADOW PRIEST RANDOM ENCHANT CHECK ===\n");
const sp = Object.values(d.specs).find(s => s.className === 'Priest' && s.specName === 'Shadow');
if (sp) {
  Object.keys(sp.phases).forEach(ph => {
    const items = sp.phases[ph].items.filter(it => it.name && it.name.indexOf('nbsp') >= 0);
    if (items.length) {
      console.log(`Shadow P${ph}:`);
      items.forEach(it => console.log(`  ${it.slot}: ${it.name} (${it.itemId}) rank=${it.rank}`));
    }
  });
}
