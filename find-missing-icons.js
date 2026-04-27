const fs = require('fs');
const t = fs.readFileSync('js/pvp-data.js', 'utf8');
const d = JSON.parse(t.replace(/^const PVP_DATA = /, '').replace(/;$/, ''));
const i = fs.readFileSync('js/icons.js', 'utf8');
const m = i.match(/const ICONS = ({.*})/);
const icons = JSON.parse(m[1]);
const missing = new Set();
for (const spec of Object.values(d.specs)) {
  for (const items of Object.values(spec.slots)) {
    for (const item of items) {
      if (!icons[String(item.id)]) missing.add(item.id);
    }
  }
}
console.log('Missing icons:', missing.size);
console.log([...missing].join(','));
