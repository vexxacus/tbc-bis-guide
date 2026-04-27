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

    // Get game classes and specs
    const resp = await httpPost('https://classic.warcraftlogs.com/api/v2/client', {
        query: `{ gameData { classes { id name slug specs { id name slug } } } }`
    }, { 'Authorization': `Bearer ${token}` });

    for (const cls of resp.data.gameData.classes) {
        console.log(`${cls.name} (slug: ${cls.slug}):`);
        for (const spec of cls.specs) {
            console.log(`  ${spec.name} (slug: ${spec.slug})`);
        }
    }
}
main();
