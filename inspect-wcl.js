const d = require('./scraper/output/wcl-test-rankings.json');
const r = d.rankings[0];

console.log('=== Player:', r.name, '===');
console.log('Class:', r.class, '| Spec:', r.spec);
console.log('Amount (DPS):', r.amount);
console.log('Duration:', r.duration, 'ms');
console.log('Start time:', new Date(r.startTime).toISOString());
console.log('Server:', JSON.stringify(r.server));
console.log('Faction:', r.faction);
console.log('Report:', JSON.stringify(r.report));

console.log('\n=== Talents ===');
console.log(JSON.stringify(r.talents, null, 2));

console.log('\n=== Gear (' + (r.gear || []).length + ' items) ===');
for (const g of (r.gear || [])) {
    console.log(JSON.stringify(g));
}

// Check a few more players for gems/enchants
console.log('\n=== Player #5 gear sample ===');
const r5 = d.rankings[4];
for (const g of (r5.gear || []).slice(0, 5)) {
    console.log(JSON.stringify(g));
}
