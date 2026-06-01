#!/usr/bin/env node
/*
 * build-pvp-history.js — builds pvp-history.json for the PvP "meta evolution" slider.
 *
 * The weekly refresh-pvp GitHub Action commits js/pvp-data.js, so git history holds
 * one full arena snapshot per week. This aggregates them into a single trimmed file
 * the PvP pages lazy-load.
 *
 *   node build-pvp-history.js --backfill   → rebuild from full git history of js/pvp-data.js
 *   node build-pvp-history.js              → incremental: add the current js/pvp-data.js as
 *                                            its snapshot date (used in CI after each refresh)
 *
 * Output: pvp-history.json = { dates: [...sorted asc], snapshots: { "<date>": { "Class|Spec": {…} } } }
 */

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT   = __dirname;
const PVP_JS = path.join(ROOT, 'js', 'pvp-data.js');
const OUT    = path.join(ROOT, 'pvp-history.json');

function evalPvp(src) {
    const sandbox = {};
    // src is `const PVP_DATA = {...};` — rebind to the sandbox and run.
    new Function('s', src.replace('const PVP_DATA', 's.PVP_DATA'))(sandbox);
    return sandbox.PVP_DATA;
}

function dateOf(PVP) {
    const a = PVP && PVP.meta && PVP.meta.analyzedAt;
    return a ? a.slice(0, 10) : null;
}

// Keep only what the slider's gear view needs (items + popularity per slot).
// topGems/topEnchants are intentionally dropped — they only render for the live week.
function trim(PVP) {
    const out = {};
    for (const key of Object.keys(PVP.specs || {})) {
        const s = PVP.specs[key];
        const slots = {};
        for (const slot of Object.keys(s.slots || {})) {
            slots[slot] = (s.slots[slot] || []).map(it => ({
                id: it.id, name: it.name, popularity: it.popularity, tier: it.tier
            }));
        }
        out[key] = { playerCount: s.playerCount, ratingRange: s.ratingRange, slots };
        if (s.flexSlots) out[key].flexSlots = s.flexSlots;
    }
    return out;
}

function finalize(snapshots) {
    const dates = Object.keys(snapshots).sort();
    fs.writeFileSync(OUT, JSON.stringify({ dates, snapshots }));
    console.log(`✅ pvp-history.json — ${dates.length} weekly snapshots: ${dates.join(', ')}`);
    console.log(`   size: ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
}

function backfill() {
    const commits = execSync('git log --format=%H -- js/pvp-data.js', { cwd: ROOT })
        .toString().trim().split('\n').filter(Boolean);   // newest first
    const snapshots = {};
    let ok = 0, skip = 0;
    for (const commit of commits) {
        let PVP;
        try { PVP = evalPvp(execSync(`git show ${commit}:js/pvp-data.js`, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }).toString()); }
        catch { skip++; continue; }
        const date = dateOf(PVP);
        if (!date) { skip++; continue; }
        if (!snapshots[date]) { snapshots[date] = trim(PVP); ok++; }  // newest commit per date wins
    }
    // Include the current working file too (may be newer / uncommitted).
    try {
        const PVP = evalPvp(fs.readFileSync(PVP_JS, 'utf8'));
        const d = dateOf(PVP);
        if (d && !snapshots[d]) { snapshots[d] = trim(PVP); ok++; }
    } catch { /* ignore */ }
    console.log(`📚 backfill: ${ok} snapshots from ${commits.length} commits (${skip} skipped)`);
    finalize(snapshots);
}

function incremental() {
    let out = { dates: [], snapshots: {} };
    try { out = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { /* first run */ }
    const snapshots = out.snapshots || {};
    const PVP = evalPvp(fs.readFileSync(PVP_JS, 'utf8'));
    const d = dateOf(PVP);
    if (!d) { console.error('✗ no analyzedAt in js/pvp-data.js'); process.exit(1); }
    snapshots[d] = trim(PVP);
    console.log(`➕ incremental: added/updated snapshot ${d}`);
    finalize(snapshots);
}

if (process.argv.includes('--backfill')) backfill();
else incremental();
