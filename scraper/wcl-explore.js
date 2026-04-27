#!/usr/bin/env node
/**
 * wcl-explore.js — Proof of concept: Warcraft Logs TBC Classic data explorer
 * 
 * Step 1: Authenticate & list TBC zones/encounters/partitions
 * Step 2: Fetch top 100 rankings for one encounter+spec with gear (combatantInfo)
 * 
 * Usage:  node scraper/wcl-explore.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// ── Load credentials ───────────────────────────────────────────────
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

// ── HTTP helpers ───────────────────────────────────────────────────
function httpPost(url, body, headers = {}) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const data = typeof body === 'string' ? body : JSON.stringify(body);
        const opts = {
            hostname: u.hostname,
            path: u.pathname + u.search,
            method: 'POST',
            headers: {
                'Content-Type': headers['Content-Type'] || 'application/json',
                'Content-Length': Buffer.byteLength(data),
                ...headers,
            },
        };
        const req = https.request(opts, res => {
            let buf = '';
            res.on('data', d => buf += d);
            res.on('end', () => {
                try { resolve(JSON.parse(buf)); }
                catch { resolve(buf); }
            });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

// ── OAuth: get access token ────────────────────────────────────────
async function getToken() {
    console.log('🔑 Authenticating with WarcraftLogs...');
    const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
    const resp = await httpPost(TOKEN_URL, 'grant_type=client_credentials', {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${auth}`,
    });
    if (!resp.access_token) {
        console.error('❌ Auth failed:', resp);
        process.exit(1);
    }
    console.log(`✅ Got access token (expires in ${resp.expires_in}s)`);
    return resp.access_token;
}

// ── GraphQL query ──────────────────────────────────────────────────
async function gql(token, query, variables = {}) {
    const resp = await httpPost(API_URL, { query, variables }, {
        'Authorization': `Bearer ${token}`,
    });
    if (resp.errors) {
        console.error('GraphQL errors:', JSON.stringify(resp.errors, null, 2));
    }
    return resp.data;
}

// ── Main ───────────────────────────────────────────────────────────
async function main() {
    const token = await getToken();

    // ─── Step 1: List TBC zones, encounters, partitions ────────────
    console.log('\n📋 Fetching TBC Classic zones & partitions...\n');

    // TBC Classic expansion ID = 1000 (Classic TBC on classic.warcraftlogs.com)
    // Let's discover it
    const expData = await gql(token, `{
        worldData {
            expansions {
                id
                name
                zones {
                    id
                    name
                    frozen
                    encounters { id name }
                    partitions { id name compactName default }
                }
            }
        }
    }`);

    // Print all expansions to find TBC
    for (const exp of expData.worldData.expansions) {
        console.log(`\n══════════════════════════════════════`);
        console.log(`📦 Expansion: ${exp.name} (id: ${exp.id})`);
        console.log(`══════════════════════════════════════`);
        for (const zone of (exp.zones || [])) {
            const partStr = (zone.partitions || []).map(p => 
                `${p.compactName}(${p.id})${p.default ? '*' : ''}`
            ).join(', ');
            console.log(`  🏰 ${zone.name} (id: ${zone.id}, frozen: ${zone.frozen})`);
            console.log(`     Partitions: ${partStr || 'none'}`);
            console.log(`     Encounters: ${(zone.encounters || []).map(e => `${e.name}(${e.id})`).join(', ')}`);
        }
    }

    // ─── Step 2: Test ranking query with gear ──────────────────────
    // Pick first TBC raid encounter for PoC
    // We'll try Karazhan - Shade of Aran or similar
    // First let's find a good encounter from the output above
    
    // Use a well-known encounter: let's try finding Karazhan
    let testEncounterId = null;
    let testPartition = null;
    let testZoneName = '';
    let testEncounterName = '';

    for (const exp of expData.worldData.expansions) {
        for (const zone of (exp.zones || [])) {
            if (zone.name.includes('Karazhan') || zone.name.includes('Gruul') || zone.name.includes('Magtheridon')) {
                if (zone.encounters && zone.encounters.length) {
                    testEncounterId = zone.encounters[0].id;
                    testEncounterName = zone.encounters[0].name;
                    testZoneName = zone.name;
                    testPartition = (zone.partitions || []).find(p => p.id === 1)?.id || 
                                   (zone.partitions || [])[0]?.id || null;
                }
            }
        }
    }

    if (!testEncounterId) {
        // Fallback: use first encounter from first zone with encounters
        for (const exp of expData.worldData.expansions) {
            for (const zone of (exp.zones || [])) {
                if (zone.encounters?.length && zone.partitions?.length) {
                    testEncounterId = zone.encounters[0].id;
                    testEncounterName = zone.encounters[0].name;
                    testZoneName = zone.name;
                    testPartition = zone.partitions[0].id;
                    break;
                }
            }
            if (testEncounterId) break;
        }
    }

    console.log(`\n\n🎯 Testing rankings query:`);
    console.log(`   Zone: ${testZoneName}`);
    console.log(`   Encounter: ${testEncounterName} (id: ${testEncounterId})`);
    console.log(`   Partition: ${testPartition}`);
    console.log(`   Spec: Warlock / Destruction`);
    console.log(`   includeCombatantInfo: true\n`);

    const rankData = await gql(token, `{
        worldData {
            encounter(id: ${testEncounterId}) {
                name
                characterRankings(
                    className: "Warlock"
                    specName: "Destruction"
                    includeCombatantInfo: true
                    ${testPartition ? `partition: ${testPartition}` : ''}
                    page: 1
                )
            }
        }
    }`);

    const rankings = rankData?.worldData?.encounter?.characterRankings;
    
    if (!rankings) {
        console.log('❌ No rankings data returned');
        console.log(JSON.stringify(rankData, null, 2));
        return;
    }

    console.log(`📊 Rankings result:`);
    console.log(`   Total: ${rankings.count || rankings.total || 'unknown'} entries`);
    console.log(`   Page: ${rankings.page || 1}`);
    console.log(`   Has more pages: ${rankings.hasMorePages}`);
    
    const entries = rankings.rankings || [];
    console.log(`   Entries on this page: ${entries.length}\n`);

    // Show first 3 players with gear
    for (let i = 0; i < Math.min(3, entries.length); i++) {
        const r = entries[i];
        const name = r.name || r.characterName || 'Unknown';
        const server = r.server?.name || r.serverName || '';
        const amount = r.amount || r.total || '';
        console.log(`\n   🏆 #${i+1}: ${name} - ${server} (${Math.round(amount)} dps)`);
        
        const gear = r.combatantInfo?.gear || r.gear || [];
        if (gear.length) {
            console.log(`   🎒 Gear (${gear.length} slots):`);
            for (const g of gear) {
                const itemId = g.id || g.itemID;
                const itemName = g.name || `Item #${itemId}`;
                const ilvl = g.itemLevel || '';
                const gems = (g.gems || []).map(gem => gem.id || gem.itemID).filter(Boolean);
                const enchant = g.permanentEnchant || g.enchant || '';
                let line = `      [${itemId}] ${itemName}`;
                if (ilvl) line += ` (ilvl ${ilvl})`;
                if (gems.length) line += ` 💎 ${gems.join(',')}`;
                if (enchant) line += ` ✨ ench:${enchant}`;
                console.log(line);
            }
        } else {
            console.log(`   ⚠️  No gear data (keys: ${Object.keys(r.combatantInfo || r).join(', ')})`);
        }
    }

    // Save full first page to file for inspection
    const outPath = path.join(__dirname, 'output', 'wcl-test-rankings.json');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(rankings, null, 2));
    console.log(`\n💾 Full rankings saved to: ${outPath}`);
    
    // Rate limit check
    const rateData = await gql(token, `{ rateLimitData { pointsSpentThisHour pointsResetIn limitPerHour } }`);
    const rl = rateData?.rateLimitData;
    if (rl) {
        console.log(`\n⏱️  Rate limit: ${rl.pointsSpentThisHour}/${rl.limitPerHour} points used (resets in ${rl.pointsResetIn}s)`);
    }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
