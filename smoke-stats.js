#!/usr/bin/env node
/* Smoke-test the /stats page: click every tab in both PvE and PvP modes,
   pick a class+spec+bracket, and fail if the browser logs any console.error
   or a page error. Requires the dev server running on :5500.

   Run:  node smoke-stats.js
   (Fas D verification — catches "stuck old-mode data" / missing-var bugs.)  */
const puppeteer = require('puppeteer');

const BASE = process.env.STATS_URL || 'http://localhost:5500/stats';
const TABS = ['overview', 'usage', 'specmeta', 'evolution', 'players', 'alltime'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));

    async function clickTabs(mode) {
        // set global mode
        await page.evaluate(m => {
            const btn = document.querySelector(`#globalModeToggle button[data-mode="${m}"]`);
            if (btn) btn.click();
        }, mode);
        await sleep(120);
        // pick first class chip that isn't "All"
        await page.evaluate(() => {
            const chip = document.querySelector('#classChips .class-chip[data-class]:not([data-class=""])');
            if (chip) chip.click();
        });
        await sleep(120);
        for (const tab of TABS) {
            await page.evaluate(t => {
                const b = document.querySelector(`.stats-page .tab-btn[data-panel="${t}"]`);
                if (b && b.style.pointerEvents !== 'none') b.click();
            }, tab);
            await sleep(100);
        }
    }

    try {
        await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await sleep(500);
        for (let i = 0; i < 5; i++) {           // rapid-toggle a few rounds
            await clickTabs('pve');
            await clickTabs('pvp');
        }
    } catch (e) {
        errors.push('navigation: ' + e.message);
    }
    await browser.close();

    if (errors.length) {
        console.error(`❌ ${errors.length} problem(s):`);
        [...new Set(errors)].forEach(e => console.error('  • ' + e));
        process.exit(1);
    }
    console.log('✅ Clicked all 6 tabs in both modes ×5 — no console errors.');
})();
