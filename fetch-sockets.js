#!/usr/bin/env node
/**
 * fetch-sockets.js – Fetches socket information for all BiS items from Wowhead.
 *
 * Reads data.json, fetches tooltip HTML from Wowhead TBC API,
 * parses socket types (meta/red/yellow/blue) per item.
 * Outputs js/item-sockets.js with an ITEM_SOCKETS lookup.
 *
 * Uses a local cache (.socket-cache.json) to avoid re-fetching.
 *
 * Usage:  node fetch-sockets.js [--force]
 */

const fs   = require('fs');
const path = require('path');
const https = require('https');

const DATA_FILE   = path.join(__dirname, 'data.json');
const PVP_DATA_FILE = path.join(__dirname, 'scraper', 'output', 'pvp-bis-data.json');
const CACHE_FILE  = path.join(__dirname, '.socket-cache.json');
const OUTPUT_FILE = path.join(__dirname, 'js', 'item-sockets.js');
const API_BASE    = 'https://nether.wowhead.com/tbc/tooltip/item/';

const FORCE = process.argv.includes('--force');

// ── Helpers ──────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fetchJSON(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => {
                try { resolve(JSON.parse(body)); }
                catch (e) { reject(new Error(`JSON parse error for ${url}: ${e.message}`)); }
            });
        }).on('error', reject);
    });
}

function parseSocketsFromTooltip(html) {
    // Match socket-meta, socket-red, socket-yellow, socket-blue
    const re = /class="socket-(meta|red|yellow|blue)/g;
    const sockets = [];
    let m;
    while ((m = re.exec(html)) !== null) {
        sockets.push(m[1]);
    }
    return sockets;
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

    // Collect all unique item IDs (PvE)
    const itemIds = new Set();
    for (const spec of data.specs) {
        for (const [, phase] of Object.entries(spec.phases)) {
            for (const item of phase.items) {
                itemIds.add(String(item.itemId));
            }
        }
    }

    // Collect PvP item IDs
    if (fs.existsSync(PVP_DATA_FILE)) {
        const pvp = JSON.parse(fs.readFileSync(PVP_DATA_FILE, 'utf8'));
        for (const spec of Object.values(pvp.specs || {})) {
            for (const items of Object.values(spec.slots || {})) {
                for (const item of items) {
                    itemIds.add(String(item.id));
                    // Also add gem IDs (they may have sockets too, unlikely but consistent)
                    for (const gem of item.topGems || []) itemIds.add(String(gem.id));
                }
            }
        }
        console.log(`  📡 Included PvP item IDs`);
    }

    console.log(`📦 ${itemIds.size} unique items to check for sockets`);

    // Load cache
    let cache = {};
    if (!FORCE && fs.existsSync(CACHE_FILE)) {
        try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); }
        catch { cache = {}; }
        console.log(`📂 Cache: ${Object.keys(cache).length} items cached`);
    }

    // Fetch missing items
    const ids = [...itemIds].sort((a, b) => Number(a) - Number(b));
    let fetched = 0, errors = 0;

    for (const id of ids) {
        if (cache[id] !== undefined) continue;  // already cached (even if empty array)

        try {
            const json = await fetchJSON(`${API_BASE}${id}`);
            const tooltip = json.tooltip || '';
            const sockets = parseSocketsFromTooltip(tooltip);
            cache[id] = sockets;
            fetched++;

            if (sockets.length > 0) {
                process.stdout.write(`  ✅ ${id}: ${sockets.join(', ')}\n`);
            }

            // Rate limit: 50ms between requests
            if (fetched % 50 === 0) {
                fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
                console.log(`  💾 Saved progress (${fetched} fetched)`);
            }
            await sleep(50);
        } catch (e) {
            console.error(`  ❌ ${id}: ${e.message}`);
            errors++;
            await sleep(200);
        }
    }

    // Save cache
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
    console.log(`\n✅ Fetched ${fetched} items (${errors} errors)`);

    // Build output: only items WITH sockets
    const socketItems = {};
    let totalWithSockets = 0;
    const socketDistribution = {};

    for (const id of ids) {
        const sockets = cache[id];
        if (sockets && sockets.length > 0) {
            socketItems[id] = sockets;
            totalWithSockets++;
            const key = sockets.length;
            socketDistribution[key] = (socketDistribution[key] || 0) + 1;
        }
    }

    console.log(`\n💎 ${totalWithSockets} items have sockets`);
    console.log('   Distribution:', JSON.stringify(socketDistribution));

    // Count socket types
    let meta = 0, red = 0, yellow = 0, blue = 0;
    for (const sockets of Object.values(socketItems)) {
        for (const s of sockets) {
            if (s === 'meta') meta++;
            else if (s === 'red') red++;
            else if (s === 'yellow') yellow++;
            else if (s === 'blue') blue++;
        }
    }
    console.log(`   Types: meta=${meta} red=${red} yellow=${yellow} blue=${blue}`);

    // Write JS output
    // Format: ITEM_SOCKETS[itemId] = ['meta','yellow'] etc.
    let js = '// Auto-generated by fetch-sockets.js — DO NOT EDIT\n';
    js += `// ${totalWithSockets} items with sockets\n`;
    js += '// prettier-ignore\n';
    js += 'const ITEM_SOCKETS = {\n';
    for (const [id, sockets] of Object.entries(socketItems)) {
        const arr = sockets.map(s => {
            // Shorten: m=meta, r=red, y=yellow, b=blue
            return s[0];
        });
        js += `  ${id}:[${arr.map(a => `"${a}"`).join(',')}],\n`;
    }
    js += '};\n';

    fs.writeFileSync(OUTPUT_FILE, js);
    console.log(`\n📝 Written ${OUTPUT_FILE} (${(js.length/1024).toFixed(1)} KB)`);
}

main().catch(e => { console.error(e); process.exit(1); });
