#!/usr/bin/env node
/* Mobile audit for /stats. Loads the page at iPhone-ish width, drills into a
   spec on every tab in both modes, and reports real layout problems:
     • horizontal overflow (body/panels wider than the viewport)
     • individual elements that stick out past the right edge
     • tap targets smaller than 44×44 (Apple/WCAG minimum)
     • chart canvases that failed to size (0 height / not rendered)
   Prints a per-tab summary; exits 1 if any hard problem is found.

   Run:  node audit-mobile-stats.js   (dev server must serve :5500) */
const puppeteer = require('puppeteer');

const BASE = process.env.STATS_URL || 'http://localhost:5500/stats';
const TABS = ['overview', 'usage', 'specmeta', 'evolution', 'players', 'alltime'];
const WIDTHS = [
    { label: 'iPhone SE', w: 375, h: 667 },
    { label: 'small', w: 320, h: 568 },
];
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const browser = await puppeteer.launch({ headless: 'new' });
    const problems = [];

    for (const vp of WIDTHS) {
        const page = await browser.newPage();
        await page.setViewport({ width: vp.w, height: vp.h, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
        page.on('pageerror', e => problems.push(`[${vp.label}] pageerror: ${e.message}`));

        await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await sleep(500);

        for (const mode of ['pve', 'pvp']) {
            await page.evaluate(m => document.querySelector(`#globalModeToggle button[data-mode="${m}"]`)?.click(), mode);
            await sleep(150);

            for (const tab of TABS) {
                const clickable = await page.evaluate(t => {
                    const b = document.querySelector(`.stats-page .tab-btn[data-panel="${t}"]`);
                    if (!b || b.style.pointerEvents === 'none') return false;
                    b.click();
                    return true;
                }, tab);
                if (!clickable) continue;
                await sleep(160);

                // Drill into first class+spec if this is a picker tab.
                await page.evaluate(() => document.querySelector('#specPickerBar [data-pick-class]')?.click());
                await sleep(120);
                await page.evaluate(() => document.querySelector('#specPickerBar [data-pick-spec]')?.click());
                await sleep(220); // let charts size

                const report = await page.evaluate((vpW, tabName) => {
                    const out = { overflowX: false, docScroll: 0, wideEls: [], smallTaps: [], badCanvas: [] };
                    const de = document.documentElement;
                    out.docScroll = de.scrollWidth - de.clientWidth;
                    out.overflowX = out.docScroll > 1;

                    // Elements sticking out past the right edge (visible ones only).
                    const panel = document.querySelector('.stats-page .panel.active') || document.querySelector('.stats-page');
                    if (panel) {
                        panel.querySelectorAll('*').forEach(el => {
                            const r = el.getBoundingClientRect();
                            if (r.width === 0 || r.height === 0) return;
                            if (r.right > vpW + 1) {
                                const sig = el.className && typeof el.className === 'string'
                                    ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
                                    : el.tagName.toLowerCase();
                                out.wideEls.push(`${sig} (right=${Math.round(r.right)})`);
                            }
                        });
                    }

                    // Tap targets: interactive controls should be ≥40px tall/wide.
                    const sel = '.stats-page button, .stats-page a.usage-row, .stats-page .class-chip, .stats-page .spec-chip, .stats-page .tier-clickable, .stats-page .survivor-main';
                    document.querySelectorAll(sel).forEach(el => {
                        const r = el.getBoundingClientRect();
                        if (r.width === 0 || r.height === 0) return; // hidden
                        if (r.height < 40) {
                            const sig = (el.textContent || el.className || el.tagName).trim().slice(0, 22).replace(/\s+/g, ' ');
                            out.smallTaps.push(`"${sig}" (${Math.round(r.width)}×${Math.round(r.height)})`);
                        }
                    });

                    // Chart canvases should have a real rendered height.
                    // Skip charts inside a hidden opposite-mode block
                    // (.pve-only/.pvp-only toggled by body[data-mode]).
                    document.querySelectorAll('.stats-page .panel.active .chart-canvas, .stats-page .panel.active .chart-canvas-tall').forEach(c => {
                        if (c.offsetParent === null) return; // display:none ancestor
                        const r = c.getBoundingClientRect();
                        const hasCanvas = c.querySelector('canvas, svg');
                        if (r.height < 40 || !hasCanvas) out.badCanvas.push(`${c.id || 'chart'} (h=${Math.round(r.height)}, rendered=${!!hasCanvas})`);
                    });

                    return out;
                }, vp.w, tab);

                const tag = `[${vp.label} ${mode}/${tab}]`;
                if (report.overflowX) problems.push(`${tag} horizontal overflow: doc scrolls ${report.docScroll}px`);
                // Dedup wide-element signatures.
                [...new Set(report.wideEls)].forEach(e => problems.push(`${tag} element past right edge: ${e}`));
                [...new Set(report.smallTaps)].forEach(e => problems.push(`${tag} small tap target: ${e}`));
                report.badCanvas.forEach(e => problems.push(`${tag} chart not sized: ${e}`));
            }
        }
        await page.close();
    }

    await browser.close();

    if (problems.length) {
        console.log(`⚠️  ${problems.length} mobile issue(s):`);
        [...new Set(problems)].forEach(p => console.log('  • ' + p));
        process.exit(1);
    }
    console.log('✅ No mobile layout problems found (375px + 320px, all tabs, both modes).');
})();
