#!/usr/bin/env node
// Remove Main-Hand-only items from Off Hand slot in data.json
const fs = require('fs');

const ITEM_MAIN_HAND_ONLY = new Set([
    21673,23056,23554,23556,24453,27512,27538,27543,27741,27846,
    27868,27899,27905,27937,28216,28257,28297,28313,28392,28432,
    28433,28438,28439,28522,28584,28657,28767,28770,28771,28802,
    28931,29153,29155,29175,29185,29348,29353,29371,30058,30095,
    30108,30277,30723,30787,30832,30910,30918,31142,31304,31336,
    31342,32053,32237,32450,32451,32500,32660,32837,32944,32946,
    32963,32964,33283,33354,33467,33468,33495,33687,33737,33743,
    33763,34009,34176,34199,34331,34335,34336,34604,34611,34893,
    34895,34896,35014,35082,35102
]);

const data = JSON.parse(fs.readFileSync('./data.json','utf8'));
let removed = 0;

for (const spec of data.specs) {
  for (const [phase, phaseData] of Object.entries(spec.phases)) {
    const before = phaseData.items.length;
    phaseData.items = phaseData.items.filter(item => {
      if (item.slot === 'Off Hand' && ITEM_MAIN_HAND_ONLY.has(Number(item.itemId))) {
        console.log(`  REMOVE OH: ${item.itemId} ${item.name || '?'} from ${spec.className} ${spec.specName} ${phase}`);
        return false;
      }
      return true;
    });
    removed += before - phaseData.items.length;
  }
}

console.log(`\nRemoved ${removed} MH-only items from Off Hand slots`);
fs.writeFileSync('./data.json', JSON.stringify(data, null, 2));
console.log('Saved data.json');
