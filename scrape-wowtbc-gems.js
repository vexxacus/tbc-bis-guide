#!/usr/bin/env node
/**
 * scrape-wowtbc-gems.js — Scrape gem data from wowtbc.gg page-data.json
 *
 * wowtbc.gg stores all BIS data (items, enchants, gems per item per phase)
 * in Gatsby page-data.json files. This script fetches them for every spec,
 * extracts which gems are used, maps gem names → item IDs, and produces
 * an aggregated gem recommendation per spec/phase.
 *
 * Usage: node scrape-wowtbc-gems.js
 */

const https = require('https');
const fs = require('fs');

// ── Spec URL slugs on wowtbc.gg ──────────────────────────────────
const SPECS = [
    { slug: 'balance-druid', className: 'Druid', specName: 'Balance' },
    { slug: 'feral-dps-druid', className: 'Druid', specName: 'Cat' },
    { slug: 'feral-tank-druid', className: 'Druid', specName: 'Bear' },
    { slug: 'restoration-druid', className: 'Druid', specName: 'Restoration' },
    { slug: 'beast-mastery-hunter', className: 'Hunter', specName: 'Beast Mastery' },
    { slug: 'marksmanship-hunter', className: 'Hunter', specName: 'Marksmanship' },
    { slug: 'survival-hunter', className: 'Hunter', specName: 'Survival' },
    { slug: 'holy-paladin', className: 'Paladin', specName: 'Holy' },
    { slug: 'protection-paladin', className: 'Paladin', specName: 'Protection' },
    { slug: 'retribution-paladin', className: 'Paladin', specName: 'Retribution' },
    { slug: 'holy-priest', className: 'Priest', specName: 'Holy' },
    { slug: 'shadow-priest', className: 'Priest', specName: 'Shadow' },
    { slug: 'assassination-rogue', className: 'Rogue', specName: 'Dps' },  // wowtbc merges rogues differently
    { slug: 'combat-rogue', className: 'Rogue', specName: 'Dps' },
    { slug: 'elemental-shaman', className: 'Shaman', specName: 'Elemental' },
    { slug: 'enhancement-shaman', className: 'Shaman', specName: 'Enhancement' },
    { slug: 'restoration-shaman', className: 'Shaman', specName: 'Restoration' },
    { slug: 'arcane-mage', className: 'Mage', specName: 'Arcane' },
    { slug: 'fire-mage', className: 'Mage', specName: 'Fire' },
    { slug: 'frost-mage', className: 'Mage', specName: 'Frost' },
    { slug: 'affliction-warlock', className: 'Warlock', specName: 'Affliction' },
    { slug: 'demonology-warlock', className: 'Warlock', specName: 'Demonology' },
    { slug: 'destruction-warlock', className: 'Warlock', specName: 'Destruction' },
    { slug: 'arms-warrior', className: 'Warrior', specName: 'Arms' },
    { slug: 'fury-warrior', className: 'Warrior', specName: 'Fury' },
    { slug: 'protection-warrior', className: 'Warrior', specName: 'Protection' },
];

// Phase keys in wowtbc.gg data → our phase numbers
const PHASE_MAP = {
    'pre-bis': 0,
    't4': 1,
    't5': 2,
    't6': 3,
    'za': 4,
    'swp': 5,
};

