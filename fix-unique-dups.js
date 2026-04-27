/**
 * fix-unique-dups.js
 * Removes Unique/Unique-Equipped items from Off Hand when they already appear
 * in Main Hand for the same spec/phase. Uses results from fetch-unique-status.js.
 * 
 * After removal, if OH has no BIS item, the first Alt is promoted to BIS.
 */
const fs = require('fs');
const d = JSON.parse(fs.readFileSync('data.json', 'utf8'));
const results = JSON.parse(fs.readFileSync('unique-check-results.json', 'utf8'));

// Build set of confirmed Unique item IDs
const UNIQUE_IDS = new Set(results.uniqueItems.map(i => i.itemId));
console.log(`Loaded ${UNIQUE_IDS.size} confirmed Unique items\n`);

let totalRemoved = 0;
let totalPromoted = 0;

d.specs.forEach((spec, idx) => {
    Object.keys(spec.phases).forEach(phase => {
        const items = spec.phases[phase].items;
        const mhIds = new Set(items.filter(i => i.slot === 'Main Hand').map(i => i.itemId));

        const before = items.length;
        spec.phases[phase].items = items.filter(i => {
            if (i.slot === 'Off Hand' && mhIds.has(i.itemId) && UNIQUE_IDS.has(i.itemId)) {
                console.log(`  Remove: ${spec.className} ${spec.specName} P${phase} OH: ${i.name} (${i.itemId}) [${i.rank}]`);
                return false;
            }
            return true;
        });
        const removed = before - spec.phases[phase].items.length;
        totalRemoved += removed;

        if (removed > 0) {
            const ohItems = spec.phases[phase].items.filter(i => i.slot === 'Off Hand');
            const hasBis = ohItems.some(i => i.rank === 'BIS');
            if (ohItems.length > 0 && !hasBis) {
                ohItems[0].rank = 'BIS';
                totalPromoted++;
                console.log(`  Promoted: ${spec.className} ${spec.specName} P${phase} OH BIS: ${ohItems[0].name}`);
            }
        }
    });
});

console.log(`\nTotal removed: ${totalRemoved}`);
console.log(`Total promotions: ${totalPromoted}`);

fs.writeFileSync('data.json', JSON.stringify(d, null, 2));
console.log('Saved data.json');
