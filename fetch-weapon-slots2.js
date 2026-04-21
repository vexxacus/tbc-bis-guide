#!/usr/bin/env node
const fs = require('fs');
const https = require('https');

const data = JSON.parse(fs.readFileSync('./data.json','utf8'));
const weaponIds = new Set();
for (const spec of data.specs) {
  for (const ph of Object.values(spec.phases)) {
    for (const item of ph.items) {
      if (['Main Hand','Off Hand'].includes(item.slot)) weaponIds.add(Number(item.itemId));
    }
  }
}
const ids = [...weaponIds].sort((a,b)=>a-b);
console.log(`Fetching slot type for ${ids.length} weapon items...`);

function fetchSlot(id) {
  return new Promise((resolve) => {
    https.get(`https://nether.wowhead.com/tooltip/item/${id}?dataEnv=5&locale=0`, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          const m = j.tooltip && j.tooltip.match(/<td>(Main Hand|One-Hand|Off Hand|Two-Hand|Ranged|Held In Off-hand)<\/td>/);
          resolve({ id, slot: m ? m[1] : 'unknown', name: j.name || '?' });
        } catch(e) { resolve({ id, slot: 'error', name: '?' }); }
      });
    }).on('error', () => resolve({ id, slot: 'error', name: '?' }));
  });
}

async function run() {
  const results = [];
  for (let i = 0; i < ids.length; i += 10) {
    const batch = ids.slice(i, i+10);
    results.push(...await Promise.all(batch.map(fetchSlot)));
    if (i % 50 === 0) process.stderr.write(`  ${i}/${ids.length}\n`);
  }

  const mainHandOnly = results.filter(r => r.slot === 'Main Hand');
  const oneHand = results.filter(r => r.slot === 'One-Hand');
  const offHandOnly = results.filter(r => r.slot === 'Off Hand');
  const heldOH = results.filter(r => r.slot === 'Held In Off-hand');
  const twoHand = results.filter(r => r.slot === 'Two-Hand');

  console.log(`\n"Main Hand" (MH-only): ${mainHandOnly.length}`);
  mainHandOnly.forEach(r => console.log(`  ${r.id} ${r.name}`));
  console.log(`\n"One-Hand" (either hand): ${oneHand.length}`);
  console.log(`"Off Hand" weapon: ${offHandOnly.length}`);
  offHandOnly.forEach(r => console.log(`  ${r.id} ${r.name}`));
  console.log(`"Held In Off-hand": ${heldOH.length}`);
  console.log(`"Two-Hand": ${twoHand.length}`);

  fs.writeFileSync('/tmp/weapon-slots.json', JSON.stringify(results, null, 2));
  const mhIds = mainHandOnly.map(r=>r.id).sort((a,b)=>a-b);
  console.log(`\nMH-only IDs (${mhIds.length}): ${JSON.stringify(mhIds)}`);
}
run();
