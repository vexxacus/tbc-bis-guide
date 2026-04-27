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
    const auth = Buffer.from(`${env.WCL_CLIENT_ID}:${env.WCL_CLIENT_SECRET}`).toString('base64');
    const tokenResp = await httpPost('https://www.warcraftlogs.com/oauth/token', 'grant_type=client_credentials', {
        'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': `Basic ${auth}`,
    });
    const token = tokenResp.access_token;

    const rankings = require('./scraper/output/wcl-test-rankings.json');
    // Try a few different reports to find one with combatantInfo
    for (let i = 0; i < 5; i++) {
        const r = rankings.rankings[i];
        const code = r.report.code;
        const fid = r.report.fightID;
        console.log(`\n--- Report ${code} fight ${fid} (${r.name}) ---`);

        // Try table view with Summary type
        const resp = await httpPost('https://classic.warcraftlogs.com/api/v2/client', {
            query: `{
                reportData {
                    report(code: "${code}") {
                        table(dataType: Summary, fightIDs: [${fid}])
                        playerDetails(fightIDs: [${fid}])
                    }
                }
            }`
        }, { 'Authorization': `Bearer ${token}` });

        const report = resp.data?.reportData?.report;
        if (!report) { console.log('No data:', JSON.stringify(resp.errors || resp, null, 2).slice(0, 300)); continue; }
        
        // playerDetails
        const pd = report.playerDetails?.data?.playerDetails;
        if (pd) {
            const allPlayers = Object.values(pd).flat();
            console.log(`playerDetails: ${allPlayers.length} players`);
            if (allPlayers.length > 0) {
                const p = allPlayers[0];
                console.log('First player keys:', Object.keys(p));
                if (p.combatantInfo) {
                    console.log('combatantInfo keys:', Object.keys(p.combatantInfo));
                    const ci = p.combatantInfo;
                    if (ci.gear) {
                        console.log(`gear: ${ci.gear.length} items`);
                        console.log('gear[0]:', JSON.stringify(ci.gear[0], null, 2));
                        const withGems = ci.gear.find(g => g.gems && g.gems.length);
                        if (withGems) console.log('WITH GEMS:', JSON.stringify(withGems, null, 2));
                        const withEnch = ci.gear.find(g => g.permanentEnchant != null);
                        if (withEnch) console.log('WITH ENCHANT:', JSON.stringify(withEnch, null, 2));
                    }
                }
            }
        }
        
        // Only check first successful one
        if (pd) break;
    }
}

main().catch(err => console.error('Error:', err));
