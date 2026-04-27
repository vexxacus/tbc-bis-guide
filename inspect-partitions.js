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
        const opts = { hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
            headers: { 'Content-Type': headers['Content-Type'] || 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers } };
        const req = https.request(opts, res => { let buf = ''; res.on('data', d => buf += d); res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { resolve(buf); } }); });
        req.on('error', reject); req.write(data); req.end();
    });
}
async function main() {
    const auth = Buffer.from(`${env.WCL_CLIENT_ID}:${env.WCL_CLIENT_SECRET}`).toString('base64');
    const t = await httpPost('https://www.warcraftlogs.com/oauth/token', 'grant_type=client_credentials', {
        'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': `Basic ${auth}` });
    const token = t.access_token;

    // Test each partition for Lady Vashj (628) in SSC/TK zone 1010
    // Partitions: P1(1), P2(2), P2.5(3), P3(4), P3.5&P4(5), P5(6), Pre-Patch(7)
    const tests = [
        { enc: 628, name: 'Lady Vashj (SSC)', partitions: [1,2,3,4,5,6,7] },
        { enc: 609, name: 'Illidan (BT)', partitions: [1,2,3,4,5,6,7] },
        { enc: 725, name: 'Brutallus (SWP)', partitions: [1,2,3,4,5,6,7] },
    ];

    for (const test of tests) {
        console.log(`\n${test.name}:`);
        for (const p of test.partitions) {
            const resp = await httpPost('https://classic.warcraftlogs.com/api/v2/client', {
                query: `{ worldData { encounter(id: ${test.enc}) { characterRankings(className: "Warlock", specName: "Destruction", partition: ${p}, page: 1) } } }`
            }, { 'Authorization': `Bearer ${token}` });
            const count = resp.data?.worldData?.encounter?.characterRankings?.count || 0;
            const label = ['','P1','P2','P2.5','P3','P3.5&P4','P5','Pre-Patch'][p];
            console.log(`  Partition ${p} (${label}): ${count} rankings`);
            await new Promise(r => setTimeout(r, 300));
        }
    }
}
main();
