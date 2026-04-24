/**
 * Fix gem recommendations for all specs based on Wowhead guides.
 * Sets correct rare gems for P0-P2, epic equivalents for P3-P5.
 */
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('data.json', 'utf8'));

// Rare gems (P0-P2)
const RARE = {
  // Meta
  relentless:  { itemId: "32409", quality: 3, isMeta: true, name: "Relentless Earthstorm Diamond" },
  chaotic:     { itemId: "34220", quality: 3, isMeta: true, name: "Chaotic Skyfire Diamond" },
  mystical:    { itemId: "25893", quality: 3, isMeta: true, name: "Mystical Skyfire Diamond" },
  insightful:  { itemId: "25901", quality: 3, isMeta: true, name: "Insightful Earthstorm Diamond" },
  bracing:     { itemId: "25897", quality: 3, isMeta: true, name: "Bracing Earthstorm Diamond" },
  powerful:    { itemId: "25896", quality: 3, isMeta: true, name: "Powerful Earthstorm Diamond" },
  // Red
  runed:       { itemId: "24030", quality: 3, isMeta: false, name: "Runed Living Ruby" },
  delicate:    { itemId: "24028", quality: 3, isMeta: false, name: "Delicate Living Ruby" },
  bold:        { itemId: "24027", quality: 3, isMeta: false, name: "Bold Living Ruby" },
  teardrop:    { itemId: "24029", quality: 3, isMeta: false, name: "Teardrop Living Ruby" },
  // Yellow
  veiled:      { itemId: "31867", quality: 3, isMeta: false, name: "Veiled Noble Topaz" },
  glinting:    { itemId: "24061", quality: 3, isMeta: false, name: "Glinting Noble Topaz" },
  wicked:      { itemId: "31868", quality: 3, isMeta: false, name: "Wicked Noble Topaz" },
  inscribed:   { itemId: "24058", quality: 3, isMeta: false, name: "Inscribed Noble Topaz" },
  potent:      { itemId: "24059", quality: 3, isMeta: false, name: "Potent Noble Topaz" },
  luminous:    { itemId: "24060", quality: 3, isMeta: false, name: "Luminous Noble Topaz" },
  brilliant:   { itemId: "24047", quality: 3, isMeta: false, name: "Brilliant Dawnstone" },
  quick:       { itemId: "35315", quality: 3, isMeta: false, name: "Quick Dawnstone" },
  // Blue
  glowing:     { itemId: "24056", quality: 3, isMeta: false, name: "Glowing Nightseye" },
  shifting:    { itemId: "24055", quality: 3, isMeta: false, name: "Shifting Nightseye" },
  sovereign:   { itemId: "24054", quality: 3, isMeta: false, name: "Sovereign Nightseye" },
  royal:       { itemId: "24057", quality: 3, isMeta: false, name: "Royal Nightseye" },
  purified:    { itemId: "32836", quality: 3, isMeta: false, name: "Purified Shadow Pearl" },
  solid:       { itemId: "24033", quality: 3, isMeta: false, name: "Solid Star of Elune" },
};

// Epic gems (P3-P5)
const EPIC = {
  // Meta (same as rare - metas don't have epic versions)
  relentless:  RARE.relentless,
  chaotic:     RARE.chaotic,
  mystical:    RARE.mystical,
  insightful:  RARE.insightful,
  bracing:     RARE.bracing,
  powerful:    RARE.powerful,
  // Red
  runed:       { itemId: "32196", quality: 4, isMeta: false, name: "Runed Crimson Spinel" },
  delicate:    { itemId: "32193", quality: 4, isMeta: false, name: "Delicate Crimson Spinel" },
  bold:        { itemId: "32194", quality: 4, isMeta: false, name: "Bold Crimson Spinel" },
  teardrop:    { itemId: "32195", quality: 4, isMeta: false, name: "Teardrop Crimson Spinel" },
  // Yellow
  veiled:      { itemId: "32218", quality: 4, isMeta: false, name: "Veiled Pyrestone" },
  glinting:    { itemId: "32220", quality: 4, isMeta: false, name: "Glinting Pyrestone" },
  wicked:      { itemId: "32219", quality: 4, isMeta: false, name: "Wicked Pyrestone" },
  inscribed:   { itemId: "32217", quality: 4, isMeta: false, name: "Inscribed Pyrestone" },
  potent:      { itemId: "32221", quality: 4, isMeta: false, name: "Potent Pyrestone" },
  luminous:    { itemId: "32224", quality: 4, isMeta: false, name: "Luminous Pyrestone" },
  brilliant:   { itemId: "32210", quality: 4, isMeta: false, name: "Brilliant Lionseye" },
  quick:       { itemId: "35761", quality: 4, isMeta: false, name: "Quick Lionseye" },
  // Blue
  glowing:     { itemId: "32215", quality: 4, isMeta: false, name: "Glowing Shadowsong Amethyst" },
  shifting:    { itemId: "32212", quality: 4, isMeta: false, name: "Shifting Shadowsong Amethyst" },
  sovereign:   { itemId: "32211", quality: 4, isMeta: false, name: "Sovereign Shadowsong Amethyst" },
  royal:       { itemId: "32216", quality: 4, isMeta: false, name: "Royal Shadowsong Amethyst" },
  purified:    { itemId: "37503", quality: 4, isMeta: false, name: "Purified Shadowsong Amethyst" },
  solid:       { itemId: "32200", quality: 4, isMeta: false, name: "Solid Empyrean Sapphire" },
};