// ── Gem name → itemId mapping ────────────────────────────────────
// We'll build this from our existing gemsData in page-data.json
// plus a static fallback for known gems
const GEM_NAME_TO_ID = {
    // Meta gems
    'Chaotic Skyfire Diamond': 34220,
    'Relentless Earthstorm Diamond': 32409,
    'Insightful Earthstorm Diamond': 25901,
    'Powerful Earthstorm Diamond': 25896,
    'Bracing Earthstorm Diamond': 25897,
    'Mystical Skyfire Diamond': 25893,
    'Ember Skyfire Diamond': 35503,
    'Thundering Skyfire Diamond': 32410,
    'Destructive Skyfire Diamond': 25890,
    'Brutal Earthstorm Diamond': 25899,
    'Tenacious Earthstorm Diamond': 25898,
    'Swift Skyfire Diamond': 35503, // alias
    'Eternal Earthstorm Diamond': 35501,
    'Swift Starfire Diamond': 28557,
    'Swift Windfire Diamond': 28556,
    'Potent Unstable Diamond': 32640,
    'Imbued Unstable Diamond': 32641,

    // Rare (Living Ruby / Dawnstone / Star of Elune / Noble Topaz / Nightseye / Talasite)
    'Delicate Living Ruby': 24028,
    'Teardrop Living Ruby': 24029,
    'Bold Living Ruby': 24027,
    'Runed Living Ruby': 24030,
    'Bright Living Ruby': 24031,
    'Subtle Living Ruby': 24032,
    'Gleaming Dawnstone': 24050,
    'Smooth Dawnstone': 24048,
    'Brilliant Dawnstone': 24047,
    'Thick Dawnstone': 24052,
    'Great Dawnstone': 31861,
    'Rigid Dawnstone': 24051,
    'Quick Dawnstone': 35315,
    'Mystic Dawnstone': 31860,
    'Solid Star of Elune': 24033,
    'Sparkling Star of Elune': 24035,
    'Lustrous Star of Elune': 24037,
    'Stormy Star of Elune': 24039,
    'Inscribed Noble Topaz': 24058,
    'Glinting Noble Topaz': 24061,
    'Potent Noble Topaz': 24059,
    'Veiled Noble Topaz': 31867,
    'Luminous Noble Topaz': 31868,
    'Wicked Noble Topaz': 31869,
    'Reckless Noble Topaz': 35316,
    'Sovereign Nightseye': 24054,
    'Shifting Nightseye': 24055,
    'Glowing Nightseye': 24056,
    'Balanced Nightseye': 31863,
    'Royal Nightseye': 24057,
    'Infused Nightseye': 31865,
    'Purified Shadow Pearl': 32836, // could also be Purified Nightseye
    'Purified Nightseye': 31862, // alias
    'Jagged Talasite': 24067,
    'Enduring Talasite': 24062,
    'Radiant Talasite': 35707, // hm, recheck
    'Dazzling Talasite': 24065,
    'Steady Talasite': 33782,
    'Forceful Talasite': 35318,
    'Regal Nightseye': 35707,

    // Epic (Crimson Spinel / Lionseye / Empyrean Sapphire / Pyrestone / Shadowsong Amethyst / Seaspray Emerald)
    'Delicate Crimson Spinel': 32193,
    'Runed Crimson Spinel': 32196,
    'Bold Crimson Spinel': 32195,
    'Teardrop Crimson Spinel': 32194,
    'Bright Crimson Spinel': 32197,
    'Subtle Crimson Spinel': 32198,
    'Rigid Lionseye': 32206,
    'Brilliant Lionseye': 32204,
    'Smooth Lionseye': 32205,
    'Gleaming Lionseye': 32207,
    'Thick Lionseye': 32208,
    'Great Lionseye': 32209,
    'Quick Lionseye': 35761,
    'Mystic Lionseye': 35760,
    'Solid Empyrean Sapphire': 32200,
    'Sparkling Empyrean Sapphire': 32201,
    'Lustrous Empyrean Sapphire': 32202,
    'Stormy Empyrean Sapphire': 32203,
    'Inscribed Pyrestone': 32217,
    'Glinting Pyrestone': 32220,
    'Potent Pyrestone': 32218,
    'Veiled Pyrestone': 32221,
    'Luminous Pyrestone': 32224,
    'Wicked Pyrestone': 32222,
    'Reckless Pyrestone': 35759,
    'Sovereign Shadowsong Amethyst': 32212,
    'Shifting Shadowsong Amethyst': 32210,
    'Glowing Shadowsong Amethyst': 32215,
    'Balanced Shadowsong Amethyst': 32213,
    'Royal Shadowsong Amethyst': 32211,
    'Purified Shadowsong Amethyst': 32214,
    'Infused Shadowsong Amethyst': 32216,
    'Jagged Seaspray Emerald': 35758,
    'Enduring Seaspray Emerald': 35757,
    'Steady Seaspray Emerald': 35756,
    'Forceful Seaspray Emerald': 35759, // check
    'Regal Shadowsong Amethyst': 32219,
};

// Which gem names are meta gems
const META_NAMES = new Set([
    'Chaotic Skyfire Diamond', 'Relentless Earthstorm Diamond', 'Insightful Earthstorm Diamond',
    'Powerful Earthstorm Diamond', 'Bracing Earthstorm Diamond', 'Mystical Skyfire Diamond',
    'Ember Skyfire Diamond', 'Thundering Skyfire Diamond', 'Destructive Skyfire Diamond',
    'Brutal Earthstorm Diamond', 'Tenacious Earthstorm Diamond', 'Eternal Earthstorm Diamond',
    'Swift Starfire Diamond', 'Swift Windfire Diamond', 'Potent Unstable Diamond',
    'Imbued Unstable Diamond',
]);

// ── HTTP helper ──────────────────────────────────────────────────
function fetchJSON(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                return fetchJSON(res.headers.location).then(resolve, reject);
            }
            let buf = '';
            res.on('data', d => buf += d);
            res.on('end', () => {
                try { resolve(JSON.parse(buf)); }
                catch (e) { reject(new Error(`JSON parse error for ${url}: ${e.message}\n${buf.slice(0, 200)}`)); }
            });
        }).on('error', reject);
    });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Main ─────────────────────────────────────────────────────────
