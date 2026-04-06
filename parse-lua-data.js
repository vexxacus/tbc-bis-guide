#!/usr/bin/env node
/**
 * Lua → JSON Parser
 * Extracts BiS data, item sources, gem sources, and enchant sources
 * from the WoW addon Lua files into a single JSON data file.
 */

const fs = require('fs');
const path = require('path');

const GUIDES_DIR = path.join(__dirname, '..', 'bis listor - loot', 'LoonBestInSlot', 'Guides');
const DB_DIR = path.join(__dirname, '..', 'bis listor - loot', 'LoonBestInSlot', 'DB');

// ─── Parse Item Sources ────────────────────────────────────────────────
function parseItemSources() {
    const file = fs.readFileSync(path.join(DB_DIR, 'ItemSources.lua'), 'utf8');
    const sources = {};
    const regex = /\[(\d+)\]\s*=\s*\{\s*Name\s*=\s*"([^"]*)"[^}]*SourceType\s*=\s*LBIS\.L\["([^"]*)"\][^}]*Source\s*=\s*(?:LBIS\.L\["([^"]*)"\]|"([^"]*)")[^}]*SourceNumber\s*=\s*"([^"]*)"[^}]*SourceLocation\s*=\s*(?:LBIS\.L\["([^"]*)"\]|"([^"]*)")[^}]*SourceFaction\s*=\s*"([^"]*)"/g;
    let m;
    while ((m = regex.exec(file)) !== null) {
        sources[m[1]] = {
            name: m[2],
            sourceType: m[3],
            source: m[4] || m[5] || '',
            sourceNumber: m[6],
            sourceLocation: m[7] || m[8] || '',
            faction: m[9]
        };
    }
    console.log(`  Parsed ${Object.keys(sources).length} item sources`);
    return sources;
}

// ─── Parse Gem Sources ─────────────────────────────────────────────────
function parseGemSources() {
    const file = fs.readFileSync(path.join(DB_DIR, 'GemSources.lua'), 'utf8');
    const gems = {};
    const regex = /\[(\d+)\]\s*=\s*\{\s*Name\s*=\s*"([^"]*)"[^}]*Source\s*=\s*(?:LBIS\.L\["([^"]*)"\]|"([^"]*)")[^}]*SourceLocation\s*=\s*(?:LBIS\.L\["([^"]*)"\]|"([^"]*)")/g;
    let m;
    while ((m = regex.exec(file)) !== null) {
        gems[m[1]] = {
            name: m[2],
            source: m[3] || m[4] || '',
            sourceLocation: m[5] || m[6] || ''
        };
    }
    console.log(`  Parsed ${Object.keys(gems).length} gem sources`);
    return gems;
}

// ─── Parse Enchant Sources ─────────────────────────────────────────────
function parseEnchantSources() {
    const file = fs.readFileSync(path.join(DB_DIR, 'EnchantSources.lua'), 'utf8');
    const enchants = {};
    const regex = /\[(\d+)\]\s*=\s*\{\s*Name\s*=\s*"([^"]*)"[^}]*Source\s*=\s*(?:LBIS\.L\["([^"]*)"\]|"([^"]*)")[^}]*SourceLocation\s*=\s*(?:LBIS\.L\["([^"]*)"\]|"([^"]*)")/g;
    let m;
    while ((m = regex.exec(file)) !== null) {
        enchants[m[1]] = {
            name: m[2],
            source: m[3] || m[4] || '',
            sourceLocation: m[5] || m[6] || ''
        };
    }
    console.log(`  Parsed ${Object.keys(enchants).length} enchant sources`);
    return enchants;
}

