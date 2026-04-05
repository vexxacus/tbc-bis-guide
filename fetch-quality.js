#!/usr/bin/env node
/**
 * fetch-quality.js
 * Fetches item quality (0-5) from Wowhead tooltip API for every unique item
 * in data.json + pvp-bis-data.json and writes js/item-quality.js
 *
 * Quality values:  0=Poor, 1=Common, 2=Uncommon, 3=Rare, 4=Epic, 5=Legendary
 *
 * Usage:  node fetch-quality.js
 */

const fs   = require('fs');
const path = require('path');
const https = require('https');

const DATA_PATH     = path.join(__dirname, 'data.json');
const PVP_DATA_PATH = path.join(__dirname, 'scraper', 'output', 'pvp-bis-data.json');
const OUT_PATH      = path.join(__dirname, 'js', 'item-quality.js');
const CACHE_PATH    = path.join(__dirname, '.quality-cache.json');

const WH_API = 'https://nether.wowhead.com/tbc/tooltip/item/';

// Rate limit: max requests per second
const RPS  = 8;
const DELAY = Math.ceil(1000 / RPS);

// ─── Collect all unique item IDs ───────────────────────────────────────
function collectUniqueItemIds() {
    const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    const ids = new Set();

    // Items from all specs/phases
    for (const spec of data.specs) {
        for (const phase of Object.values(spec.phases)) {
            for (const item of phase.items || []) ids.add(item.itemId);
        }
    }

    // Items from PvP scraped data
    if (fs.existsSync(PVP_DATA_PATH)) {
        const pvp = JSON.parse(fs.readFileSync(PVP_DATA_PATH, 'utf8'));
        for (const spec of Object.values(pvp.specs || {})) {
            for (const items of Object.values(spec.slots || {})) {
                for (const item of items) ids.add(String(item.id));
            }
        }
        console.log(`  📡 Included PvP item IDs`);
    }

    return [...ids].sort((a, b) => parseInt(a) - parseInt(b));
}

// ─── Fetch quality from Wowhead ────────────────────────────────────────
function fetchQuality(itemId) {
    return new Promise((resolve) => {
        const url = WH_API + itemId;
        https.get(url, { headers: { 'User-Agent': 'TBC-BiS-App/1.0' } }, res => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(body);
                    resolve(json.quality != null ? json.quality : null);
                } catch {
                    resolve(null);
                }
            });
        }).on('error', () => resolve(null));
    });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Main ───────────────────────────────────────────────────────────────
async function main() {
    console.log('💎 Item Quality Fetcher — Wowhead TBC\n');

    const allIds = collectUniqueItemIds();
    console.log(`📦 Found ${allIds.length} unique item IDs\n`);

    // Load cache
    let cache = {};
    if (fs.existsSync(CACHE_PATH)) {
        cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
        console.log(`📂 Loaded ${Object.keys(cache).length} cached qualities\n`);
    }

    // Figure out what we still need
    const needed = allIds.filter(id => cache[id] === undefined);
    console.log(`🌐 Need to fetch ${needed.length} qualities from Wowhead (${allIds.length - needed.length} cached)\n`);

    if (needed.length > 0) {
        const startTime = Date.now();
        let fetched = 0;
        let errors  = 0;

        for (let i = 0; i < needed.length; i++) {
            const id = needed[i];
            const q = await fetchQuality(id);
            if (q != null) {
                cache[id] = q;
                fetched++;
            } else {
                cache[id] = 4; // default to epic if API fails
                errors++;
            }
            await sleep(DELAY);

            // Progress every 25 items
            if ((i + 1) % 25 === 0 || i === needed.length - 1) {
                const pct = (((i + 1) / needed.length) * 100).toFixed(0);
                const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
                const eta = i + 1 < needed.length
                    ? (((Date.now() - startTime) / (i + 1)) * (needed.length - i - 1) / 1000).toFixed(0)
                    : 0;
                process.stdout.write(`\r  ⏳ ${i + 1}/${needed.length} (${pct}%) — ${elapsed}s elapsed, ~${eta}s remaining  `);

                // Save cache periodically
                fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
            }
        }

        console.log(`\n\n  ✅ Fetched ${fetched} qualities, ${errors} fallbacks\n`);
    }

    // Save final cache
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));

    // Build quality map — only IDs used in specs
    const usedIds = new Set();
    const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    for (const spec of data.specs) {
        for (const phase of Object.values(spec.phases)) {
            for (const item of phase.items || []) usedIds.add(item.itemId);
        }
    }
    if (fs.existsSync(PVP_DATA_PATH)) {
        const pvp = JSON.parse(fs.readFileSync(PVP_DATA_PATH, 'utf8'));
        for (const spec of Object.values(pvp.specs || {})) {
            for (const items of Object.values(spec.slots || {})) {
                for (const item of items) usedIds.add(String(item.id));
            }
        }
    }

    const qualityMap = {};
    let stats = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const id of usedIds) {
        if (cache[id] !== undefined) {
            qualityMap[id] = cache[id];
            stats[cache[id]] = (stats[cache[id]] || 0) + 1;
        }
    }

    // Write JS
    const jsContent = [
        `// Auto-generated item quality map — ${Object.keys(qualityMap).length} items`,
        `// Quality: 0=Poor 1=Common 2=Uncommon(green) 3=Rare(blue) 4=Epic(purple) 5=Legendary(orange)`,
        `const ITEM_QUALITY = ${JSON.stringify(qualityMap)};`,
        ''
    ].join('\n');

    fs.writeFileSync(OUT_PATH, jsContent);
    const sizeKB = (fs.statSync(OUT_PATH).size / 1024).toFixed(0);

    console.log(`✅ Written ${OUT_PATH} (${sizeKB} KB, ${Object.keys(qualityMap).length} items)`);
    console.log(`\n📊 Breakdown:`);
    console.log(`   Poor(0):      ${stats[0]}`);
    console.log(`   Common(1):    ${stats[1]}`);
    console.log(`   Uncommon(2):  ${stats[2]}`);
    console.log(`   Rare(3):      ${stats[3]}`);
    console.log(`   Epic(4):      ${stats[4]}`);
    console.log(`   Legendary(5): ${stats[5]}`);
}

main().catch(console.error);
