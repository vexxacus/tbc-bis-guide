const fs = require('fs');
const d = JSON.parse(fs.readFileSync('data.json', 'utf8'));
const earlyPhases = ['0', '1', '2'];
const issues = [];

for (const spec of d.specs) {
  for (const pIdx of earlyPhases) {
    const phase = spec.phases[pIdx];
    if (phase == null || phase.gems == null) continue;
    for (const [slot, gem] of Object.entries(phase.gems)) {
      if (gem && gem.quality === 4) {
        issues.push({
          key: `${spec.className}-${spec.specName} P${pIdx}`,
          slot,
          name: gem.name,
          itemId: gem.itemId
        });
      }
    }
  }
}

if (issues.length === 0) {
  console.log('✅ No epic gems found in P0-P2!');
} else {
  console.log(`🔴 ${issues.length} epic gem(s) in P0-P2:\n`);
  for (const i of issues) {
    console.log(`  ${i.key} | slot ${i.slot}: ${i.name} (${i.itemId})`);
  }
}

// Also show what quality gems exist per phase for reference
console.log('\n--- Gem quality distribution per phase ---');
for (let p = 0; p <= 5; p++) {
  const quals = {};
  for (const spec of d.specs) {
    const phase = spec.phases[String(p)];
    if (phase == null || phase.gems == null) continue;
    for (const gem of Object.values(phase.gems)) {
      if (gem == null) continue;
      const q = gem.quality || '?';
      quals[q] = (quals[q] || 0) + 1;
    }
  }
  console.log(`P${p}: ${JSON.stringify(quals)}`);
}
