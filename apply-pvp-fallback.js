#!/usr/bin/env node
/*
 * apply-pvp-fallback.js — keep every PvP page alive even on a thin scrape week.
 *
 * The weekly refresh (fetch-gear → analyze-gear) drops any spec with fewer than
 * `minPlayersPerSpec` players in that snapshot. For rare arena specs (Enhancement
 * Shaman, Elemental Shaman, Feral Combat Druid …) that means the /cls/spec/pvp
 * page loses its data and effectively disappears — bad for users and SEO, since
 * those URLs are already in sitemap.xml and indexed by Google.
 *
 * This script runs AFTER analyze-gear + build-pvp-history and guarantees the
 * invariant:
 *
 *     Every PvP URL in sitemap.xml has data in js/pvp-data.js.
 *
 * For each sitemap PvP spec missing from this week's fresh data, we splice in the
 * most recent snapshot from pvp-history.json, tagged `stale: true` + `dataDate`.
 * The UI then shows "last confirmed snapshot from <date>" instead of a blank page.
 *
 * Fresh data always wins — a spec present in this week's scrape is never touched.
 *
 *   node apply-pvp-fallback.js            → apply fallback, rewrite js/pvp-data.js
 *   node apply-pvp-fallback.js --dry-run  → report what would change, write nothing
 */

const fs   = require('fs');
const path = require('path');

const ROOT       = __dirname;
const PVP_JS     = path.join(ROOT, 'js', 'pvp-data.js');
const HISTORY    = path.join(ROOT, 'pvp-history.json');
const SITEMAP    = path.join(ROOT, 'sitemap.xml');
const DRY_RUN    = process.argv.includes('--dry-run');

// PvP-only display names that aren't a PvE spec slug (mirrors prerender.js).
const PVP_SPEC_OVERRIDES = {
    'druid-feral-combat': 'Druid|Feral Combat',
};

function readPvpData() {
    const raw = fs.readFileSync(PVP_JS, 'utf8');
    const json = raw.replace(/^const PVP_DATA = /, '').replace(/;\s*$/, '');
    return JSON.parse(json);
}

function writePvpData(data) {
    fs.writeFileSync(PVP_JS, 'const PVP_DATA = ' + JSON.stringify(data) + ';', 'utf8');
}

