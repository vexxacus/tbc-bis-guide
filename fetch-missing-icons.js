const fs = require('fs');
const https = require('https');

eval(fs.readFileSync('js/wcl-data.js','utf8').replace('const WCL_DATA','globalThis.WCL_DATA'));
eval(fs.readFileSync('js/icons.js','utf8').replace('const ICONS','globalThis.ICONS'));

const allIds = new Set();
for (const phData of Object.values(WCL_DATA.phases))
  for (const specData of Object.values(phData))
    for (const slotItems of Object.values(specData.slots))
      for (const it of slotItems) allIds.add(it.id);

const missing = [...allIds].filter(id => !ICONS[id]);
console.log(`${missing.length} missing icons to fetch`);

function fetchIcon(id) {
  return new Promise((resolve) => {
    const url = `https://nether.wowhead.com/tbc/tooltip/item/${id}`;
    https.get(url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          if (j.icon) {
            console.log(`  ${id} => ${j.icon}`);
            resolve({ id, icon: j.icon });
          } else {
            console.log(`  ${id} => NO ICON`);
            resolve(null);
          }
        } catch(e) {
          console.log(`  ${id} => ERROR`);
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

(async () => {
  const results = {};
  for (let i = 0; i < missing.length; i += 5) {
    const batch = missing.slice(i, i + 5);
    const res = await Promise.all(batch.map(fetchIcon));
    for (const r of res) if (r) results[r.id] = r.icon;
    if (i + 5 < missing.length) await new Promise(r => setTimeout(r, 200));
  }
  
  console.log(`\nFetched ${Object.keys(results).length} icons`);
  
  // Read current icons.js and append
  let src = fs.readFileSync('js/icons.js', 'utf8');
  // Remove trailing }; and add new entries
  const insertPoint = src.lastIndexOf('};');
  const newEntries = Object.entries(results).map(([id, icon]) => `"${id}":"${icon}"`).join(',');
  src = src.substring(0, insertPoint) + ',' + newEntries + '};';
  fs.writeFileSync('js/icons.js', src);
  console.log('Updated js/icons.js');
})();
