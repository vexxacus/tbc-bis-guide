/**
 * prerender.js — Static HTML pre-renderer for TBC BiS Guide
 *
 * Usage:
 *   node scraper/prerender.js
 *
 * Requires a local HTTP server running on port 8080.
 * Start one with:  python3 -m http.server 8080
 * or:              npx serve -l 8080 .
 *
 * Generates one HTML file per spec/phase combination into the
 * `prerendered/` directory. Firebase Hosting serves these to
 * bots/crawlers, while the SPA handles human navigation.
 */

'use strict';

const puppeteer = require('puppeteer');
const fs        = require('fs');
const path      = require('path');

// ─── Config ──────────────────────────────────────────────────────────
const BASE_URL    = process.env.PRERENDER_BASE || 'http://localhost:8080';
const OUT_DIR     = path.join(__dirname, '..', 'prerendered');
const CONCURRENCY = 3;   // parallel tabs
const TIMEOUT_MS  = 30_000;

// ─── Route definitions ───────────────────────────────────────────────
// Mirror of PHASE_TO_SLUG / CLASS_META in app.js
const PHASE_TO_SLUG = {
    0: 'pre-bis', 1: 'phase-1', 2: 'phase-2',
    3: 'phase-3', 4: 'phase-4', 5: 'phase-5'
};

const SPECS = {
    Warrior:  ['Arms', 'Fury', 'Protection'],
    Paladin:  ['Holy', 'Protection', 'Retribution'],
    Hunter:   ['Beast Mastery', 'Marksmanship', 'Survival'],
    Rogue:    ['Dps'],
    Priest:   ['Holy', 'Shadow'],
    Shaman:   ['Elemental', 'Enhancement', 'Restoration'],
    Mage:     ['Arcane', 'Fire', 'Frost'],
    Warlock:  ['Affliction', 'Demonology', 'Destruction'],
    Druid:    ['Balance', 'Bear', 'Cat', 'Restoration'],
};

const PHASES = [0, 1, 2, 3, 4, 5];

function toSlug(str) {
    return str.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

// Build the full route list
const routes = [];

// Root index
routes.push({ url: '/', outFile: 'index.html' });

for (const [cls, specs] of Object.entries(SPECS)) {
    const clsSlug = toSlug(cls);

    // Class page: /warrior
    routes.push({ url: `/${clsSlug}`, outFile: `${clsSlug}/index.html` });

    for (const spec of specs) {
        const specSlug = toSlug(spec);

        // Spec page: /warrior/fury
        routes.push({
            url:     `/${clsSlug}/${specSlug}`,
            outFile: `${clsSlug}/${specSlug}/index.html`
        });

        for (const phase of PHASES) {
            const phaseSlug = PHASE_TO_SLUG[phase];
            routes.push({
                url:     `/${clsSlug}/${specSlug}/${phaseSlug}`,
                outFile: `${clsSlug}/${specSlug}/${phaseSlug}/index.html`
            });
        }
    }
}

console.log(`📦 Pre-rendering ${routes.length} pages…\n`);

// ─── Scrape ──────────────────────────────────────────────────────────
async function renderPage(browser, { url, outFile }) {
    const page = await browser.newPage();
    try {
        await page.setUserAgent('Prerenderer/1.0 (TBC BiS Guide)');
        // Suppress Wowhead tooltip fetches to speed things up
        await page.setRequestInterception(true);
        page.on('request', req => {
            const u = req.url();
            if (u.includes('zamimg.com') || u.includes('wowhead.com/js')) {
                req.abort();
            } else {
                req.continue();
            }
        });

        const fullUrl = `${BASE_URL}${url}`;
        await page.goto(fullUrl, { waitUntil: 'networkidle0', timeout: TIMEOUT_MS });

        // Wait for app to finish rendering
        await page.waitForFunction(
            () => !document.getElementById('stepBis')?.classList.contains('hidden')
                  || !document.getElementById('stepClass')?.classList.contains('hidden'),
            { timeout: TIMEOUT_MS }
        ).catch(() => {}); // non-fatal — page may be in a different state

        // Allow any remaining JS to settle
        await new Promise(r => setTimeout(r, 500));

        let html = await page.content();

        // Inject a noindex hint for search bots that find the prerendered version
        // The canonical tag in <head> already points to the correct URL.
        // Remove the dynamic script tags from the snapshot so bots don't re-execute.
        // (Optional — comment out if you prefer the full page.)
        html = html.replace(
            '</head>',
            '  <meta name="prerendered" content="true">\n</head>'
        );

        const outPath = path.join(OUT_DIR, outFile);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, html, 'utf8');

        console.log(`  ✅  ${url}`);
    } catch (err) {
        console.error(`  ❌  ${url}: ${err.message}`);
    } finally {
        await page.close();
    }
}

async function main() {
    // Ensure server is reachable
    const http = require('http');
    await new Promise((resolve, reject) => {
        http.get(BASE_URL, resolve).on('error', reject);
    }).catch(() => {
        console.error(`\n❌  Cannot reach ${BASE_URL}. Start the server first:\n`);
        console.error(`   python3 -m http.server 8080\n`);
        process.exit(1);
    });

    fs.mkdirSync(OUT_DIR, { recursive: true });

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    // Process routes in batches of CONCURRENCY
    for (let i = 0; i < routes.length; i += CONCURRENCY) {
        const batch = routes.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(r => renderPage(browser, r)));
    }

    await browser.close();

    const count = routes.length;
    console.log(`\n🎉  Done! ${count} pages written to ${path.relative(process.cwd(), OUT_DIR)}/`);
    console.log('\nNext steps:');
    console.log('  1. Add prerendered/ files to Firebase Hosting via rewrites (see below)');
    console.log('  2. Update firebase.json to serve prerendered HTML to bots');
    console.log('  3. Re-run this script after each data update with: node scraper/prerender.js');
    console.log('\nFirebase hosting tip: add each prerendered file to the "public" hosting root,');
    console.log('or use a Cloud Function / Hosting rewrite with a User-Agent check.\n');
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
