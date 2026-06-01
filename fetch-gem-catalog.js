#!/usr/bin/env node
/**
 * fetch-gem-catalog.js
 * Builds a complete TBC gem catalog for the interactive /gems browser.
 *
 * For every gem itemId in js/gem-colors.js (GEM_COLORS), fetches name + quality
 * + stat text from the Wowhead tooltip API and writes:
 *   - gem-catalog.json : { "<itemId>": {name, color, quality, isMeta, statText, statTags, icon} }
 *   - gem-usage.json   : { "Class|Spec": { "<phase>": [{itemId, count}] } }  (from wowtbc-gem-data.json)
 *
 * Both files are deploy-served and consumed lazily by initGemBrowser() in js/app.js,
 * and gem-catalog.json is also read by prerender.js for the crawlable static list.
 *
 * Usage:  node fetch-gem-catalog.js
 */

const fs    = require('fs');
const path  = require('path');
const https = require('https');

const GEM_COLORS_PATH = path.join(__dirname, 'js', 'gem-colors.js');
const ICON_CACHE_PATH = path.join(__dirname, '.icon-cache.json');
const USAGE_SRC_PATH  = path.join(__dirname, 'wowtbc-gem-data.json');
const CATALOG_OUT     = path.join(__dirname, 'gem-catalog.json');
const USAGE_OUT       = path.join(__dirname, 'gem-usage.json');
const CACHE_PATH      = path.join(__dirname, '.gem-catalog-cache.json');

const WH_API = 'https://nether.wowhead.com/tbc/tooltip/item/';
const RPS    = 8;
const DELAY  = Math.ceil(1000 / RPS);
const sleep  = ms => new Promise(r => setTimeout(r, ms));

// color code (from GEM_COLORS) → display color name
const COLOR_NAME = {
    m: 'meta', r: 'red', y: 'yellow', b: 'blue',
    ry: 'orange', yr: 'orange', rb: 'purple', br: 'purple', yb: 'green', by: 'green'
};

// Stat keywords (matched against parsed stat text) → filter tag
const STAT_KEYWORDS = [
    ['Spell Damage', 'Spell Damage'], ['Healing', 'Healing'],
    ['Attack Power', 'Attack Power'], ['Strength', 'Strength'],
    ['Agility', 'Agility'], ['Stamina', 'Stamina'], ['Intellect', 'Intellect'],
    ['Spirit', 'Spirit'], ['Spell Penetration', 'Spell Penetration'],
    ['Hit Rating', 'Hit'], ['Spell Hit', 'Hit'],
    ['Critical Strike Rating', 'Crit'], ['Spell Critical', 'Crit'],
    ['Haste', 'Haste'], ['Defense', 'Defense'], ['Dodge', 'Dodge'],
    ['Resilience', 'Resilience'], ['mana per 5', 'MP5'], ['Resistance', 'Resistance']
];

function loadGemColors() {
    const src = fs.readFileSync(GEM_COLORS_PATH, 'utf8');
    const m = src.match(/const GEM_COLORS = (\{[\s\S]*?\});/);
    if (!m) throw new Error('Could not parse GEM_COLORS from js/gem-colors.js');
    return eval('(' + m[1] + ')');
}

function parseStatText(tooltip) {
    if (!tooltip) return '';
    const marker = 'nameDescStats';
    const i = tooltip.indexOf(marker);
    let s = i >= 0 ? tooltip.slice(i + marker.length) : tooltip;
    s = s.replace(/<[^>]*>/g, ' ').replace(/-->|<!--/g, ' ')
         .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
         .replace(/&#?\w+;/g, ' ').replace(/\s+/g, ' ').trim();
    // Stat text ends at the socket-match note / sell price.
    const cut = s.search(/"|Sell Price|Requires Level|Classes:/);
    s = (cut >= 0 ? s.slice(0, cut) : s).trim();
    return s;
}

function statTagsFor(statText) {
    const tags = new Set();
    for (const [kw, tag] of STAT_KEYWORDS) {
        if (statText.toLowerCase().includes(kw.toLowerCase())) tags.add(tag);
    }
    return [...tags];
}

function fetchItem(itemId) {
    return new Promise(resolve => {
        https.get(WH_API + itemId, { headers: { 'User-Agent': 'TBC-BiS-App/1.0' } }, res => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => {
                try {
                    const j = JSON.parse(body);
                    resolve({ name: j.name || null, quality: j.quality, icon: j.icon || null,
                              statText: parseStatText(j.tooltip) });
                } catch { resolve(null); }
            });
        }).on('error', () => resolve(null));
    });
}

