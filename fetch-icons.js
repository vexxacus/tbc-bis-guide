#!/usr/bin/env node
/**
 * fetch-icons.js
 * Fetches icon names from Wowhead's tooltip API for every unique item/gem
 * in data.json and writes an icon map to js/icons.js
 *
 * Usage:  node fetch-icons.js
 *
 * The output is a mapping:  { itemId: "icon_name", ... }
 * Icons are then displayed via Wowhead CDN:
 *   https://wow.zamimg.com/images/wow/icons/{size}/{icon_name}.jpg
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const DATA_PATH = path.join(__dirname, 'data.json');
const PVP_DATA_PATH = path.join(__dirname, 'scraper', 'output', 'pvp-bis-data.json');
const OUT_PATH = path.join(__dirname, 'js', 'icons.js');
const CACHE_PATH = path.join(__dirname, '.icon-cache.json');

const WH_API = 'https://nether.wowhead.com/tbc/tooltip/item/';

// Rate limit: max requests per second
const RPS = 8;
const DELAY = Math.ceil(1000 / RPS);

// ─── Load data ─────────────────────────────────────────────────────────
function collectUniqueItemIds() {
    const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    const ids = new Set();

    // Items from all specs/phases
    for (const spec of data.specs) {
        for (const phase of Object.values(spec.phases)) {
            for (const item of phase.items || []) {
                ids.add(item.itemId);
            }
            for (const gem of phase.gems || []) {
                ids.add(gem.itemId);
            }
        }
    }

    // Items from itemSources
    for (const id of Object.keys(data.itemSources)) {
        ids.add(id);
    }

    // Items from gemSources
    for (const id of Object.keys(data.gemSources)) {
        ids.add(id);
    }

    // Items from PvP scraped data
    if (fs.existsSync(PVP_DATA_PATH)) {
        const pvp = JSON.parse(fs.readFileSync(PVP_DATA_PATH, 'utf8'));
        for (const spec of Object.values(pvp.specs || {})) {
            for (const items of Object.values(spec.slots || {})) {
                for (const item of items) {
                    ids.add(String(item.id));
                    // Also add PvP gem IDs
                    for (const g of (item.topGems || [])) {
                        ids.add(String(g.id));
                    }
                }
            }
        }
        console.log(`  📡 Added PvP item & gem IDs from scraped data`);
    }

    return [...ids].sort((a, b) => parseInt(a) - parseInt(b));
}

// ─── Fetch single icon ─────────────────────────────────────────────────
function fetchIcon(itemId) {
    return new Promise((resolve, reject) => {
        const url = WH_API + itemId;
        https.get(url, { headers: { 'User-Agent': 'TBC-BiS-App/1.0' } }, res => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(body);
                    resolve(json.icon || null);
                } catch (e) {
                    resolve(null);
                }
            });
        }).on('error', e => {
            console.error(`  ✗ Error fetching ${itemId}: ${e.message}`);
            resolve(null);
        });
    });
}

// ─── Sleep ──────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Main ───────────────────────────────────────────────────────────────
async function main() {
    console.log('🎨 Icon Fetcher — Wowhead TBC\n');

    const allIds = collectUniqueItemIds();
    console.log(`📦 Found ${allIds.length} unique item/gem IDs\n`);

    // Load cache if exists
    let cache = {};
    if (fs.existsSync(CACHE_PATH)) {
        cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
        console.log(`📂 Loaded ${Object.keys(cache).length} cached icons\n`);
    }

    // Figure out what we still need
    const needed = allIds.filter(id => !cache[id]);
    console.log(`🌐 Need to fetch ${needed.length} icons from Wowhead (${allIds.length - needed.length} cached)\n`);

    if (needed.length > 0) {
        const startTime = Date.now();
        let fetched = 0;
        let errors = 0;

        // Process in batches for nicer progress
        const BATCH = 10;
        for (let i = 0; i < needed.length; i += BATCH) {
            const batch = needed.slice(i, i + BATCH);

            // Fire requests with small delays between each
            for (const id of batch) {
                const icon = await fetchIcon(id);
                if (icon) {
                    cache[id] = icon;
                    fetched++;
                } else {
                    cache[id] = 'inv_misc_questionmark'; // fallback
                    errors++;
                }
                await sleep(DELAY);
            }

            // Progress
            const done = Math.min(i + BATCH, needed.length);
            const pct = ((done / needed.length) * 100).toFixed(0);
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
            const eta = needed.length > done
                ? (((Date.now() - startTime) / done) * (needed.length - done) / 1000).toFixed(0)
                : 0;
            process.stdout.write(`\r  ⏳ ${done}/${needed.length} (${pct}%) — ${elapsed}s elapsed, ~${eta}s remaining  `);

            // Save cache periodically (every 50 items)
            if (done % 50 === 0 || done === needed.length) {
                fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
            }
        }

        console.log(`\n\n  ✅ Fetched ${fetched} icons, ${errors} fallbacks\n`);
    }

    // Save final cache
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));

    // Build icon map with only the IDs we actually use in specs
    const usedIds = new Set();
    const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    for (const spec of data.specs) {
        for (const phase of Object.values(spec.phases)) {
            for (const item of phase.items || []) usedIds.add(item.itemId);
            for (const gem of phase.gems || []) usedIds.add(gem.itemId);
        }
    }
    for (const id of Object.keys(data.gemSources)) usedIds.add(id);

    // Also include PvP item and gem IDs
    if (fs.existsSync(PVP_DATA_PATH)) {
        const pvp = JSON.parse(fs.readFileSync(PVP_DATA_PATH, 'utf8'));
        for (const spec of Object.values(pvp.specs || {})) {
            for (const items of Object.values(spec.slots || {})) {
                for (const item of items) {
                    usedIds.add(String(item.id));
                    for (const g of (item.topGems || [])) {
                        usedIds.add(String(g.id));
                    }
                }
            }
        }
    }

    // Filter cache to only needed icons
    const iconMap = {};
    for (const id of usedIds) {
        if (cache[id]) iconMap[id] = cache[id];
    }

    // Write JS module
    const jsContent = `// Auto-generated icon map — ${Object.keys(iconMap).length} items\n` +
        `// Usage: ICONS[itemId] → icon name for Wowhead CDN\n` +
        `// URL:   https://wow.zamimg.com/images/wow/icons/{size}/{icon}.jpg\n` +
        `//        sizes: tiny(15) small(18) medium(36) large(56)\n` +
        `const ICONS = ${JSON.stringify(iconMap)};\n`;

    fs.writeFileSync(OUT_PATH, jsContent);
    const sizeKB = (fs.statSync(OUT_PATH).size / 1024).toFixed(0);
    console.log(`✅ Written ${OUT_PATH} (${sizeKB} KB, ${Object.keys(iconMap).length} icons)`);
    console.log(`\n💡 Icons served from: https://wow.zamimg.com/images/wow/icons/medium/{name}.jpg`);
}

main().catch(console.error);