// ─── Parse a single Guide file ─────────────────────────────────────────
function parseGuideFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const fileName = path.basename(filePath, '.lua');

    // Extract class and spec from RegisterSpec calls
    const specMap = {};
    const regSpecRegex = /local\s+(spec\d+)\s*=\s*LBIS:RegisterSpec\(LBIS\.L\["([^"]*)"\],\s*LBIS\.L\["([^"]*)"\],\s*"(\d+)"\)/g;
    let m;
    while ((m = regSpecRegex.exec(content)) !== null) {
        specMap[m[1]] = {
            className: m[2],
            specName: m[3],
            phase: parseInt(m[4])
        };
    }

    if (Object.keys(specMap).length === 0) return null;

    const firstSpec = Object.values(specMap)[0];
    const className = firstSpec.className;
    const specName = firstSpec.specName;

    // Parse gems per phase
    const gems = {};
    const gemRegex = /LBIS:AddGem\((spec\d+),\s*"(\d+)",\s*"(\d+)",\s*"(True|False)"\)\s*--(.+)?/g;
    while ((m = gemRegex.exec(content)) !== null) {
        const phase = specMap[m[1]]?.phase ?? 0;
        if (!gems[phase]) gems[phase] = [];
        gems[phase].push({
            itemId: m[2],
            quality: parseInt(m[3]),
            isMeta: m[4] === 'True',
            name: (m[5] || '').trim()
        });
    }

    // Parse enchants per phase
    const enchants = {};
    const enchRegex = /LBIS:AddEnchant\((spec\d+),\s*"(\d+)",\s*LBIS\.L\["([^"]*)"\]\)/g;
    while ((m = enchRegex.exec(content)) !== null) {
        const phase = specMap[m[1]]?.phase ?? 0;
        if (!enchants[phase]) enchants[phase] = [];
        enchants[phase].push({
            spellId: m[2],
            slot: m[3]
        });
    }

    // Parse items per phase
    const items = {};
    const itemRegex = /LBIS:AddItem\((spec\d+),\s*"(\d+)",\s*LBIS\.L\["([^"]*)"\],\s*"([^"]*)"\)\s*--(.+)?/g;
    while ((m = itemRegex.exec(content)) !== null) {
        const phase = specMap[m[1]]?.phase ?? 0;
        if (!items[phase]) items[phase] = [];
        items[phase].push({
            itemId: m[2],
            slot: m[3],
            rank: m[4],
            name: (m[5] || '').trim()
        });
    }

    return {
        className,
        specName,
        phases: Object.keys(specMap).reduce((acc, key) => {
            const p = specMap[key].phase;
            acc[p] = {
                items: items[p] || [],
                gems: gems[p] || gems[0] || [],
                enchants: enchants[p] || enchants[0] || []
            };
            return acc;
        }, {})
    };
}

// ─── Main ──────────────────────────────────────────────────────────────
function main() {
    console.log('🔧 Parsing Lua addon data...\n');

    console.log('📦 Item Sources:');
    const itemSources = parseItemSources();

    console.log('💎 Gem Sources:');
    const gemSources = parseGemSources();

    console.log('✨ Enchant Sources:');
    const enchantSources = parseEnchantSources();

    console.log('\n📋 Guide Files:');
    const guideFiles = fs.readdirSync(GUIDES_DIR).filter(f => f.endsWith('.lua'));
    const specs = [];

    for (const file of guideFiles) {
        const result = parseGuideFile(path.join(GUIDES_DIR, file));
        if (result) {
            specs.push(result);
            const phaseCount = Object.keys(result.phases).length;
            const itemCount = Object.values(result.phases).reduce((s, p) => s + p.items.length, 0);
            console.log(`  ✅ ${result.className} ${result.specName}: ${phaseCount} phases, ${itemCount} items`);
        }
    }

    // Build the final data object
    const data = {
        generatedAt: new Date().toISOString(),
        itemSources,
        gemSources,
        enchantSources,
        specs
    };

    // Write output
    const outPath = path.join(__dirname, 'data.json');
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
    console.log(`\n✅ Written to ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(0)} KB)`);

    // NOTE: js/data.js is no longer written here.
    // Run `node sync-data.js` (or `npm run sync`) after this script to apply
    // any manual fixes in data.json and update js/data.js for the web app.
    console.log(`\n👉  Next step: run  node sync-data.js  to update js/data.js`);
}

main();