function buildUsage() {
    if (!fs.existsSync(USAGE_SRC_PATH)) {
        console.warn('  ⚠ wowtbc-gem-data.json not found — gem-usage.json will be empty');
        return {};
    }
    const src = JSON.parse(fs.readFileSync(USAGE_SRC_PATH, 'utf8'));
    const out = {};
    for (const specKey of Object.keys(src)) {
        out[specKey] = {};
        for (const phase of Object.keys(src[specKey])) {
            out[specKey][phase] = (src[specKey][phase] || [])
                .map(g => ({ itemId: String(g.itemId), count: g.count }))
                .sort((a, b) => b.count - a.count);
        }
    }
    return out;
}

async function main() {
    console.log('💎 Gem Catalog Builder — Wowhead TBC\n');

    const GEM_COLORS = loadGemColors();
    const ids = Object.keys(GEM_COLORS).map(String);
    console.log(`📦 ${ids.length} gems in GEM_COLORS\n`);

    const icons = fs.existsSync(ICON_CACHE_PATH) ? JSON.parse(fs.readFileSync(ICON_CACHE_PATH, 'utf8')) : {};
    let cache = fs.existsSync(CACHE_PATH) ? JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')) : {};

    const needed = ids.filter(id => !cache[id]);
    console.log(`🌐 Fetching ${needed.length} from Wowhead (${ids.length - needed.length} cached)\n`);

    for (let i = 0; i < needed.length; i++) {
        const id = needed[i];
        const r = await fetchItem(id);
        cache[id] = r || { name: null, quality: 4, icon: null, statText: '' };
        await sleep(DELAY);
        if ((i + 1) % 20 === 0 || i === needed.length - 1) {
            process.stdout.write(`\r  ⏳ ${i + 1}/${needed.length}  `);
            fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
        }
    }
    if (needed.length) console.log('\n');
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));

    // Build catalog
    const catalog = {};
    let missing = 0, skipped = 0;
    for (const id of ids) {
        const c = cache[id] || {};
        const code = String(GEM_COLORS[id]);
        const colorName = COLOR_NAME[code] || 'red';
        const statText = c.statText || '';
        const isMeta = code === 'm';
        // Skip non-gem items mis-tagged in GEM_COLORS (weightstones, [PH] items, …):
        // real gems are meta gems or have a "+stat" line.
        if (!isMeta && !statText.startsWith('+')) { skipped++; continue; }
        if (!c.name) missing++;
        catalog[id] = {
            name:     c.name || `Gem ${id}`,
            color:    colorName,
            quality:  c.quality != null ? c.quality : 4,
            isMeta:   isMeta,
            statText: statText,
            statTags: statTagsFor(statText),
            icon:     icons[id] || c.icon || 'inv_misc_gem_01'
        };
    }
    fs.writeFileSync(CATALOG_OUT, JSON.stringify(catalog));
    console.log(`✅ ${CATALOG_OUT} — ${Object.keys(catalog).length} gems (${skipped} non-gems skipped, ${missing} without name)`);

    // Build usage
    const usage = buildUsage();
    fs.writeFileSync(USAGE_OUT, JSON.stringify(usage));
    console.log(`✅ ${USAGE_OUT} — ${Object.keys(usage).length} specs`);

    // Breakdown
    const byColor = {}, byQual = {};
    for (const g of Object.values(catalog)) {
        byColor[g.color] = (byColor[g.color] || 0) + 1;
        byQual[g.quality] = (byQual[g.quality] || 0) + 1;
    }
    console.log('\n📊 By color:', byColor);
    console.log('📊 By quality (2=unc 3=rare 4=epic):', byQual);
}

main().catch(console.error);
