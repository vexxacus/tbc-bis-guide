// Check if there's more detailed combatantInfo by querying a specific report
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

async function main() {
    // Get token
    const auth = Buffer.from(`${env.WCL_CLIENT_ID}:${env.WCL_CLIENT_SECRET}`).toString('base64');
    const tokenResp = await httpPost('https://www.warcraftlogs.com/oauth/token', 'grant_type=client_credentials', {
        'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': `Basic ${auth}`,
    });
    const token = tokenResp.access_token;

    // Get the report code from the first ranked player
    const rankings = require('./scraper/output/wcl-test-rankings.json');
    const r = rankings.rankings[0];
    const reportCode = r.report.code;
    const fightID = r.report.fightID;

    console.log(`Fetching report ${reportCode}, fight ${fightID} for ${r.name}...\n`);

    // Query the report for combatant info (this gives detailed gear with gems/enchants)
    const resp = await httpPost('https://classic.warcraftlogs.com/api/v2/client', {
        query: `{
            reportData {
                report(code: "${reportCode}") {
                    masterData {
                        actors(type: "Player") {
                            id name type subType server
                        }
                    }
                    events(
                        dataType: CombatantInfo
                        fightIDs: [${fightID}]
                        limit: 50
                    ) {
                        data
                    }
                }
            }
        }`
    }, { 'Authorization': `Bearer ${token}` });

    const report = resp.data?.reportData?.report;
    if (!report) {
        console.log('No report data:', JSON.stringify(resp, null, 2));
        return;
    }

    const actors = report.masterData?.actors || [];
    console.log(`Found ${actors.length} player actors`);
    
    const events = report.events?.data || [];
    console.log(`Found ${events.length} CombatantInfo events\n`);

    // Show first event in detail
    if (events.length > 0) {
        const e = events[0];
        console.log('=== CombatantInfo event keys:', Object.keys(e));
        console.log('\n=== Full first event (truncated gear):');
        const display = { ...e };
        if (display.gear) {
            console.log(`Gear items: ${display.gear.length}`);
            console.log('Gear[0]:', JSON.stringify(display.gear[0], null, 2));
            console.log('Gear[1]:', JSON.stringify(display.gear[1], null, 2));
            // Find one with gems
            const withGems = display.gear.find(g => g.gems && g.gems.length > 0);
            if (withGems) console.log('First item with gems:', JSON.stringify(withGems, null, 2));
            const withEnch = display.gear.find(g => g.permanentEnchant || g.enchant);
            if (withEnch) console.log('First item with enchant:', JSON.stringify(withEnch, null, 2));
            delete display.gear;
        }
        if (display.auras) {
            console.log(`Auras: ${display.auras.length}`);
            delete display.auras;
        }
        console.log('\nRest:', JSON.stringify(display, null, 2));
    }
}

main().catch(err => console.error('Error:', err));
