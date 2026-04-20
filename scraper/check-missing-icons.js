const data = require('../data.json');
const fs = require('fs');
const path = require('path');
const ids = new Set();
for (const spec of data.specs) {
  for (const phase of Object.values(spec.phases)) {
    for (const item of phase.items || []) ids.add(item.itemId);
    for (const gem of phase.gems || []) ids.add(gem.itemId);
  }
}
for (const id of Object.keys(data.itemSources)) ids.add(id);
for (const id of Object.keys(data.gemSources)) ids.add(id);

const iconsRaw = fs.readFileSync(path.join(__dirname,'..','js','icons.js'),'utf8');
const match = iconsRaw.match(/const ICONS\s*=\s*(\{[\s\S]+\});/);
const icons = JSON.parse(match[1]);

const missing = [...ids].filter(id => !icons[id]);
console.log('Totalt item-IDs i data.json:', ids.size);
console.log('Befintliga ikoner:', Object.keys(icons).length);
console.log('Saknar ikon:', missing.length);
if (missing.length > 0) {
  console.log('Första 30:', missing.slice(0,30).join(', '));
  fs.writeFileSync('/tmp/missing-icons.json', JSON.stringify(missing));
}
