#!/usr/bin/env node
/**
 * wcl-scrape.js — Scrape top parser gear from WarcraftLogs TBC Classic
 * 
 * For each TBC raid phase, fetches top 100 rankings per spec per boss,
 * aggregates gear popularity, and outputs a structured JSON file.
 *
 * Usage:  node scraper/wcl-scrape.js [--phase 1] [--spec "Warlock|Destruction"] [--pages 2]
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// ── Config ─────────────────────────────────────────────────────────
const envPath = path.join(__dirname, '.env');
const env = {};
fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k && v.length) env[k.trim()] = v.join('=').trim();
});

const CLIENT_ID = env.WCL_CLIENT_ID;
const CLIENT_SECRET = env.WCL_CLIENT_SECRET;
const API_URL = 'https://classic.warcraftlogs.com/api/v2/client';
const TOKEN_URL = 'https://www.warcraftlogs.com/oauth/token';

const OUTPUT_DIR = path.join(__dirname, 'output');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'wcl-bis-data.json');
const CACHE_DIR = path.join(OUTPUT_DIR, 'wcl-cache');
const DELAY_MS = 350; // ~3 req/s to be safe

// ── TBC Phase → Zone → Encounters mapping ─────────────────────────
// Partition numbers are GLOBAL TBC phases (P1=1, P2=2, P3=4, P5=6).
// "Current content" = the partition when that raid was the latest tier.
// We use the frozen zone IDs (1007-1013) which have full partition history.
const TBC_PHASES = [
    {
        phase: 1,
        label: 'Phase 1 — Karazhan / Gruul / Magtheridon',
        zones: [
            {
                zoneId: 1007, name: 'Karazhan', partition: 1,
                encounters: [
                    { id: 661, name: 'Prince Malchezaar' },
                    { id: 656, name: 'The Curator' },
                    { id: 658, name: 'Shade of Aran' },
                ],
            },
            {
                zoneId: 1008, name: 'Gruul / Magtheridon', partition: 1,
                encounters: [
                    { id: 650, name: 'Gruul the Dragonkiller' },
                    { id: 651, name: 'Magtheridon' },
                ],
            },
        ],
    },
    {
        phase: 2,
        label: 'Phase 2 — SSC / TK',
        zones: [
            {
                zoneId: 1010, name: 'SSC / TK', partition: 2, // P2 = when SSC/TK was current
                encounters: [
                    { id: 628, name: 'Lady Vashj' },
                    { id: 627, name: 'Morogrim Tidewalker' },
                    { id: 733, name: "Kael'thas Sunstrider" },
                    { id: 731, name: 'Void Reaver' },
                ],
            },
        ],
    },
    {
        phase: 3,
        label: 'Phase 3 — BT / Hyjal',
        zones: [
            {
                zoneId: 1011, name: 'BT / Hyjal', partition: 4, // P3 = partition 4
                encounters: [
                    { id: 609, name: 'Illidan Stormrage' },
                    { id: 622, name: 'Archimonde' },
                    { id: 605, name: 'Gurtogg Bloodboil' },
                ],
            },
        ],
    },
    {
        phase: 4,
        label: 'Phase 4 — BT / Hyjal / ZA',
        zones: [
            {
                zoneId: 1011, name: 'BT / Hyjal', partition: 5, // P3.5/P4 = partition 5
                encounters: [
                    { id: 609, name: 'Illidan Stormrage' },
                    { id: 622, name: 'Archimonde' },
                    { id: 605, name: 'Gurtogg Bloodboil' },
                ],
            },
            {
                zoneId: 1012, name: "Zul'Aman", partition: 5, // P3.5/P4 = partition 5
                encounters: [
                    { id: 1194, name: 'Daakara' },
                ],
            },
        ],
    },
    {
        phase: 5,
        label: 'Phase 5 — Sunwell Plateau',
        zones: [
            {
                zoneId: 1013, name: 'Sunwell Plateau', partition: 6, // P5 = partition 6
                encounters: [
                    { id: 725, name: 'Brutallus' },
                    { id: 728, name: "M'uru" },
                    { id: 729, name: "Kil'jaeden" },
                ],
            },
        ],
    },
];

// ── TBC Specs ──────────────────────────────────────────────────────
// WCL class/spec name slugs
const TBC_SPECS = [
    { className: 'Warrior', specName: 'Arms', metric: 'dps' },
    { className: 'Warrior', specName: 'Fury', metric: 'dps' },
    { className: 'Warrior', specName: 'Protection', metric: 'dps' },
    { className: 'Paladin', specName: 'Holy', metric: 'hps' },
    { className: 'Paladin', specName: 'Protection', metric: 'dps' },
    { className: 'Paladin', specName: 'Retribution', metric: 'dps' },
    { className: 'Hunter', specName: 'Beast Mastery', metric: 'dps' },
    { className: 'Hunter', specName: 'BeastMastery', displaySpec: 'Beast Mastery', metric: 'dps' },
    { className: 'Hunter', specName: 'Marksmanship', metric: 'dps' },
    { className: 'Hunter', specName: 'Survival', metric: 'dps' },
    { className: 'Rogue', specName: 'Combat', metric: 'dps' },
    { className: 'Rogue', specName: 'Assassination', metric: 'dps' },
    { className: 'Rogue', specName: 'Subtlety', metric: 'dps' },
    { className: 'Priest', specName: 'Holy', metric: 'hps' },
    { className: 'Priest', specName: 'Discipline', metric: 'hps' },
    { className: 'Priest', specName: 'Shadow', metric: 'dps' },
    { className: 'Shaman', specName: 'Elemental', metric: 'dps' },
    { className: 'Shaman', specName: 'Enhancement', metric: 'dps' },
    { className: 'Shaman', specName: 'Restoration', metric: 'hps' },
    { className: 'Mage', specName: 'Arcane', metric: 'dps' },
    { className: 'Mage', specName: 'Fire', metric: 'dps' },
    { className: 'Mage', specName: 'Frost', metric: 'dps' },
    { className: 'Warlock', specName: 'Affliction', metric: 'dps' },
    { className: 'Warlock', specName: 'Demonology', metric: 'dps' },
    { className: 'Warlock', specName: 'Destruction', metric: 'dps' },
    { className: 'Druid', specName: 'Balance', metric: 'dps' },
    { className: 'Druid', specName: 'Feral', metric: 'dps' },
    { className: 'Druid', specName: 'Guardian', metric: 'dps' },
    { className: 'Druid', specName: 'Restoration', metric: 'hps' },
];

// ── WCL gear slot index → slot name ───────────────────────────────
const SLOT_MAP = {
    0: 'Head', 1: 'Neck', 2: 'Shoulders', 3: 'Shirt',
    4: 'Chest', 5: 'Waist', 6: 'Legs', 7: 'Feet',
    8: 'Wrists', 9: 'Hands', 10: 'Ring 1', 11: 'Ring 2',
    12: 'Trinket 1', 13: 'Trinket 2', 14: 'Back',
    15: 'Main Hand', 16: 'Off Hand', 17: 'Ranged',
};

// Skip: Shirt (3), Tabard (18 if it exists)
const SKIP_SLOTS = new Set([3]);

// ── HTTP helpers ───────────────────────────────────────────────────
function httpPost(url, body, headers = {}) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const data = typeof body === 'string' ? body : JSON.stringify(body);
        const opts = {
            hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
            headers: {
                'Content-Type': headers['Content-Type'] || 'application/json',
                'Content-Length': Buffer.byteLength(data),
                ...headers,
            },
        };
        const req = https.request(opts, res => {
            let buf = '';
            res.on('data', d => buf += d);
            res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { resolve(buf); } });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Auth ───────────────────────────────────────────────────────────
async function getToken() {
    const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
    const resp = await httpPost(TOKEN_URL, 'grant_type=client_credentials', {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${auth}`,
    });
    if (!resp.access_token) { console.error('Auth failed:', resp); process.exit(1); }
    return resp.access_token;
}

// ── GraphQL ────────────────────────────────────────────────────────
async function gql(token, query) {
    const resp = await httpPost(API_URL, { query }, { 'Authorization': `Bearer ${token}` });
    if (resp.errors) {
        console.error('  GQL error:', resp.errors[0]?.message || JSON.stringify(resp.errors).slice(0, 200));
        return null;
    }
    return resp.data;
}

// ── Cache ──────────────────────────────────────────────────────────
function cacheKey(encId, partition, className, specName, page) {
    return `${encId}_p${partition}_${className}_${specName}_pg${page}`.replace(/\s+/g, '-');
}

function loadCache(key) {
    const p = path.join(CACHE_DIR, key + '.json');
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    return null;
}

function saveCache(key, data) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(path.join(CACHE_DIR, key + '.json'), JSON.stringify(data));
}

// ── Fetch rankings ─────────────────────────────────────────────────
async function fetchRankings(token, encId, partition, className, specName, metric, page) {
    const key = cacheKey(encId, partition, className, specName, page);
    const cached = loadCache(key);
    if (cached) return cached;

    const metricStr = metric === 'hps' ? 'hps' : 'dps';
    const data = await gql(token, `{
        worldData {
            encounter(id: ${encId}) {
                characterRankings(
                    className: "${className}"
                    specName: "${specName}"
                    metric: ${metricStr}
                    includeCombatantInfo: true
                    partition: ${partition}
                    page: ${page}
                )
            }
        }
    }`);

    const rankings = data?.worldData?.encounter?.characterRankings;
    if (rankings) saveCache(key, rankings);
    return rankings;
}

// ── Aggregate gear ─────────────────────────────────────────────────
function aggregateGear(allRankings) {
    // Per slot: { itemId → { id, name, quality, icon, count, totalDps, players[] } }
    const slotItems = {};
    let totalPlayers = 0;

    for (const r of allRankings) {
        if (!r.gear || !r.gear.length) continue;
        totalPlayers++;

        r.gear.forEach((g, idx) => {
            if (SKIP_SLOTS.has(idx)) return;
            if (!g.id) return;

            const slotName = SLOT_MAP[idx] || `Slot${idx}`;
            if (!slotItems[slotName]) slotItems[slotName] = {};

            const key = String(g.id);
            if (!slotItems[slotName][key]) {
                slotItems[slotName][key] = {
                    id: g.id,
                    name: g.name,
                    quality: g.quality,
                    icon: g.icon,
                    count: 0,
                    totalAmount: 0,
                };
            }
            slotItems[slotName][key].count++;
            slotItems[slotName][key].totalAmount += (r.amount || 0);
        });
    }

    // Convert to sorted arrays per slot
    const result = {};
    for (const [slot, items] of Object.entries(slotItems)) {
        result[slot] = Object.values(items)
            .map(item => ({
                id: item.id,
                name: item.name,
                quality: item.quality,
                icon: item.icon,
                popularity: Math.round((item.count / totalPlayers) * 100),
                count: item.count,
                avgAmount: Math.round(item.totalAmount / item.count),
            }))
            .sort((a, b) => b.popularity - a.popularity)
            .filter(item => item.popularity >= 3) // Drop <3% outliers
            .slice(0, 10); // Top 10 per slot
    }

    return { totalPlayers, slots: result };
}

// ── Main ───────────────────────────────────────────────────────────
async function main() {
    const args = process.argv.slice(2);
    const phaseFilter = args.includes('--phase') ? parseInt(args[args.indexOf('--phase') + 1]) : null;
    const specFilter = args.includes('--spec') ? args[args.indexOf('--spec') + 1] : null;
    const maxPages = args.includes('--pages') ? parseInt(args[args.indexOf('--pages') + 1]) : 1;

    console.log('🏰 WarcraftLogs TBC Classic BiS Scraper');
    console.log('═══════════════════════════════════════\n');

    const token = await getToken();
    console.log('✅ Authenticated\n');

    const output = {
        meta: {
            scrapedAt: new Date().toISOString(),
            source: 'classic.warcraftlogs.com',
            pagesPerQuery: maxPages,
            playersPerPage: 100,
        },
        phases: {},
    };

    let totalQueries = 0;
    let totalCached = 0;

    for (const phaseConfig of TBC_PHASES) {
        if (phaseFilter && phaseConfig.phase !== phaseFilter) continue;

        console.log(`\n📋 ${phaseConfig.label}`);
        console.log('─'.repeat(50));

        const phaseData = {
            phase: phaseConfig.phase,
            label: phaseConfig.label,
            specs: {},
        };

        for (const spec of TBC_SPECS) {
            const displaySpec = spec.displaySpec || spec.specName;
            const specKey = `${spec.className}|${displaySpec}`;
            if (specFilter && specKey !== specFilter) continue;

            const allRankings = [];
            let queriedBosses = 0;

            for (const zone of phaseConfig.zones) {
                for (const enc of zone.encounters) {
                    for (let page = 1; page <= maxPages; page++) {
                        const key = cacheKey(enc.id, zone.partition, spec.className, spec.specName, page);
                        const wasCached = loadCache(key) !== null;

                        const rankings = await fetchRankings(
                            token, enc.id, zone.partition,
                            spec.className, spec.specName, spec.metric, page
                        );

                        if (wasCached) totalCached++;
                        else {
                            totalQueries++;
                            await sleep(DELAY_MS);
                        }

                        if (rankings?.rankings) {
                            allRankings.push(...rankings.rankings);
                        }
                        queriedBosses++;
                    }
                }
            }

            if (allRankings.length === 0) continue;

            // Deduplicate by player name+server (same player on multiple bosses)
            const seen = new Set();
            const uniqueRankings = [];
            for (const r of allRankings) {
                const pk = `${r.name}-${r.server?.name || ''}`;
                if (!seen.has(pk)) {
                    seen.add(pk);
                    uniqueRankings.push(r);
                }
            }

            const agg = aggregateGear(uniqueRankings);

            phaseData.specs[specKey] = {
                className: spec.className,
                specName: displaySpec,
                metric: spec.metric,
                totalPlayers: agg.totalPlayers,
                totalRankings: allRankings.length,
                uniquePlayers: uniqueRankings.length,
                slots: agg.slots,
            };

            const slotCount = Object.values(agg.slots).reduce((s, items) => s + items.length, 0);
            process.stdout.write(`  ✅ ${specKey.padEnd(25)} ${agg.totalPlayers} players, ${slotCount} items\n`);
        }

        output.phases[phaseConfig.phase] = phaseData;
    }

    // Save output
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
    console.log(`\n💾 Saved to ${OUTPUT_FILE}`);
    console.log(`📊 API queries: ${totalQueries} (${totalCached} cached)`);

    // Rate limit check
    const rl = await gql(token, `{ rateLimitData { pointsSpentThisHour pointsResetIn limitPerHour } }`);
    if (rl?.rateLimitData) {
        const r = rl.rateLimitData;
        console.log(`⏱️  Rate limit: ${r.pointsSpentThisHour.toFixed(1)}/${r.limitPerHour} points used`);
    }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
