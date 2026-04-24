const fs = require('fs');
const data = JSON.parse(fs.readFileSync('data.json', 'utf8'));

// Known wowsims enchant IDs (spellId values that map to item enchants)
const KNOWN_ENCHANT_SPELLS = new Set([
  // Head
  29192, 29191, 29193, 30846,
  // Shoulder  
  28886, 28888, 28909, 28910, 28911, 23548, 23545, 20076, 35417,
  // Back
  33150, 34004, 11206, 28274, 28277, 35756,
  // Chest
  27957, 24003, 22546, 33990, 33991, 28270,
  // Wrist
  34002, 22534, 22533, 27899, 34001, 27905,
  // Hands
  33152, 33153, 28272, 28271, 33995, 20727,
  // Legs
  24274, 24273, 29535, 29536, 29533, 29534,
  // Feet
  35297, 22544, 35298, 28279, 16220, 22543,
  // Weapon (1H/2H)
  22556, 22555, 22560, 22561, 22559, 19445, 33165, 16252, 22554, 33307, 35498, 22552, 16250,
  // Shield
  22539, 28282, 44383,
  // Ring
  22536, 22535, 22538,
  // Ranged
  23766, 23765, 18283,
]);

// Slots that should have enchants
const ENCHANTABLE_SLOTS = ['Head', 'Shoulder', 'Back', 'Chest', 'Wrist', 'Hands', 'Legs', 'Feet'];
const WEAPON_SLOTS = ['Main Hand', 'Two Hand', 'Main Hand~Off Hand'];

// SIM_DPS_SPECS from app.js
const SIM_SPECS = [
  'Druid-Cat', 'Druid-Balance',
  'Hunter-Beast Mastery', 'Hunter-Marksmanship', 'Hunter-Survival',
  'Mage-Arcane', 'Mage-Fire', 'Mage-Frost',
  'Paladin-Retribution',
  'Priest-Shadow',
  'Rogue-Dps',
  'Shaman-Elemental', 'Shaman-Enhancement',
  'Warlock-Affliction', 'Warlock-Demonology', 'Warlock-Destruction',
  'Warrior-Arms', 'Warrior-Fury',
];

// Random enchantment item IDs (wowhead base IDs)
const RANDOM_ENCHANT_IDS = new Set([
  '30675', '30676', '30677', '30678', // Lurker's (waist)
  '30680', '30681', '30682', '30683', // Glider's (feet)
  '30684', '30685', '30686', '30687', // Ravager's (wrist)
]);

// Wowsims supported random enchant wowhead IDs (negative ID items in items.go)
// Only spell power variants for cloth/leather
const WOWSIMS_RANDOM_ENCHANT_WOWHEAD = new Set([
  '30675', // Lurker's Cord (cloth waist) - arcane/fire/frost/shadow wrath
  '30676', // Lurker's Grasp (leather waist) - nature wrath
  '30680', // Glider's Foot-Wraps (cloth feet) - arcane/fire/frost/shadow wrath
  '30681', // Glider's Boots (leather feet) - nature wrath
  '30684', // Ravager's Cuffs (cloth wrist) - arcane/fire/frost/shadow wrath
  '30685', // Ravager's Wrist-Wraps (leather wrist) - nature wrath
]);

// Items that are NOT in wowsims (mail "of Agility"/"of the Bandit" etc)
const UNSUPPORTED_RANDOM_ENCHANT = new Set([
  '30677', // Lurker's Belt (mail waist)
  '30678', // Lurker's Cord variant?
  '30682', // Glider's Sabatons (mail feet)
  '30683', // Glider's variant?
  '30686', // Ravager's Bands (mail wrist)
  '30687', // Ravager's variant?
]);

let issues = [];
const allSpecs = Object.values(data.specs);
let specIdx = 0;

for (const spec of allSpecs) {
  specIdx++;
  const specKey = `${spec.className}-${spec.specName}`;
  const isSim = SIM_SPECS.includes(specKey);
  process.stdout.write(`\r[${specIdx}/${allSpecs.length}] ${specKey}...                    `);
  
  for (const [phaseNum, phase] of Object.entries(spec.phases)) {
    const prefix = `${specKey} P${phaseNum}`;
    
    // Group items by slot, pick BIS #1
    const slotMap = {};
    for (const item of phase.items) {
      const key = item.slot;
      if (!slotMap[key]) slotMap[key] = [];
      slotMap[key].push(item);
    }
    
    // Check for random enchant items as BIS #1
    for (const [slot, items] of Object.entries(slotMap)) {
      const bis1 = items[0]; // first item = what sim uses
      if (UNSUPPORTED_RANDOM_ENCHANT.has(bis1.itemId)) {
        issues.push(`🔴 ${prefix} | ${slot} BIS #1 "${bis1.name}" (${bis1.itemId}) is unsupported random enchant item — sim will fail!`);
      }
    }

    // Check enchants for sim specs
    if (isSim) {
      const enchants = phase.enchants || [];
      const enchantedSlots = new Set(enchants.map(e => e.slot));
      
      // Check missing enchants for common slots
      for (const slot of ENCHANTABLE_SLOTS) {
        if (slotMap[slot] && !enchantedSlots.has(slot)) {
          issues.push(`🟡 ${prefix} | Missing enchant for ${slot}`);
        }
      }
      
      // Check weapon enchants
      const hasWeapon = slotMap['Main Hand'] || slotMap['Two Hand'] || slotMap['Main Hand~Off Hand'];
      const hasMHEnchant = enchantedSlots.has('Main Hand') || enchantedSlots.has('Two Hand');
      if (hasWeapon && !hasMHEnchant) {
        issues.push(`🟡 ${prefix} | Missing weapon enchant (Main Hand/Two Hand)`);
      }
      
      // Check ranged enchant for hunters
      if (specKey.startsWith('Hunter-') && slotMap['Ranged'] && !enchantedSlots.has('Ranged')) {
        issues.push(`🟡 ${prefix} | Missing Ranged enchant (scope)`);
      }

      // Check for unknown enchant spellIds
      for (const ench of enchants) {
        if (ench.spellId && !KNOWN_ENCHANT_SPELLS.has(ench.spellId)) {
          issues.push(`🟠 ${prefix} | ${ench.slot} enchant spellId ${ench.spellId} not in known list — verify it works`);
        }
      }
      
      // Check gems exist for phases > 0
      if (parseInt(phaseNum) >= 1) {
        const gems = phase.gems || [];
        if (gems.length === 0) {
          issues.push(`🟡 ${prefix} | No gems defined`);
        }
      }
    }
  }
}

// Group and sort issues
process.stdout.write(`\r✅ Done! Scanned ${allSpecs.length} specs.                    \n\n`);
const critical = issues.filter(i => i.startsWith('🔴'));
const warnings = issues.filter(i => i.startsWith('🟡'));
const info = issues.filter(i => i.startsWith('🟠'));

if (critical.length) {
  console.log('=== CRITICAL (sim will fail) ===');
  critical.forEach(i => console.log(i));
  console.log();
}

if (warnings.length) {
  console.log('=== MISSING ENCHANTS/GEMS ===');
  warnings.forEach(i => console.log(i));
  console.log();
}

if (info.length) {
  console.log('=== UNKNOWN ENCHANT IDs (verify) ===');
  info.forEach(i => console.log(i));
  console.log();
}

console.log(`\nSummary: ${critical.length} critical, ${warnings.length} warnings, ${info.length} info`);
