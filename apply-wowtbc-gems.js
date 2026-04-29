#!/usr/bin/env node
/**
 * apply-wowtbc-gems.js — Apply wowtbc.gg gem data to data.json
 *
 * Reads wowtbc-gem-data.json (from scrape-wowtbc-gems.js) and updates
 * the gems array in each spec/phase of data.json.
 *
 * Usage: node apply-wowtbc-gems.js [--dry-run]
 */

const fs = require('fs');

const dryRun = process.argv.includes('--dry-run');

// Load data
const gemData = JSON.parse(fs.readFileSync('wowtbc-gem-data.json', 'utf8'));
const data = JSON.parse(fs.readFileSync('data.json', 'utf8'));

// Our spec keys in data.json are indexed (0-24)
// We need to map className+specName → data.json spec index
const specIndexMap = {};
for (const [idx, spec] of Object.entries(data.specs)) {
    const key = `${spec.className}|${spec.specName}`;
    specIndexMap[key] = idx;
}

console.log('Spec mapping:');
for (const [key, idx] of Object.entries(specIndexMap)) {
    console.log(`  ${idx}: ${key}`);
}

let updated = 0;
let skipped = 0;

for (const [specKey, phases] of Object.entries(gemData)) {
    const idx = specIndexMap[specKey];
    if (idx === undefined) {
        // Try Rogue|Dps mapping — our data has "Rogue|Dps" but wowtbc has separate specs
        // Both assassination and combat rogue map to Rogue|Dps
        console.log(`  ⚠️  No mapping for ${specKey}`);
        skipped++;
        continue;
    }

    const specData = data.specs[idx];

    for (const [phase, gems] of Object.entries(phases)) {
        if (!specData.phases[phase]) {
            console.log(`  ⚠️  No phase ${phase} for ${specKey}`);
            continue;
        }

        // Build the gems array in the same format as existing data
        // Trust wowtbc.gg data as-is: if no meta gem is listed, the BIS
        // items for this spec/phase have no meta socket (e.g. Feral Cat
        // uses Wolfshead Helm which has no sockets at all).
        const newGems = gems.map(g => ({
            itemId: g.itemId,
            quality: g.quality,
            isMeta: g.isMeta,
            name: g.name,
        }));

        const oldGems2 = specData.phases[phase].gems || [];
        const oldNames = oldGems2.map(g => g.name).join(', ');
        const newNames = newGems.map(g => g.name).join(', ');

        if (oldNames !== newNames) {
            console.log(`  📝 ${specKey} p${phase}:`);
            console.log(`     OLD: ${oldNames}`);
            console.log(`     NEW: ${newNames}`);
            updated++;
        }

        if (!dryRun) {
            specData.phases[phase].gems = newGems;
        }
    }
}

if (!dryRun) {
    fs.writeFileSync('data.json', JSON.stringify(data));
    console.log(`\n✅ Updated data.json (${updated} phase gem changes)`);
} else {
    console.log(`\n🔍 Dry run: ${updated} phase gem changes would be made`);
}

console.log(`   Skipped specs: ${skipped}`);
