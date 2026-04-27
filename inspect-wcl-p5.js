const https = require('https');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, 'scraper', '.env');
const env = {};
fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k && v.length) env[k.trim()] = v.join('=').trim();
});

function httpPost(url, body, headers = {}) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const data = typeof body === 'string' ? body : JSON.stringify(body);
        const opts = {
            hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
            headers: { 'Content-Type': headers['Content-Type'] || 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers },
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

async function gql(token, query) {
    const resp = await httpPost('https://classic.warcraftlogs.com/api/v2/client', { query }, {
        'Authorization': `Bearer ${token}`,
    });
    if (resp.errors) console.error('GQL errors:', JSON.stringify(resp.errors).slice(0, 500));
    return resp.data;
}

async function main() {
    const auth = Buffer.from(`${env.WCL_CLIENT_ID}:${env.WCL_CLIENT_SECRET}`).toString('base64');
    const tokenResp = await httpPost('https://www.warcraftlogs.com/oauth/token', 'grant_type=client_credentials', {
        'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': `Basic ${auth}`,
    });
    const token = tokenResp.access_token;

    // Try later partition (P5/Sunwell era) - more likely to have full combatantInfo
    // Sunwell Plateau encounter: Brutallus (id: 725), partition 6 (P5)
    console.log('Fetching Brutallus P5 rankings (Destruction Warlock)...');
    const data = await gql(token, `{
        worldData {
            encounter(id: 725) {
                name
                characterRankings(
                    className: "Warlock"
                    specName: "Destruction"
                    includeCombatantInfo: true
                    partition: 6
                    page: 1
                )
            }
        }
    }`);

    const rankings = data?.worldData?.encounter?.characterRankings?.rankings || [];
    console.log(`Got ${rankings.length} rankings`);

    // Check gear structure
    if (rankings.length) {
        const r = rankings[0];
        console.log(`\n#1: ${r.name} - ${r.amount.toFixed(0)} DPS`);
        console.log('Gear keys on first item:', Object.keys(r.gear[0]));
        console.log('Full gear[0]:', JSON.stringify(r.gear[0]));
        
        // Check all gear for permanentEnchant or gems
        let hasEnchant = false, hasGems = false;
        for (const g of r.gear) {
            if (g.permanentEnchant) hasEnchant = true;
            if (g.gems && g.gems.length) hasGems = true;
        }
        console.log(`\nHas enchant data: ${hasEnchant}`);
        console.log(`Has gem data: ${hasGems}`);
        
        // Show all gear with full detail
        console.log('\nFull gear:');
        for (const g of r.gear) {
            console.log(JSON.stringify(g));
        }
    }

    // Also try a report from P5 to see playerDetails
    if (rankings.length) {
        const r = rankings[0];
        const code = r.report.code;
        const fid = r.report.fightID;
        console.log(`\n\nChecking report ${code} fight ${fid} playerDetails...`);
        
        const rpData = await gql(token, `{
            reportData {
                report(code: "${code}") {
                    playerDetails(fightIDs: [${fid}])
                }
            }
        }`);
        
        const pd = rpData?.reportData?.report?.playerDetails?.data?.playerDetails;
        if (pd) {
            const all = Object.values(pd).flat();
            const target = all.find(p => p.name === r.name) || all[0];
            if (target) {
                console.log(`Player: ${target.name}`);
                console.log('combatantInfo keys:', Object.keys(target.combatantInfo || {}));
                const ci = target.combatantInfo;
                if (ci && ci.gear) {
                    console.log(`\nGear via playerDetails (${ci.gear.length} items):`);
                    for (const g of ci.gear.slice(0, 3)) {
                        console.log(JSON.stringify(g));
                    }
                }
            }
        }
    }

    // Rate limit
    const rl = await gql(token, `{ rateLimitData { pointsSpentThisHour pointsResetIn limitPerHour } }`);
    console.log('\nRate limit:', JSON.stringify(rl.rateLimitData));
}

main().catch(err => console.error('Error:', err));
