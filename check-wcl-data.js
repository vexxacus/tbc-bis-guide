const d = require('./scraper/output/wcl-bis-data.json');
for (const [p, pd] of Object.entries(d.phases)) {
    console.log(`Phase ${p}: ${Object.keys(pd.specs).length} specs`);
}
const expected = [
    'Hunter|Beast Mastery', 'Druid|Feral Combat',
];
console.log('\nMissing from P1:');
for (const s of expected) {
    console.log(`  ${s}: ${d.phases[1].specs[s] ? 'FOUND' : 'MISSING'}`);
}
// Check total file size
const fs = require('fs');
const stat = fs.statSync('./scraper/output/wcl-bis-data.json');
console.log(`\nFile size: ${(stat.size / 1024).toFixed(0)} KB`);

// Quick sanity: P5 Sunwell Destro Lock top items
const swl = d.phases[5].specs['Warlock|Destruction'];
console.log(`\nP5 Destro Lock (${swl.totalPlayers} players):`);
for (const [slot, items] of Object.entries(swl.slots)) {
    if (items[0]) console.log(`  ${slot}: ${items[0].name} (${items[0].popularity}%)`);
}