function slugify(str) {
    return String(str).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

/** "beast-mastery" → "Beast Mastery" (per-word title case). */
function titleCase(slug) {
    return String(slug).split('-').map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ');
}

/** Collect "Class|Spec" keys for every /cls/spec/pvp URL in sitemap.xml.
 *  Slug pairs are resolved against the set of keys that actually exist across
 *  the current data + full history (exact canonical casing); anything else is
 *  title-cased so genuinely unknown URLs still surface as orphan warnings. */
function pvpKeysFromSitemap(knownKeys) {
    if (!fs.existsSync(SITEMAP)) return [];
    const xml = fs.readFileSync(SITEMAP, 'utf8');

    // slug pair ("shaman-enhancement") → canonical key ("Shaman|Enhancement")
    const slugToKey = { ...PVP_SPEC_OVERRIDES };
    for (const key of knownKeys) {
        const [cls, spec] = key.split('|');
        slugToKey[`${slugify(cls)}-${slugify(spec)}`] = key;
    }

    const keys = new Set();
    const re = /<loc>([^<]+)<\/loc>/g;
    let m;
    while ((m = re.exec(xml))) {
        let pathname;
        try { pathname = new URL(m[1].trim()).pathname; }
        catch { pathname = m[1].trim(); }
        const parts = pathname.replace(/^\//, '').replace(/\/$/, '').split('/');
        if (parts.length !== 3 || parts[2] !== 'pvp') continue;
        const key = slugToKey[`${parts[0]}-${parts[1]}`]
            || `${titleCase(parts[0])}|${titleCase(parts[1])}`;
        keys.add(key);
    }
    return [...keys];
}

/** Most recent history snapshot ({ date, spec }) that contains `key`, or null. */
function latestHistoryFor(history, key) {
    const dates = history.dates || [];
    for (let i = dates.length - 1; i >= 0; i--) {
        const snap = history.snapshots[dates[i]];
        if (snap && snap[key]) return { date: dates[i], spec: snap[key] };
    }
    return null;
}

/** Rebuild a full PVP_DATA.specs entry from a trimmed history snapshot.
 *  History items only carry { id, name, popularity, tier }; we backfill the
 *  fields the app/prerender read so nothing renders "undefined". */
function reviveSpec(key, date, histSpec) {
    const [className, specName] = key.split('|');
    const slots = {};
    for (const slot of Object.keys(histSpec.slots || {})) {
        slots[slot] = (histSpec.slots[slot] || []).map(it => ({
            id: it.id,
            name: it.name,
            slot,
            quality: it.quality || 'Epic',
            popularity: it.popularity,
            tier: it.tier,
            isPvP: false,
            isPvEFlex: false,
            ratingGate: null,
            avgUserRating: null,
            userCount: null,
            topGems: [],
            topEnchants: [],
        }));
    }
    return {
        class: className,
        spec: specName,
        playerCount: histSpec.playerCount || 0,
        ratingRange: histSpec.ratingRange || null,
        slots,
        flexSlots: histSpec.flexSlots || {},
        stale: true,        // → UI shows "last confirmed snapshot" instead of "live"
        dataDate: date,     // the snapshot date this fallback data came from
    };
}

function main() {
    if (!fs.existsSync(PVP_JS)) { console.error('✗ js/pvp-data.js not found'); process.exit(1); }
    if (!fs.existsSync(HISTORY)) { console.log('ℹ️  pvp-history.json not found — nothing to fall back to.'); return; }

    const data    = readPvpData();
    const history = JSON.parse(fs.readFileSync(HISTORY, 'utf8'));
    data.specs = data.specs || {};

    // Keys we can legitimately revive = anything seen in history or current data.
    const knownKeys = new Set(Object.keys(data.specs));
    for (const d of history.dates || []) {
        for (const k of Object.keys(history.snapshots[d] || {})) knownKeys.add(k);
    }

    const sitemapKeys = pvpKeysFromSitemap(knownKeys);
    if (!sitemapKeys.length) { console.log('ℹ️  No PvP URLs found in sitemap.xml — nothing to do.'); return; }

    const revived = [];
    const orphaned = [];   // in sitemap but no fresh data AND no history — a real gap
    for (const key of sitemapKeys) {
        const existing = data.specs[key];
        // Fresh (non-stale) data always wins — leave it alone.
        if (existing && !existing.stale) continue;

        const hit = latestHistoryFor(history, key);
        if (!hit) { if (!existing) orphaned.push(key); continue; }

        data.specs[key] = reviveSpec(key, hit.date, hit.spec);
        revived.push(`${key} → ${hit.date} (${hit.spec.playerCount || 0} players)`);
    }

    data.meta = data.meta || {};
    data.meta.staleSpecs = revived.map(r => r.split(' → ')[0]);

    console.log('🛟 PvP fallback');
    console.log(`   Sitemap PvP specs: ${sitemapKeys.length}`);
    console.log(`   Fresh this week:   ${sitemapKeys.length - revived.length - orphaned.length}`);
    if (revived.length) {
        console.log(`   Revived from history (${revived.length}):`);
        revived.forEach(r => console.log(`     • ${r}`));
    } else {
        console.log('   Revived from history: none — every sitemap spec has fresh data. 🎉');
    }
    if (orphaned.length) {
        console.log(`   ⚠️  Orphaned (in sitemap, no data anywhere): ${orphaned.join(', ')}`);
    }

    if (DRY_RUN) { console.log('   (dry run — js/pvp-data.js not written)'); return; }
    if (revived.length) {
        writePvpData(data);
        console.log(`   ✅ Rewrote js/pvp-data.js — now ${Object.keys(data.specs).length} specs.`);
    } else {
        console.log('   ✅ No changes needed.');
    }
}

main();
