#!/usr/bin/env node
/**
 * Fetch weapon slot types for all WCL weapon items from Wowhead tooltips.
 * Generates ITEM_TWO_HAND and ITEM_SHIELD sets for js/item-restrictions.js
 */
const https = require('https');
const fs = require('fs');

// Load WCL data
eval(fs.readFileSync('js/wcl-data.js', 'utf8').replace('const WCL_DATA', 'globalThis.WCL_DATA'));

// Collect all unique weapon item IDs (MH + OH)
const weaponIds = new Set();
for (const phData of Object.values(WCL_DATA.phases)) {
    for (const specData of Object.values(phData)) {
        for (const it of (specData.slots['Main Hand'] || [])) weaponIds.add(it.id);
        for (const it of (specData.slots['Off Hand'] || [])) weaponIds.add(it.id);
    }
}
console.log(`Checking ${weaponIds.size} unique weapon items...`);

function fetchTooltip(itemId) {
    return new Promise((resolve, reject) => {
        const url = `https://nether.wowhead.com/tbc/tooltip/item/${itemId}`;
        https.get(url, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch { resolve(null); }
            });
        }).on('error', reject);
    });
}

async function main() {
    const twoHand = [];
    const shields = [];
    const ids = [...weaponIds].sort((a, b) => a - b);

    for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        try {
            const tt = await fetchTooltip(id);
            if (!tt || !tt.tooltip) continue;
            const html = tt.tooltip;
            // Check for "Two-Hand" in tooltip
            if (html.includes('Two-Hand')) {
                twoHand.push(id);
                process.stdout.write(`2H:${id} `);
            }
            // Check for "Shield" or "Off Hand" type shield
            if (html.includes('>Shield<') || html.includes('Shield</')) {
                shields.push(id);
                process.stdout.write(`SH:${id} `);
            }
        } catch (e) {
            console.error(`\nError fetching ${id}:`, e.message);
        }
        // Rate limit
        if (i % 20 === 19) await new Promise(r => setTimeout(r, 500));
    }

    console.log(`\n\nResults: ${twoHand.length} Two-Hand, ${shields.length} Shields`);
    console.log(`\nconst ITEM_TWO_HAND = new Set([${twoHand.join(',')}]);`);
    console.log(`const ITEM_SHIELD = new Set([${shields.join(',')}]);`);

    // Save to a cache file
    fs.writeFileSync('.weapon-types-cache.json', JSON.stringify({ twoHand, shields }, null, 2));
    console.log('\nSaved to .weapon-types-cache.json');
}

main().catch(console.error);
