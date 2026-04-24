const d = JSON.parse(require('fs').readFileSync('data.json','utf8'));

// Find same itemId appearing as BIS in both MH and OH (excluding two-handers)
for (const spec of d.specs) {
  for (const [p, phase] of Object.entries(spec.phases)) {
    const mhBis = phase.items.filter(i => i.slot === 'Main Hand' && i.rank === 'BIS');
    const ohBis = phase.items.filter(i => i.slot === 'Off Hand' && i.rank === 'BIS');
    const twoHandIds = new Set(phase.items.filter(i => i.slot === 'Two Hand').map(i => i.itemId));

    for (const oh of ohBis) {
      const mhMatch = mhBis.find(i => i.itemId === oh.itemId);
      if (mhMatch && !twoHandIds.has(oh.itemId)) {
        console.log(`🚨 ${spec.className}-${spec.specName} P${p}: "${oh.name}" (${oh.itemId}) BIS in BOTH MH+OH (not a 2H)`);
      }
    }

    // Also check rings/trinkets for exact same item twice as BIS
    for (const slot of ['Ring', 'Trinket']) {
      const bisItems = phase.items.filter(i => i.slot === slot && i.rank === 'BIS');
      const seen = {};
      for (const item of bisItems) {
        if (seen[item.itemId]) {
          console.log(`🚨 ${spec.className}-${spec.specName} P${p}: "${item.name}" (${item.itemId}) appears TWICE as BIS ${slot}`);
        }
        seen[item.itemId] = true;
      }
    }
  }
}
