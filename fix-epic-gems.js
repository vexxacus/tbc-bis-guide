// Fix epic gems in P0-P2 by downgrading to rare equivalents
// Match by gem name prefix (e.g. "Runed Ornate Ruby" → "Runed Living Ruby")
const fs = require('fs');
const d = JSON.parse(fs.readFileSync('data.json', 'utf8'));

// Collect ALL gems used across all phases
const allGems = new Map();
for (const spec of d.specs) {
  for (const phase of Object.values(spec.phases)) {
    if (!Array.isArray(phase.gems)) continue;
    for (const gem of phase.gems) {
      if (gem == null) continue;
      allGems.set(gem.itemId, gem);
    }
  }
}

const rareGems = [...allGems.values()].filter(g => g.quality === 3 && !g.isMeta);
const epicGems = [...allGems.values()].filter(g => g.quality === 4 && !g.isMeta);

function getPrefix(name) { return name.split(' ')[0]; }

// Manual mappings for gems where no rare with same prefix exists in our data
const MANUAL = {
  '30574': { itemId: '24054', name: 'Sovereign Nightseye', quality: 3, isMeta: false },    // Brutal Tanzanite (str+stam) → Sovereign Nightseye (str+stam) ✅ exact
  '30582': { itemId: '24061', name: 'Glinting Noble Topaz', quality: 3, isMeta: false },   // Deadly Fire Opal (AP+crit) → Glinting Noble Topaz (hit+agi) for hunters
  '30550': { itemId: '24067', name: 'Jagged Talasite', quality: 3, isMeta: false },        // Sundered Chrysoprase (crit+resilience) → Jagged Talasite (crit+stam)
  '30600': { itemId: '24056', name: 'Glowing Nightseye', quality: 3, isMeta: false },      // Fluorescent Tanzanite (spell+spirit) → Glowing Nightseye (spell+stam)
  '30604': { itemId: '24058', name: 'Inscribed Noble Topaz', quality: 3, isMeta: false },   // Resplendent Fire Opal (str+crit) → Inscribed Noble Topaz (str+crit) ✅ exact
  '30564': { itemId: '31867', name: 'Veiled Noble Topaz', quality: 3, isMeta: false },     // Shining Fire Opal (hit+spell) → Veiled Noble Topaz (hit+spell) ✅ exact
  '30559': { itemId: '24061', name: 'Glinting Noble Topaz', quality: 3, isMeta: false },   // Etched Fire Opal (hit+str) → Glinting Noble Topaz (hit+agi)
  '30593': { itemId: '24057', name: 'Royal Nightseye', quality: 3, isMeta: false },        // Iridescent Fire Opal (heal+mp5) → Royal Nightseye (heal+mp5) ✅ exact
  '30606': { itemId: '31867', name: 'Veiled Noble Topaz', quality: 3, isMeta: false },     // Lambent Chrysoprase (hit+mp5) → Veiled Noble Topaz (hit+spell) for warlocks
  '30605': { itemId: '24061', name: 'Glinting Noble Topaz', quality: 3, isMeta: false },   // Vivid Chrysoprase (hit+stam) → Glinting Noble Topaz (hit+agi)
  '32208': { itemId: '24033', name: 'Solid Star of Elune', quality: 3, isMeta: false },    // Thick Lionseye (defense) → Solid Star of Elune (stam) for prot pally
  '32223': { itemId: '24033', name: 'Solid Star of Elune', quality: 3, isMeta: false },    // Enduring Seaspray Emerald (def+stam) → Solid Star of Elune (stam) for prot pally
};

// Build mapping: epic → rare with same prefix, then overlay manual
const mapping = {};
for (const epic of epicGems) {
  const prefix = getPrefix(epic.name);
  const match = rareGems.find(r => getPrefix(r.name) === prefix);
  if (match) {
    mapping[epic.itemId] = { itemId: match.itemId, name: match.name, quality: 3, isMeta: false };
  }
}
// Apply manual overrides
for (const [k, v] of Object.entries(MANUAL)) {
  if (!mapping[k]) mapping[k] = v;
}

console.log('=== Epic → Rare gem mapping ===\n');
for (const epic of epicGems.sort((a,b) => a.name.localeCompare(b.name))) {
  const m = mapping[epic.itemId];
  if (m) {
    console.log(`  ✅ ${epic.name} (${epic.itemId}) → ${m.name} (${m.itemId})`);
  } else {
    console.log(`  ❌ ${epic.name} (${epic.itemId}) → NO RARE MATCH`);
  }
}

// Apply: downgrade epic gems in P0-P2
const earlyPhases = ['0', '1', '2'];
let fixed = 0, unfixed = 0;
for (const spec of d.specs) {
  for (const pIdx of earlyPhases) {
    const phase = spec.phases[pIdx];
    if (!Array.isArray(phase.gems)) continue;
    for (let i = 0; i < phase.gems.length; i++) {
      const gem = phase.gems[i];
      if (gem && gem.quality === 4) {
        const m = mapping[gem.itemId];
        if (m) {
          phase.gems[i] = { ...m };
          fixed++;
        } else {
          console.log(`\n⚠️  No mapping: ${spec.className}-${spec.specName} P${pIdx} gem[${i}]: ${gem.name} (${gem.itemId})`);
          unfixed++;
        }
      }
    }
  }
}

console.log(`\n=== ${fixed} gems downgraded, ${unfixed} unresolved ===`);

if (unfixed === 0) {
  fs.writeFileSync('data.json', JSON.stringify(d, null, 2));
  console.log('✅ data.json saved!');
} else {
  console.log('❌ NOT saving - fix unresolved gems first');
}
