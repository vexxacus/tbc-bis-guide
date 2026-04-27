/**
 * fetch-unique-status.js
 * Checks Wowhead tooltip for each item that appears in both MH and OH
 * to determine if it has the "Unique" tag.
 * Outputs a list of confirmed Unique items that should be removed from OH.
 */
const https = require('https');
const fs = require('fs');

const d = JSON.parse(fs.readFileSync('data.json', 'utf8'));

// Collect all items that appear in both MH and OH (with names)
const dupeItems = new Map(); // itemId -> name
d.specs.forEach(spec => {
    Object.keys(spec.phases).forEach(p => {
        const items = spec.phases[p].items;
        const mhIds = new Set(items.filter(i => i.slot === 'Main Hand').map(i => i.itemId));
        items.filter(i => i.slot === 'Off Hand' && mhIds.has(i.itemId))
            .forEach(i => dupeItems.set(i.itemId, i.name));
    });
});

console.log(`Found ${dupeItems.size} items appearing in both MH and OH. Checking Wowhead...`);

function fetchTooltip(itemId) {
    return new Promise((resolve, reject) => {
        const url = `https://nether.wowhead.com/tooltip/item/${itemId}?locale=0`;
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

async function main() {
    const uniqueItems = [];
    const nonUniqueItems = [];
    const errors = [];
    const ids = [...dupeItems.keys()];

    for (let i = 0; i < ids.length; i++) {
        const itemId = ids[i];
        const name = dupeItems.get(itemId);
        try {
            const tooltip = await fetchTooltip(itemId);
            if (tooltip.error) {
                errors.push({ itemId, name, error: tooltip.error });
                console.log(`  [${i+1}/${ids.length}] ⚠️  ERROR: ${name} (${itemId}): ${tooltip.error}`);
            } else {
                const html = tooltip.tooltip || '';
                // Check for "Unique" or "Unique-Equipped" in tooltip HTML
                const isUnique = /Unique(?:-Equipped)?/i.test(html);
                if (isUnique) {
                    uniqueItems.push({ itemId, name });
                    console.log(`  [${i+1}/${ids.length}] ✅ UNIQUE: ${name} (${itemId})`);
                } else {
                    nonUniqueItems.push({ itemId, name });
                    console.log(`  [${i+1}/${ids.length}] ❌ NOT unique: ${name} (${itemId})`);
                }
            }
        } catch (e) {
            errors.push({ itemId, name, error: e.message });
            console.log(`  [${i+1}/${ids.length}] ⚠️  ERROR: ${name} (${itemId}): ${e.message}`);
        }
        // Rate limit
        if (i < ids.length - 1) await new Promise(r => setTimeout(r, 150));
    }

    console.log(`\n=== RESULTS ===`);
    console.log(`UNIQUE items (should be removed from OH when also in MH): ${uniqueItems.length}`);
    uniqueItems.forEach(i => console.log(`  ${i.itemId}  // ${i.name}`));
    console.log(`\nNON-UNIQUE items (OK to have in both MH and OH): ${nonUniqueItems.length}`);
    nonUniqueItems.forEach(i => console.log(`  ${i.itemId}  // ${i.name}`));
    if (errors.length) {
        console.log(`\nERRORS: ${errors.length}`);
        errors.forEach(i => console.log(`  ${i.itemId}  // ${i.name}: ${i.error}`));
    }

    // Save results
    const result = { uniqueItems, nonUniqueItems, errors };
    fs.writeFileSync('unique-check-results.json', JSON.stringify(result, null, 2));
    console.log('\nSaved to unique-check-results.json');
}

main().catch(console.error);
