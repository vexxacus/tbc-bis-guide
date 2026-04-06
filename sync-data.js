#!/usr/bin/env node
/**
 * sync-data.js
 *
 * Syncs data.json → js/data.js
 *
 * Run this after any manual edits to data.json, or after parse-lua-data.js,
 * to ensure the web app gets the correct data.
 *
 * parse-lua-data.js no longer writes js/data.js directly — always run this
 * script after it to apply any pending manual fixes stored in data.json.
 */

const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, 'data.json');
const jsPath   = path.join(__dirname, 'js', 'data.js');

if (!fs.existsSync(dataPath)) {
    console.error('❌ data.json not found. Run parse-lua-data.js first.');
    process.exit(1);
}

const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

// Quick sanity check: warn if any slot's #1 item has rank="Alt"
const WEAPON_SLOTS = ['Main Hand', 'Off Hand', 'Two Hand', 'Ring', 'Trinket', 'Neck'];
let warnings = 0;
for (const s of data.specs) {
    for (const [ph, phData] of Object.entries(s.phases)) {
        for (const slot of WEAPON_SLOTS) {
            const items = phData.items.filter(i => i.slot === slot);
            if (!items.length) continue;
            const first = items[0];
            const r = (first.rank || '').toLowerCase();
            if (!r.startsWith('bis') && !r.includes('pvp')) {
                console.warn(`⚠️  ${s.className}-${s.specName} P${ph} | ${slot} #1: "${first.name}" has rank="${first.rank}" (should be BIS)`);
                warnings++;
            }
        }
    }
}

if (warnings > 0) {
    console.warn(`\n⚠️  ${warnings} rank warning(s) above — fix data.json before syncing if needed.\n`);
} else {
    console.log('✅ Rank sanity check passed — no #1 items with rank="Alt"');
}

// Write js/data.js
fs.mkdirSync(path.join(__dirname, 'js'), { recursive: true });
const jsOut = `// Auto-generated — do not edit directly. Edit data.json and run sync-data.js.\nconst DATA = ${JSON.stringify(data)};\n`;
fs.writeFileSync(jsPath, jsOut, 'utf8');

const kb = (fs.statSync(jsPath).size / 1024).toFixed(0);
console.log(`✅ js/data.js updated (${kb} KB) from data.json`);
