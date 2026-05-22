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
const COHORT_OUTPUT = path.join(__dirname, 'js', 'wcl-cohorts.js');

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

// Compact a slots object → trim each slot to top N items, strip non-essential fields
function compactSlots(slots, topN) {
    const out = {};
    for (const [slot, items] of Object.entries(slots)) {
        out[slot] = items.slice(0, topN).map(item => ({
            id: item.id,
            name: item.name,
            popularity: item.popularity,
            quality: item.quality,
        }));
    }
    return out;
}

// Cohort data lives in a separate file (lazy-loaded) to keep initial JS small.
const cohortOutput = {
    meta: {
        source: 'WarcraftLogs TBC Classic',
        scrapedAt: data.meta.scrapedAt,
        description: 'Time-gated cohorts (Early/Mid/Late) per spec & phase. Equal-count thirds sorted by parse date — captures gear progression within a phase.',
    },
    phases: {},
};

for (const [phaseNum, phaseData] of Object.entries(data.phases)) {
    output.phases[phaseNum] = {};
    cohortOutput.phases[phaseNum] = {};

    for (const [specKey, specData] of Object.entries(phaseData.specs)) {
        output.phases[phaseNum][specKey] = {
            totalPlayers: specData.totalPlayers,
            metric: specData.metric,
            slots: compactSlots(specData.slots, 10),
        };

        // Cohorts go to the separate file (top 5 per slot)
        if (specData.cohorts) {
            const cohortSpec = {};
            for (const [name, cohort] of Object.entries(specData.cohorts)) {
                cohortSpec[name] = {
                    totalPlayers: cohort.totalPlayers,
                    dateRange: cohort.dateRange,
                    slots: compactSlots(cohort.slots, 5),
                };
            }
            cohortOutput.phases[phaseNum][specKey] = cohortSpec;
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

const cohortJs = `// Auto-generated from WCL scrape data — do not edit manually
// Generated: ${new Date().toISOString()}
// Loaded on demand when user opens the cohort selector (Early/Mid/Late).
window.WCL_COHORTS = ${JSON.stringify(cohortOutput)};
`;
fs.writeFileSync(COHORT_OUTPUT, cohortJs);
const cohortSizeKB = (Buffer.byteLength(cohortJs) / 1024).toFixed(0);
console.log(`✅ Written ${COHORT_OUTPUT} (${cohortSizeKB} KB)`);

// Stats
let totalSpecs = 0, totalItems = 0;
for (const phase of Object.values(output.phases)) {
    for (const spec of Object.values(phase)) {
        totalSpecs++;
        for (const items of Object.values(spec.slots)) totalItems += items.length;
    }
}
console.log(`   ${totalSpecs} spec/phase combos, ${totalItems} items total (combined)`);