// Wowhead-based gem recommendations per spec: [meta, red, yellow, blue]
const SPEC_GEMS = {
  'Druid|Balance':         ['chaotic',    'runed',    'veiled',    'glowing'],
  'Druid|Bear':            ['relentless', 'delicate', 'glinting',  'solid'],
  'Druid|Cat':             ['relentless', 'delicate', 'glinting',  'shifting'],
  'Druid|Restoration':     ['bracing',    'teardrop', 'luminous',  'purified'],
  'Hunter|Beast Mastery':  ['relentless', 'delicate', 'wicked',    'shifting'],
  'Hunter|Marksmanship':   ['relentless', 'delicate', 'wicked',    'shifting'],
  'Hunter|Survival':       ['relentless', 'delicate', 'wicked',    'shifting'],
  'Mage|Arcane':           ['chaotic',    'runed',    'brilliant',  'glowing'],
  'Mage|Fire':             ['chaotic',    'runed',    'veiled',    'glowing'],
  'Mage|Frost':            ['chaotic',    'runed',    'veiled',    'glowing'],
  'Paladin|Holy':          ['insightful', 'teardrop', 'brilliant',  'royal'],
  'Paladin|Protection':    ['powerful',   'runed',    'veiled',    'solid'],
  'Paladin|Retribution':   ['relentless', 'bold',     'inscribed', 'sovereign'],
  'Priest|Holy':           ['insightful', 'teardrop', 'luminous',  'purified'],
  'Priest|Shadow':         ['mystical',   'runed',    'potent',    'glowing'],
  'Rogue|Dps':             ['relentless', 'delicate', 'glinting',  'shifting'],
  'Shaman|Elemental':      ['chaotic',    'runed',    'potent',    'glowing'],
  'Shaman|Enhancement':    ['relentless', 'bold',     'inscribed', 'sovereign'],
  'Shaman|Restoration':    ['bracing',    'teardrop', 'quick',     'royal'],
  'Warlock|Affliction':    ['chaotic',    'runed',    'veiled',    'glowing'],
  'Warlock|Demonology':    ['chaotic',    'runed',    'veiled',    'glowing'],
  'Warlock|Destruction':   ['chaotic',    'runed',    'veiled',    'glowing'],
  'Warrior|Arms':          ['relentless', 'bold',     'inscribed', 'sovereign'],
  'Warrior|Fury':          ['relentless', 'bold',     'inscribed', 'sovereign'],
  'Warrior|Protection':    ['powerful',   'solid',    'solid',     'solid'],
};

let totalChanged = 0;

for (const spec of data.specs) {
  const key = `${spec.className}|${spec.specName}`;
  const gemKeys = SPEC_GEMS[key];
  if (!gemKeys) {
    console.log(`⚠️  No gem mapping for ${key}`);
    continue;
  }

  for (const [pIdx, phase] of Object.entries(spec.phases)) {
    if (!phase.gems) continue;
    const p = parseInt(pIdx);
    const pool = p <= 2 ? RARE : EPIC;
    const newGems = gemKeys.map(k => ({ ...pool[k] }));
    
    const oldStr = JSON.stringify(phase.gems);
    const newStr = JSON.stringify(newGems);
    if (oldStr !== newStr) {
      console.log(`✏️  ${key} P${pIdx}: ${phase.gems.map(g=>g.name).join(', ')} → ${newGems.map(g=>g.name).join(', ')}`);
      phase.gems = newGems;
      totalChanged++;
    }
  }
}

console.log(`\n✅ Updated ${totalChanged} phase gem sets across ${data.specs.length} specs`);
fs.writeFileSync('data.json', JSON.stringify(data, null, 2));
console.log('💾 Saved data.json');
