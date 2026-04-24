const d = require('./data.json');
const all = new Map();
for (const s of d.specs) {
  for (const ph of Object.values(s.phases)) {
    if (!ph.gems) continue;
    for (const g of ph.gems) {
      if (g.quality === 3 && !g.isMeta) all.set(g.itemId, g.name);
    }
  }
}
const sorted = [...all.entries()].sort((a, b) => a[1].localeCompare(b[1]));
for (const [id, n] of sorted) console.log(id, n);
console.log('\nTotal:', sorted.length);
