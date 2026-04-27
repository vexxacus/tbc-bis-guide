#!/usr/bin/env node
/**
 * wcl-to-frontend.js — Convert WCL scrape data to frontend-ready JS
 * 
 * Reads scraper/output/wcl-bis-data.json → writes js/wcl-data.js
 */

const fs = require('fs');
const path = require('path');

const INPUT = path.join(__dirname, 'scraper', 'output', 'wcl-bis-data.json');
const OUTPUT = path.join(__dirname, 'js', 'wcl-data.js');

const data = JSON.parse(fs.readFileSync(INPUT, 'utf8'));

// Build compact frontend structure:
// WCL_DATA = {
//   meta: { ... },
//   phases: {
//     1: {
//       "Warlock|Destruction": {
//         totalPlayers: 749,
//         metric: "dps",
//         slots: {
//           "Head": [{ id: 28963, name: "Voidheart Crown", popularity: 78, quality: "epic" }, ...],
//           ...
//         }
//       }
//     }
//   }
// }

const output = {
    meta: {
        source: 'WarcraftLogs TBC Classic',
        scrapedAt: data.meta.scrapedAt,
        description: 'Top parser gear from WarcraftLogs rankings, aggregated per slot',
    },
    phases: {},
};

for (const [phaseNum, phaseData] of Object.entries(data.phases)) {
    output.phases[phaseNum] = {};

    for (const [specKey, specData] of Object.entries(phaseData.specs)) {
        output.phases[phaseNum][specKey] = {
            totalPlayers: specData.totalPlayers,
            metric: specData.metric,
            slots: {},
        };

        for (const [slot, items] of Object.entries(specData.slots)) {
            output.phases[phaseNum][specKey].slots[slot] = items.map(item => ({
                id: item.id,
                name: item.name,
                popularity: item.popularity,
                quality: item.quality,
            }));
        }
    }
}

const js = `// Auto-generated from WCL scrape data — do not edit manually
// Generated: ${new Date().toISOString()}
const WCL_DATA = ${JSON.stringify(output)};
`;

fs.writeFileSync(OUTPUT, js);
const sizeKB = (Buffer.byteLength(js) / 1024).toFixed(0);
console.log(`✅ Written ${OUTPUT} (${sizeKB} KB)`);

// Stats
let totalSpecs = 0, totalItems = 0;
for (const phase of Object.values(output.phases)) {
    for (const spec of Object.values(phase)) {
        totalSpecs++;
        for (const items of Object.values(spec.slots)) totalItems += items.length;
    }
}
console.log(`   ${totalSpecs} spec/phase combos, ${totalItems} items total`);
