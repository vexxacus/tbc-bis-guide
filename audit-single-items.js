const fs = require('fs');
const d = JSON.parse(fs.readFileSync('data.json', 'utf8'));
const skipSlots = new Set(['Tabard', 'Shirt', 'Ammo']);
const results = [];

for (const spec of d.specs) {
  for (const [pIdx, phase] of Object.entries(spec.phases)) {
    const slotMap = {};
    for (const item of phase.items) {
      if (skipSlots.has(item.slot)) continue;
      const s = item.slot;
      if (!slotMap[s]) slotMap[s] = [];
      slotMap[s].push(item);
    }
    for (const [slot, items] of Object.entries(slotMap)) {
      if (items.length <= 2) {
        const names = items.map(i => `${i.name} [${i.rank}]`).join(', ');
        const key = `${spec.className}-${spec.specName} P${pIdx}`;
        results.push({ key, slot, count: items.length, names });
      }
    }
  }
}

// Sort: 1-item slots first
results.sort((a, b) => a.count - b.count || a.key.localeCompare(b.key));

console.log(`\n=== Slots with only 1 item ===\n`);
for (const r of results.filter(r => r.count === 1)) {
  console.log(`⚠️  ${r.key} | ${r.slot} — ${r.names}`);
}

console.log(`\n=== Slots with only 2 items ===\n`);
for (const r of results.filter(r => r.count === 2)) {
  console.log(`📋 ${r.key} | ${r.slot} — ${r.names}`);
}

console.log(`\nTotal: ${results.filter(r => r.count === 1).length} single-item slots, ${results.filter(r => r.count === 2).length} two-item slots`);