async function main() {
    console.log('💎 Scraping gem data from wowtbc.gg...\n');

    const allGemData = {}; // { "Druid|Balance": { 0: [{name, count}], 1: [...], ... } }
    const unmappedGems = new Set();
    let totalSpecs = 0;
    let totalGems = 0;

    for (const spec of SPECS) {
        const url = `https://wowtbc.gg/page-data/bis-list/${spec.slug}/page-data.json`;
        process.stdout.write(`  Fetching ${spec.slug}...`);

        let data;
        try {
            data = await fetchJSON(url);
        } catch (e) {
            console.log(` ❌ ${e.message}`);
            continue;
        }

        const pageContext = data?.result?.pageContext;
        if (!pageContext || !pageContext.bisList) {
            const str = JSON.stringify(data).slice(0, 200);
            console.log(` ⚠️  Unexpected structure: ${str.slice(0, 100)}`);
            continue;
        }

        // Also extract gem name→id from gemsData if present
        if (pageContext.gemsData) {
            for (const gem of pageContext.gemsData) {
                if (gem.name && gem.url && !GEM_NAME_TO_ID[gem.name]) {
                    const match = gem.url.match(/item=(\d+)/);
                    if (match) GEM_NAME_TO_ID[gem.name] = parseInt(match[1]);
                }
            }
        }

        const items = pageContext.bisList;
        if (!items.length) {
            console.log(` ⚠️  No items found`);
            continue;
        }

        const specKey = `${spec.className}|${spec.specName}`;
        if (!allGemData[specKey]) allGemData[specKey] = {};

        // Extract gems from BIS items per phase
        for (const item of items) {
            for (const [phaseKey, phaseNum] of Object.entries(PHASE_MAP)) {
                const phaseData = item[phaseKey];
                if (!phaseData || !phaseData.bis) continue;
                if (!phaseData.gems || !phaseData.gems.length) continue;

                if (!allGemData[specKey][phaseNum]) allGemData[specKey][phaseNum] = {};

                for (const gem of phaseData.gems) {
                    if (!gem.name) continue;
                    const name = gem.name;
                    if (!allGemData[specKey][phaseNum][name]) {
                        allGemData[specKey][phaseNum][name] = 0;
                    }
                    allGemData[specKey][phaseNum][name]++;
                    totalGems++;

                    if (!GEM_NAME_TO_ID[name] && !META_NAMES.has(name)) {
                        unmappedGems.add(name);
                    }
                }
            }
        }

        const phases = Object.keys(allGemData[specKey] || {});
        console.log(` ✅ ${items.length} items, gems in phases: [${phases.join(',')}]`);
        totalSpecs++;
        await sleep(200); // Be polite
    }

    console.log(`\n📊 Scraped ${totalSpecs} specs, ${totalGems} gem placements`);

    if (unmappedGems.size) {
        console.log(`\n⚠️  Unmapped gem names (need itemId mapping):`);
        for (const name of [...unmappedGems].sort()) {
            console.log(`    "${name}"`);
        }
    }

    // ── Build per-spec per-phase gem recommendations ──
    // For each spec/phase, pick:
    //   - Most common meta gem
    //   - Top 3 most common non-meta gems (one per "color family")
    const result = {};

    for (const [specKey, phases] of Object.entries(allGemData)) {
        result[specKey] = {};
        for (const [phase, gemCounts] of Object.entries(phases)) {
            const sorted = Object.entries(gemCounts)
                .map(([name, count]) => ({ name, count, isMeta: META_NAMES.has(name) }))
                .sort((a, b) => b.count - a.count);

            const meta = sorted.find(g => g.isMeta);
            const regular = sorted.filter(g => !g.isMeta);

            // Take top 3 non-meta gems
            const topRegular = regular.slice(0, 3);

            const gems = [];
            if (meta) {
                const id = GEM_NAME_TO_ID[meta.name];
                gems.push({
                    itemId: String(id || 0),
                    quality: id ? (id >= 32000 ? 4 : 3) : 3,
                    isMeta: true,
                    name: meta.name,
                    count: meta.count,
                });
            }
            for (const g of topRegular) {
                const id = GEM_NAME_TO_ID[g.name];
                gems.push({
                    itemId: String(id || 0),
                    quality: id ? (id >= 32000 ? 4 : 3) : 3,
                    isMeta: false,
                    name: g.name,
                    count: g.count,
                });
            }

            result[specKey][phase] = gems;
        }
    }

    // ── Output ──
    const outPath = 'wowtbc-gem-data.json';
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
    console.log(`\n💾 Saved to ${outPath}`);

    // Print summary
    console.log('\n── Summary ──');
    for (const [specKey, phases] of Object.entries(result)) {
        for (const [phase, gems] of Object.entries(phases)) {
            const gemNames = gems.map(g => `${g.name} (${g.count})`).join(' | ');
            console.log(`  ${specKey} p${phase}: ${gemNames}`);
        }
    }
}

// ── Find items in the nested page-data JSON ──────────────────────
function findItems(data) {
    // Recursively search for arrays of objects that have slot/phase/bis fields
    const results = [];
    const queue = [data];

    while (queue.length) {
        const node = queue.shift();
        if (!node || typeof node !== 'object') continue;

        if (Array.isArray(node)) {
            // Check if this looks like an items array
            if (node.length > 5 && node[0]?.slot && node[0]?.phase && (node[0]?.['pre-bis'] || node[0]?.t4)) {
                return node; // Found it!
            }
            for (const item of node) queue.push(item);
        } else {
            for (const val of Object.values(node)) queue.push(val);
        }
    }

    return results;
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
