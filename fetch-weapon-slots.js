#!/usr/bin/env node
// Fetch inventoryType for all weapon items from Wowhead tooltip API
// inventoryType: 13=One-Hand, 21=Main Hand Only, 22=Off Hand Only, 17=Two-Hand, 15=Ranged, 26=Ranged
const fs = require('fs');
const https = require('https');

const data = JSON.parse(fs.readFileSync('./data.json','utf8'));
const weaponIds = new Set();
for (const spec of data.specs) {
  for (const ph of Object.values(spec.phases)) {
    for (const item of ph.items) {
      if (['Main Hand','Off Hand'].includes(item.slot)) {
        weaponIds.add(Number(item.itemId));
      }
    }
  }
}
const ids = [...weaponIds].sort((a,b)=>a-b);
console.log(`Fetching inventoryType for ${ids.length} weapon items...`);

function fetchTooltip(id) {
  return new Promise((resolve, reject) => {
    const url = `https://nether.wowhead.com/tooltip/item/${id}?dataEnv=4&locale=0`;
    https.get(url, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          // inventoryType from tooltip JSON
          resolve({ id, inventoryType: j.inventoryType, name: j.name });
        } catch(e) {
          resolve({ id, inventoryType: null, name: null, error: e.message });
        }
      });
    }).on('error', e => resolve({ id, inventoryType: null, name: null, error: e.message }));
  });
}

async function run() {
  const results = [];
  // batch 10 at a time
  for (let i = 0; i < ids.length; i += 10) {
    const batch = ids.slice(i, i+10);
    const r = await Promise.all(batch.map(fetchTooltip));
    results.push(...r);
    if (i % 50 === 0) process.stdout.write(`  ${i}/${ids.length}\n`);
  }

  const mainHandOnly = results.filter(r => r.inventoryType === 21);
  const offHandOnly = results.filter(r => r.inventoryType === 22);
  const oneHand = results.filter(r => r.inventoryType === 13);
  const twoHand = results.filter(r => r.inventoryType === 17);
  const ranged = results.filter(r => r.inventoryType === 15 || r.inventoryType === 26);
  const held = results.filter(r => r.inventoryType === 23); // held in off-hand (caster OH)

  console.log(`\nMain Hand Only (21): ${mainHandOnly.length}`);
  mainHandOnly.forEach(r => console.log(`  ${r.id} ${r.name}`));
  console.log(`\nOff Hand Only (22): ${offHandOnly.length}`);
  offHandOnly.forEach(r => console.log(`  ${r.id} ${r.name}`));
  console.log(`\nOne-Hand (13): ${oneHand.length}`);
  console.log(`Two-Hand (17): ${twoHand.length}`);
  console.log(`Ranged (15/26): ${ranged.length}`);
  console.log(`Held in Off-Hand (23): ${held.length}`);

  // Save full results
  fs.writeFileSync('/tmp/weapon-slots.json', JSON.stringify(results, null, 2));
  console.log('\nSaved to /tmp/weapon-slots.json');

  // Output the MH-only set for item-restrictions.js
  const mhIds = mainHandOnly.map(r=>r.id).sort((a,b)=>a-b);
  console.log(`\nITEM_MAIN_HAND_ONLY ids:\n${JSON.stringify(mhIds)}`);
}
run();
