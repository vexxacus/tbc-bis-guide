eval(require('fs').readFileSync('js/wcl-data.js','utf8').replace('const WCL_DATA','globalThis.WCL_DATA'));
eval(require('fs').readFileSync('js/icons.js','utf8').replace('const ICONS','globalThis.ICONS'));
const allIds = new Set();
for (const phData of Object.values(WCL_DATA.phases))
  for (const specData of Object.values(phData))
    for (const slotItems of Object.values(specData.slots))
      for (const it of slotItems) allIds.add(it.id);
const missing = [...allIds].filter(id => !ICONS[id]);
console.log(allIds.size + ' items, ' + missing.length + ' missing icons');
if (missing.length) console.log(missing.join(','));
