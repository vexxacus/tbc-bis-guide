const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname,'..','data.json'),'utf8'));
const specIds = new Set();
for (const spec of data.specs) {
  for (const phase of Object.values(spec.phases)) {
    for (const item of phase.items || []) { if (item.itemId) specIds.add(item.itemId); }
    for (const gem of phase.gems || [])   { if (gem.itemId)  specIds.add(gem.itemId); }
  }
}
for (const id of Object.keys(data.gemSources)) specIds.add(id);
console.log('IDs använda i specs+gems:', specIds.size);

const iconsRaw = fs.readFileSync(path.join(__dirname,'..','js','icons.js'),'utf8');
const m = iconsRaw.match(/const ICONS\s*=\s*(\{[\s\S]+\});/);
const icons = JSON.parse(m[1]);
console.log('Ikoner i icons.js:', Object.keys(icons).length);

const missingInSpecs = [...specIds].filter(id => !icons[id]);
console.log('Spec-items som saknar ikon:', missingInSpecs.length);
if (missingInSpecs.length > 0) {
  console.log('Första 20:', missingInSpecs.slice(0,20).join(', '));
  fs.writeFileSync('/tmp/missing-spec-icons.json', JSON.stringify(missingInSpecs));
  console.log('Alla saknade IDs: /tmp/missing-spec-icons.json');
}
