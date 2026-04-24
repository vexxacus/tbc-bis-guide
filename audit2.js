const d = JSON.parse(require('fs').readFileSync('data.json','utf8'));
const SIM=['Druid-Balance','Druid-Cat','Hunter-Beast Mastery','Hunter-Marksmanship','Hunter-Survival','Mage-Arcane','Mage-Fire','Mage-Frost','Paladin-Retribution','Priest-Shadow','Rogue-Dps','Shaman-Elemental','Shaman-Enhancement','Warlock-Affliction','Warlock-Demonology','Warlock-Destruction','Warrior-Arms','Warrior-Fury'];

// 1. Random enchant items FIRST in slot for sim specs
console.log('=== RANDOM ENCHANT ITEMS FIRST IN SLOT (SIM SPECS) ===');
d.specs.forEach(sp => {
  const key = sp.className + '-' + sp.specName;
  if (!SIM.includes(key)) return;
  sp.phases.forEach((ph, pi) => {
    const seen = {};
    ph.items.forEach(it => {
      if (!seen[it.slot]) {
        seen[it.slot] = true;
        if (it.name && it.name.includes('\u00a0')) {
          console.log(`  ${key} P${pi} | ${it.slot}: ${it.name.replace(/\u00a0/g,' ')} (${it.itemId})`);
        }
      }
    });
  });
});

// 2. Duplicate enchants
console.log('\n=== DUPLICATE ENCHANTS (SIM SPECS) ===');
d.specs.forEach(sp => {
  const key = sp.className + '-' + sp.specName;
  if (!SIM.includes(key)) return;
  sp.phases.forEach((ph, pi) => {
    const slotCount = {};
    (ph.enchants || []).forEach(e => { slotCount[e.slot] = (slotCount[e.slot] || 0) + 1; });
    Object.entries(slotCount).filter(([, c]) => c > 1).forEach(([s, c]) => {
      console.log(`  ${key} P${pi}: ${c}x ${s}`);
    });
  });
});

// 3. Missing ARMOR enchants (not weapon slots - those vary by spec)
console.log('\n=== MISSING ARMOR ENCHANTS (SIM SPECS) ===');
const ARMOR = ['Head','Shoulder','Back','Chest','Wrist','Hands','Legs','Feet'];
d.specs.forEach(sp => {
  const key = sp.className + '-' + sp.specName;
  if (!SIM.includes(key)) return;
  sp.phases.forEach((ph, pi) => {
    const enchSlots = new Set((ph.enchants || []).map(e => e.slot));
    const missing = ARMOR.filter(s => !enchSlots.has(s));
    if (missing.length > 0) console.log(`  ${key} P${pi}: ${missing.join(', ')}`);
  });
});

// 4. Shadow Priest negative IDs (expected - just listing)
console.log('\n=== NEGATIVE ITEM IDS (expected for wowsims random enchant) ===');
d.specs.forEach(sp => {
  const key = sp.className + '-' + sp.specName;
  sp.phases.forEach((ph, pi) => {
    ph.items.forEach(it => {
      if (it.itemId < 0) {
        console.log(`  ${key} P${pi} | ${it.slot}: ${it.name ? it.name.replace(/\u00a0/g,' ') : 'unnamed'} (${it.itemId})`);
      }
    });
  });
});
