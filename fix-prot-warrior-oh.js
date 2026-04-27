const fs = require('fs');
const d = JSON.parse(fs.readFileSync('data.json', 'utf8'));
const prot = d.specs[24];

// Weapon itemIds that should NOT be in OH for prot warrior (they are 1H weapons, not shields)
const weaponIdsToRemove = {
  '1': ['28749', '28295'],  // King's Defender, Gladiator's Slicer
  '2': ['30103'],           // Fang of Vashj
  '3': ['32254'],           // The Brutalizer
};

let totalRemoved = 0;
Object.keys(weaponIdsToRemove).forEach(phase => {
  const items = prot.phases[phase].items;
  const before = items.length;
  prot.phases[phase].items = items.filter(i => {
    if (i.slot === 'Off Hand' && weaponIdsToRemove[phase].includes(i.itemId)) {
      console.log('Removing from Phase', phase, 'OH:', i.name, i.itemId);
      return false;
    }
    return true;
  });
  totalRemoved += before - prot.phases[phase].items.length;

  // If we removed BIS items, promote first Alt to BIS
  const ohItems = prot.phases[phase].items.filter(i => i.slot === 'Off Hand');
  const hasBis = ohItems.some(i => i.rank === 'BIS');
  if (hasBis === false && ohItems.length > 0) {
    const firstAlt = ohItems[0];
    firstAlt.rank = 'BIS';
    console.log('Promoted to BIS in Phase', phase, ':', firstAlt.name);
  }
});

console.log('Total removed:', totalRemoved);
fs.writeFileSync('data.json', JSON.stringify(d, null, 2));
console.log('Saved data.json');
