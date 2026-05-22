#!/usr/bin/env node
/**
 * Prerender static HTML pages with correct <title>, <meta>, <link rel="canonical">
 * and JSON-LD baked in — so Googlebot sees unique content per URL without needing
 * to render JavaScript first.
 *
 * Usage:
 *   node prerender.js                                # all URLs from sitemap.xml
 *   node prerender.js --only /druid/balance/phase-5  # one URL (test mode)
 *   node prerender.js --dry-run                      # don't write files, print plan
 *
 * The generated <path>/index.html files live alongside the existing index.html.
 * Firebase Hosting prefers static files over the SPA rewrite, so /druid/balance/phase-5
 * will serve /druid/balance/phase-5/index.html when present.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const BASE_URL  = 'https://tbc-bis-guide.com';
const ROOT      = __dirname;
const TEMPLATE  = path.join(ROOT, 'index.html');

// ─── Route data (mirrors js/app.js) ──────────────────────────────────

const CLASS_META = {
    Warrior:  { color: '#C79C6E', specs: ['Arms', 'Fury', 'Protection'] },
    Paladin:  { color: '#F58CBA', specs: ['Holy', 'Protection', 'Retribution'] },
    Hunter:   { color: '#ABD473', specs: ['Beast Mastery', 'Marksmanship', 'Survival'] },
    Rogue:    { color: '#FFF569', specs: ['Combat', 'Assassination', 'Subtlety'] },
    Priest:   { color: '#FFFFFF', specs: ['Discipline', 'Holy', 'Shadow'] },
    Shaman:   { color: '#0070DE', specs: ['Elemental', 'Enhancement', 'Restoration'] },
    Mage:     { color: '#69CCF0', specs: ['Arcane', 'Fire', 'Frost'] },
    Warlock:  { color: '#9482C9', specs: ['Affliction', 'Demonology', 'Destruction'] },
    Druid:    { color: '#FF7D0A', specs: ['Balance', 'Bear', 'Cat', 'Restoration'] }
};

const PHASE_NAMES = {
    0: { label: 'Pre-BiS' },
    1: { label: 'Phase 1' },
    2: { label: 'Phase 2' },
    3: { label: 'Phase 3' },
    4: { label: 'Phase 4' },
    5: { label: 'Phase 5' }
};

const PHASE_SLUG_MAP = {
    'pre-bis': 0, 'phase-0': 0,
    'phase-1': 1, 'phase-2': 2, 'phase-3': 3, 'phase-4': 4, 'phase-5': 5
};

function toSlug(str) {
    return str.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

// Build reverse lookups
const CLASS_SLUG_MAP = {};
const SPEC_SLUG_MAP  = {};
for (const cls of Object.keys(CLASS_META)) {
    CLASS_SLUG_MAP[toSlug(cls)] = cls;
    for (const spec of CLASS_META[cls].specs) {
        SPEC_SLUG_MAP[`${toSlug(cls)}-${toSlug(spec)}`] = { cls, spec };
    }
}

// PvP-only spec names that come from scraped arena data (not in CLASS_META).
// Mirrors PVP_TO_PVE_SPEC in app.js — display name shown to users is the PvP name.
const PVP_SPEC_OVERRIDES = {
    'druid-feral-combat': { cls: 'Druid', spec: 'Feral Combat' },
};

// Spec abbreviations injected into meta descriptions to capture searches like
// "ret pally bis", "bm hunter bis", "boomkin enchants". Volume data from Ahrefs.
// Only specs with a widely-used short form are listed — Arms/Fury/Frost etc. are
// already short and don't need expansion.
const SPEC_ABBREV = {
    'Paladin-Retribution':  'Ret',
    'Paladin-Protection':   'Prot',
    'Warrior-Protection':   'Prot',
    'Hunter-Beast Mastery': 'BM',
    'Hunter-Marksmanship':  'MM',
    'Warlock-Destruction':  'Destro',
    'Warlock-Affliction':   'Affli',
    'Druid-Restoration':    'Resto',
    'Shaman-Restoration':   'Resto',
    'Shaman-Elemental':     'Ele',
    'Shaman-Enhancement':   'Enh',
    'Rogue-Subtlety':       'Sub',
    'Priest-Discipline':    'Disc',
    'Druid-Balance':        'Boomkin',
    'Druid-Cat':            'Feral DPS',
    'Druid-Bear':           'Feral Tank',
};

/** Return "Spec Cls (Abbrev)" if an abbrev exists, otherwise just "Spec Cls". */
function specWithAbbrev(cls, spec) {
    const abbrev = SPEC_ABBREV[`${cls}-${spec}`];
    return abbrev ? `${spec} ${cls} (${abbrev})` : `${spec} ${cls}`;
}

/** Inject the abbreviation into a description that already mentions "Spec Cls". */
function injectAbbrev(desc, cls, spec) {
    const abbrev = SPEC_ABBREV[`${cls}-${spec}`];
    if (!abbrev || !desc) return desc;
    const needle = `${spec} ${cls}`;
    if (desc.includes(needle)) {
        // Replace only the first occurrence, append abbrev *after* the class name
        return desc.replace(needle, `${spec} ${cls} (${abbrev})`);
    }
    return desc;
}

// ─── Per-spec phase descriptions (extracted from app.js) ─────────────
// Only the ones we need for prerendering. Full set lives in app.js.
const SPEC_PHASE_DESCRIPTIONS = require('./prerender-descriptions.js');

// ─── BiS item data (for static BiS summary, prerendered into pages) ──
// Lazy-loaded on first use to keep prerender startup fast.
let _bisData = null;
function getBisData() {
    if (_bisData) return _bisData;
    _bisData = require('./data.json');
    return _bisData;
}

// ─── PvP scraped data (for live arena snapshot, prerendered) ─────────
// js/pvp-data.js is an auto-generated `const PVP_DATA = {...};` script.
// We strip the prefix/suffix and parse as JSON so we can load it in Node.
let _pvpData = null;
function getPvpData() {
    if (_pvpData) return _pvpData;
    const raw = fs.readFileSync(path.join(ROOT, 'js/pvp-data.js'), 'utf8');
    const json = raw.replace(/^const PVP_DATA = /, '').replace(/;\s*$/, '');
    _pvpData = JSON.parse(json);
    return _pvpData;
}

// Static, hand-written PvP context per spec. Rendered as additional FAQ items
// (plain-text answers, since FAQPage JSON-LD requires plain strings and we
// want the visible FAQ to match the structured data exactly).
//
// Key format matches PVP_DATA.specs keys: "Class|Spec".
const PVP_SPEC_CONTEXT = {
    'Warrior|Arms': {
        roleAnswer: `Arms Warriors are the cornerstone of melee cleave compositions in TBC arena. Their value comes almost entirely from Mortal Strike, which applies a 50% healing reduction to the target — turning enemy heals into a finite resource the opposing team has to outlast. Above 2000 rating, Arms is typically played as a swap-and-pressure class: open on a kill target, force defensive cooldowns, then swap to a fresh target while Mortal Strike is still ticking on the original. Stance dancing is core to the spec — Battle Stance for damage and Overpower, Berserker for Whirlwind and crit chance, Defensive for Spell Reflect and Disarm.`,
        compsAnswer: `In 2v2, Warrior/Druid (Resto) is the dominant pairing — sometimes called "WarDin" or just Warrior cleave — followed by Warrior/Paladin (Holy) and Warrior/Priest (Discipline). In 3v3, Warrior/Mage/Druid (WMD) and Warrior/Mage/Priest (WMP) are the textbook setups, with Warrior/Rogue/Druid (WRD) seen as the burst-oriented variant. All three rely on CC chains from the caster to set up Mortal Strike windows.`,
        statsAnswer: `Resilience → Stamina → Strength → Critical Strike Rating → Hit Rating → Expertise. Resilience is non-negotiable in any arena bracket — pieces from the Honor and Arena vendors will outperform raid gear of similar item level once you're being globaled by mages and warlocks. Strength scales Mortal Strike's flat damage, making it the primary offensive stat once Resilience needs are met. Two-handed weapons are mandatory — slow, high-damage weapons maximize Mortal Strike's weapon-damage component.`,
    },
};

// Slot order for the live PvP data summary. PVP_DATA slot keys use "Shoulders"
// and don't have a Two-Hand entry (it's Main Hand for 2H weapons).
const PVP_SLOT_ORDER = [
    'Head', 'Neck', 'Shoulders', 'Back', 'Chest', 'Wrist',
    'Hands', 'Waist', 'Legs', 'Feet',
    'Ring', 'Trinket', 'Main Hand', 'Off Hand', 'Ranged'
];

// Static BiS summary is rendered on all phase pages. Set to a specific URL
// (e.g. '/druid/balance/phase-5') to limit while testing UX changes.
const STATIC_BIS_PROTOTYPE_URL = null;

const STATIC_BIS_SLOT_ORDER = [
    'Head', 'Neck', 'Shoulder', 'Back', 'Chest', 'Wrist',
    'Hands', 'Waist', 'Legs', 'Feet',
    'Ring', 'Trinket',
    'Main Hand', 'Off Hand', 'Two Hand',
    'Ranged/Relic', 'Ranged', 'Relic'
];

/** Pick top-BIS items per slot (1 each, except Ring/Trinket = 2). Returns
 *  ordered array suitable for a summary table. */
function pickTopBisItems(items) {
    const seenIds = new Set();
    const picked = [];
    for (const it of items) {
        if (it.rank !== 'BIS') continue;
        if (seenIds.has(it.itemId)) continue;
        const limit = (it.slot === 'Ring' || it.slot === 'Trinket') ? 2 : 1;
        const count = picked.filter(p => p.slot === it.slot).length;
        if (count >= limit) continue;
        picked.push(it);
        seenIds.add(it.itemId);
    }
    picked.sort((a, b) => {
        const ai = STATIC_BIS_SLOT_ORDER.indexOf(a.slot);
        const bi = STATIC_BIS_SLOT_ORDER.indexOf(b.slot);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
    return picked;
}

/** Build the visible static BiS summary block — a definition-list of top BIS
 *  items per slot with Wowhead links and source descriptions. Used by
 *  Googlebot on first crawl before JS renders the interactive list. */
function buildStaticBisBlock(route) {
    if (route.type !== 'phase') return null;
    const data = getBisData();
    const spec = data.specs.find(s =>
        s.className === route.cls && s.specName === route.spec
    );
    if (!spec || !spec.phases || !spec.phases[route.phase]) return null;
    const phase = spec.phases[route.phase];
    const top = pickTopBisItems(phase.items || []);
    if (!top.length) return null;

    const phLabel = route.phase === 0 ? 'Pre-Raid' : PHASE_NAMES[route.phase].label;
    const heading = `${route.spec} ${route.cls} ${phLabel} BiS Items — Quick Reference`;

    const rows = top.map(it => {
        const src = data.itemSources[it.itemId];
        const srcText = src
            ? [src.source || src.sourceType, src.sourceLocation]
                .filter(Boolean).join(' — ')
            : '';
        const wowheadHref = `https://www.wowhead.com/tbc/item=${it.itemId}`;
        const link = `<a href="${wowheadHref}" rel="external">${escapeHtmlText(it.name)}</a>`;
        const srcSpan = srcText ? `<span class="bis-static-src">(${escapeHtmlText(srcText)})</span>` : '';
        return `<dt>${escapeHtmlText(it.slot)}</dt><dd>${link} ${srcSpan}</dd>`;
    }).join('\n        ');

    return `<h3>${escapeHtmlText(heading)}</h3>
    <dl>
        ${rows}
    </dl>
    <p class="bis-static-note">Interactive view with alternatives, enchants, gems &amp; sim loads below.</p>`;
}

// ─── Route parser ────────────────────────────────────────────────────

function parseRoute(urlPath) {
    const parts = urlPath.replace(/^\//, '').replace(/\/$/, '').split('/').filter(Boolean);

    if (!parts.length) return { type: 'home' };

    if (['about', 'privacy', 'feedback'].includes(parts[0])) {
        return { type: 'static', page: parts[0] };
    }

    const cls = CLASS_SLUG_MAP[parts[0]];
    if (!cls) return null;

    if (parts.length === 1) return { type: 'class', cls };

    let specEntry = SPEC_SLUG_MAP[`${parts[0]}-${parts[1]}`];

    // PvP-only spec slugs (e.g. druid-feral-combat) aren't in CLASS_META.
    if (!specEntry && parts[2] === 'pvp') {
        specEntry = PVP_SPEC_OVERRIDES[`${parts[0]}-${parts[1]}`];
    }
    if (!specEntry) return { type: 'class', cls };          // fall back to class page

    if (parts.length === 2) return { type: 'spec', cls, spec: specEntry.spec };

    if (parts[2] === 'pvp') return { type: 'pvp', cls, spec: specEntry.spec };

    const phase = PHASE_SLUG_MAP[parts[2]];
    if (phase == null) return { type: 'spec', cls, spec: specEntry.spec };

    return { type: 'phase', cls, spec: specEntry.spec, phase };
}

// ─── SEO content per route (mirrors updateSeoMeta in app.js) ─────────

function seoForRoute(route, fullUrl) {
    let title, desc, h1;

    switch (route.type) {
        case 'home':
            title = 'TBC Classic BiS Guide — Best in Slot for Every Class & Spec';
            desc  = 'Complete TBC Classic Best in Slot gear guide for every class and spec — Pre-Raid through Sunwell. Includes enchants, gems, stat priority, and phase-by-phase progression.';
            h1    = 'TBC Best in Slot';
            break;
        case 'static':
            const titleMap = {
                about:    'About — TBC Classic BiS Guide',
                privacy:  'Privacy Policy — TBC Classic BiS Guide',
                feedback: 'Feedback & Roadmap — TBC Classic BiS Guide'
            };
            const descMap = {
                about:    'About the TBC Classic Best in Slot Guide — sources, methodology, and contact.',
                privacy:  'Privacy policy for tbc-bis-guide.com.',
                feedback: 'Send feedback, request new features, or view the public roadmap for TBC BiS Guide.'
            };
            title = titleMap[route.page];
            desc  = descMap[route.page];
            h1    = titleMap[route.page].split(' — ')[0];
            break;
        case 'class':
            title = `${route.cls} BiS Guide — TBC Classic`;
            desc  = `WoW Classic TBC Best in Slot gear for ${route.cls} — every spec, Pre-Raid through Sunwell Plateau. Includes enchants, gems, and stat priority for each phase.`;
            // H1 matches post-JS keyword-rich version (was "Druid"; JS later sets "Druid BiS Guide")
            h1    = `${route.cls} BiS Guide`;
            break;
        case 'spec':
            title = `${route.spec} ${route.cls} BiS Guide — TBC Classic`;
            desc  = `${specWithAbbrev(route.cls, route.spec)} BiS for TBC Classic — Pre-Raid through Sunwell Plateau. Full gear lists with enchants, gems, and stat priority. Pick a phase below.`;
            h1    = `${route.spec} ${route.cls} BiS Guide`;
            break;
        case 'pvp':
            title = `${route.spec} ${route.cls} PvP BiS — TBC Classic`;
            desc  = `Live arena snapshot of the best gear for ${specWithAbbrev(route.cls, route.spec)} PvP in TBC Classic, based on what the highest-rated arena players are wearing right now. Includes enchants and gems.`;
            h1    = `${route.spec} ${route.cls} PvP BiS`;
            break;
        case 'phase':
            const phLabel    = PHASE_NAMES[route.phase].label;
            // SEO label: "Pre-Raid" matches search volume better than "Pre-BiS" (Ahrefs).
            const seoPhLabel = route.phase === 0 ? 'Pre-Raid' : phLabel;
            const phaseSpecDesc = (SPEC_PHASE_DESCRIPTIONS[`${route.cls}-${route.spec}`] || {})[route.phase];
            const bisSuffix = /bis/i.test(seoPhLabel) ? '' : ' BiS';
            title = `${route.spec} ${route.cls} ${seoPhLabel}${bisSuffix} — TBC Classic`;
            desc  = phaseSpecDesc
                ? injectAbbrev(phaseSpecDesc, route.cls, route.spec)
                : `Best in Slot gear for ${specWithAbbrev(route.cls, route.spec)} in TBC Classic ${phLabel}. Full gear list with enchants, gems, stat priority, and item sources.`;
            // H1 matches the keyword-rich title (minus "— TBC Classic" suffix) — same as JS sets post-render
            h1    = `${route.spec} ${route.cls} ${seoPhLabel}${bisSuffix}`;
            break;
        default:
            return null;
    }

    return { title, desc, h1, url: fullUrl };
}

// ─── Visible SEO body content (#seoDescription, #seoFaq, #seoSummary) ─

const PHASE_RAID_CONTEXT = {
    0: 'Pre-Raid dungeons and heroics',
    1: 'Karazhan, Gruul\'s Lair, and Magtheridon\'s Lair',
    2: 'Serpentshrine Cavern and Tempest Keep',
    3: 'Black Temple and Mount Hyjal',
    4: 'Zul\'Aman and Badge of Justice gear',
    5: 'Sunwell Plateau'
};

// Short raid name for anchor-text use (e.g., "Phase 1 (Karazhan)"). Targets
// raid-specific search volume (Sunwell 2300, Karazhan 800, ZA 400 etc.).
const PHASE_RAID_SHORT = {
    0: 'Pre-Raid Dungeons',
    1: 'Karazhan',
    2: 'SSC & TK',
    3: 'Black Temple',
    4: "Zul'Aman",
    5: 'Sunwell'
};

const PHASE_TO_SLUG_REV = { 0:'pre-bis', 1:'phase-1', 2:'phase-2', 3:'phase-3', 4:'phase-4', 5:'phase-5' };

// Lightweight role hint for class-landing spec lists.
const SPEC_ROLE = {
    Arms: 'Melee DPS', Fury: 'Melee DPS', Protection: 'Tank',
    Holy: 'Healer', Retribution: 'Melee DPS', Discipline: 'Healer',
    'Beast Mastery': 'Ranged DPS', Marksmanship: 'Ranged DPS', Survival: 'Ranged DPS',
    Combat: 'Melee DPS', Assassination: 'Melee DPS', Subtlety: 'Melee DPS',
    Shadow: 'Ranged DPS', Elemental: 'Ranged DPS', Enhancement: 'Melee DPS',
    Restoration: 'Healer',
    Arcane: 'Ranged DPS', Fire: 'Ranged DPS', Frost: 'Ranged DPS',
    Affliction: 'Ranged DPS', Demonology: 'Ranged DPS', Destruction: 'Ranged DPS',
    Balance: 'Ranged DPS', Bear: 'Tank', Cat: 'Melee DPS',
};

/** Phase anchor text: e.g. "Phase 1 (Karazhan)", "Pre-Raid (Dungeons)". */
function phaseAnchorText(phase) {
    const label = phase === 0 ? 'Pre-Raid' : PHASE_NAMES[phase].label;
    const raid  = PHASE_RAID_SHORT[phase];
    if (!raid) return label;
    if (phase === 0) return `Pre-Raid (Dungeons)`;
    return `${label} (${raid})`;
}

/** Build the visible #seoDescription content (H2 + paragraph). */
function buildSeoDescriptionBlock(route, seo) {
    if (route.type !== 'phase') return null;
    const seoPhLabel = route.phase === 0 ? 'Pre-Raid' : PHASE_NAMES[route.phase].label;
    const heading = `${specWithAbbrev(route.cls, route.spec)} ${seoPhLabel} BiS Guide`;
    return `<div class="seo-desc-inner">
        <span class="seo-desc-icon">📖</span>
        <div>
            <h2 class="seo-desc-heading">${escapeHtmlText(heading)}</h2>
            <p class="seo-desc-text">${escapeHtmlText(seo.desc)}</p>
        </div>
    </div>`;
}

/** Build the visible #seoFaq content (3 Q&A items in a <dl>). */
function buildSeoFaqBlock(route, seo) {
    if (route.type !== 'phase') return null;
    const phLabel = PHASE_NAMES[route.phase].label;
    const items = [
        {
            q: `What is BiS for ${route.spec} ${route.cls} in ${phLabel}?`,
            a: seo.desc
        },
        {
            q: `Where do I get ${route.spec} ${route.cls} ${phLabel} gear?`,
            a: route.phase === 0
                ? 'The best gear comes from dungeons, heroics, reputation vendors, and crafting. See the full list above with item sources for each slot.'
                : 'The best gear comes from raid drops, Badge of Justice vendor, arena, and crafted items. See the full list above with item sources for each slot.'
        },
        {
            q: `What enchants and gems should ${route.spec} ${route.cls} use in ${phLabel}?`,
            a: `Each slot has a recommended enchant and gem shown next to the item. Enchants and gems are chosen based on the stat priority for ${route.spec} ${route.cls} in TBC Classic.`
        }
    ];
    const dl = items.map(i =>
        `<dt>${escapeHtmlText(i.q)}</dt><dd>${escapeHtmlText(i.a)}</dd>`
    ).join('\n        ');
    return `<h2 class="seo-faq-heading">Frequently Asked Questions</h2>
    <dl>
        ${dl}
    </dl>`;
}

/** Build the visible #seoClassLanding block for class landing pages (e.g. /paladin). */
function buildClassLandingBlock(route, pvpSpecsByClass) {
    if (route.type !== 'class') return null;
    const cls   = route.cls;
    const specs = (CLASS_META[cls] || {}).specs || [];

    const specLis = specs.map(s => {
        const abbrev = SPEC_ABBREV[`${cls}-${s}`];
        const label  = abbrev ? `${s} (${abbrev}) ${cls}` : `${s} ${cls}`;
        const role   = SPEC_ROLE[s] || '';
        const href   = `/${toSlug(cls)}/${toSlug(s)}`;
        return `<li><a href="${href}"><strong>${escapeHtmlText(label)} BiS</strong></a>${role ? ' — ' + escapeHtmlText(role) : ''}</li>`;
    }).join('\n        ');

    // Phase quick-links: one row per spec, all six phases each.
    const phaseSpecBlocks = specs.map(s => {
        const links = [0, 1, 2, 3, 4, 5].map(p => {
            const slug  = PHASE_TO_SLUG_REV[p];
            const href  = `/${toSlug(cls)}/${toSlug(s)}/${slug}`;
            const label = phaseAnchorText(p);
            return `<a href="${href}">${escapeHtmlText(label)}</a>`;
        }).join(' · ');
        return `<p><strong>${escapeHtmlText(s)}:</strong> ${links}</p>`;
    }).join('\n    ');

    // PvP cross-links: only specs that actually have PvP data (sourced from sitemap).
    // Includes PvP-only specs like Druid Feral Combat that aren't in CLASS_META.
    const pvpSpecs = (pvpSpecsByClass && pvpSpecsByClass[cls]) || [];
    const pvpLinks = pvpSpecs.map(spec =>
        `<a href="/${toSlug(cls)}/${toSlug(spec)}/pvp">${escapeHtmlText(spec)} PvP</a>`
    ).join(' · ');

    return `<h2>${escapeHtmlText(cls)} BiS for TBC Classic — Every Spec, Every Phase</h2>
    <p>Best in Slot gear guides for <strong>${escapeHtmlText(cls)}</strong> in WoW Classic TBC. Pick a spec for phase-by-phase BiS lists from Pre-Raid through Sunwell Plateau, including enchants, gems, and stat priority recommendations.</p>
    <h3>${escapeHtmlText(cls)} specs</h3>
    <ul>
        ${specLis}
    </ul>
    ${phaseSpecBlocks ? `<h3>Quick links by phase</h3>\n    ${phaseSpecBlocks}` : ''}
    ${pvpLinks ? `<h3>${escapeHtmlText(cls)} PvP BiS</h3>\n    <p>Live arena snapshot of top-rated players. ${pvpLinks}</p>` : ''}`;
}

/** Build the visible #seoSpecLanding block for spec landing pages (e.g. /paladin/retribution). */
function buildSpecLandingBlock(route) {
    if (route.type !== 'spec') return null;
    const cls    = route.cls;
    const spec   = route.spec;
    const abbrev = SPEC_ABBREV[`${cls}-${spec}`];
    const specFull = abbrev ? `${spec} ${cls} (${abbrev})` : `${spec} ${cls}`;
    const role   = SPEC_ROLE[spec] || '';

    const phaseLis = [0, 1, 2, 3, 4, 5].map(p => {
        const slug  = PHASE_TO_SLUG_REV[p];
        const href  = `/${toSlug(cls)}/${toSlug(spec)}/${slug}`;
        const phLabel = p === 0 ? 'Pre-Raid BiS' : `${PHASE_NAMES[p].label} BiS`;
        const raid    = PHASE_RAID_CONTEXT[p];
        return `<li><a href="${href}"><strong>${escapeHtmlText(phLabel)}</strong></a> — ${escapeHtmlText(raid)}</li>`;
    }).join('\n        ');

    const otherSpecs = (CLASS_META[cls] ? CLASS_META[cls].specs : [])
        .filter(s => s !== spec)
        .map(s => {
            const a = SPEC_ABBREV[`${cls}-${s}`];
            const label = a ? `${s} (${a})` : s;
            return `<a href="/${toSlug(cls)}/${toSlug(s)}">${escapeHtmlText(label)}</a>`;
        }).join(' · ');

    return `<h2>${escapeHtmlText(specFull)} BiS for TBC Classic</h2>
    <p>Best in Slot gear lists for <strong>${escapeHtmlText(specFull)}</strong>${role ? ` (${escapeHtmlText(role)})` : ''} in TBC Classic. Choose a phase below for the full gear list with enchants, gems, stat priority, and item sources.</p>
    <h3>Phase guides</h3>
    <ul>
        ${phaseLis}
    </ul>
    ${otherSpecs ? `<h3>Other ${escapeHtmlText(cls)} specs</h3>\n    <p>${otherSpecs}</p>` : ''}`;
}

/** Build the visible #seoDescription content (H2 + paragraph) for PvP landing pages.
 *  Stays intentionally minimal — arena role / comps / stat priority live in the
 *  FAQ block below so the page doesn't open with a wall of text. */
function buildPvpDescriptionBlock(route, seo) {
    if (route.type !== 'pvp') return null;
    const spec = specWithAbbrev(route.cls, route.spec);
    return `<div class="seo-desc-inner">
        <span class="seo-desc-icon">⚔️</span>
        <div>
            <h2 class="seo-desc-heading">${escapeHtmlText(spec)} PvP BiS — TBC Classic Arena</h2>
            <p class="seo-desc-text">${escapeHtmlText(seo.desc)}</p>
        </div>
    </div>`;
}

/** Return the spec's PvP data block (PVP_DATA.specs[key]) or null if missing.
 *  PvP-only specs like Druid Feral Combat are keyed by their scraped name, which
 *  matches route.spec for those (we route them via PVP_SPEC_OVERRIDES). */
function getPvpSpecData(route) {
    if (route.type !== 'pvp') return null;
    const data = getPvpData();
    return (data.specs || {})[`${route.cls}|${route.spec}`] || null;
}

/** Build a "live arena snapshot" block: meta line + dl of top-popularity items
 *  per slot. Reuses the #bisStaticSummary container (same CSS as the PvE block).
 *  Returns null if PVP_DATA has no entry for this spec. */
function buildPvpDataSummaryBlock(route) {
    const sd = getPvpSpecData(route);
    if (!sd) return null;
    const rr = sd.ratingRange || {};
    const rows = PVP_SLOT_ORDER.map(slot => {
        const items = sd.slots && sd.slots[slot];
        if (!items || !items.length) return null;
        const top = items[0];
        const href = `https://www.wowhead.com/tbc/item=${top.id}`;
        return `<dt>${escapeHtmlText(slot)}</dt><dd><a href="${href}" rel="external">${escapeHtmlText(top.name)}</a> <span class="bis-static-src">(${top.popularity}% of players)</span></dd>`;
    }).filter(Boolean).join('\n        ');

    return `<h3>Most-used gear — live arena snapshot</h3>
    <p>Across <strong>${sd.playerCount}</strong> top-rated ${escapeHtmlText(route.spec)} ${escapeHtmlText(route.cls)}s in this snapshot (rating <strong>${rr.min}–${rr.max}</strong>, average <strong>${rr.avg}</strong>), the most popular pick per slot is shown below. Full alternatives, gem and enchant breakdowns are in the interactive list further down.</p>
    <dl>
        ${rows}
    </dl>`;
}

/** Build the auto-generated PvP FAQ block (visible). Combines static spec
 *  context (if authored) with five data-driven Q&A from scraped PVP_DATA. */
function buildPvpFaqBlock(route) {
    if (route.type !== 'pvp') return null;
    const sd = getPvpSpecData(route);
    const items = buildPvpFaqItems(route, sd);
    if (!items.length) return null;
    const dl = items.map(i =>
        `<dt>${escapeHtmlText(i.q)}</dt><dd>${escapeHtmlText(i.a)}</dd>`
    ).join('\n        ');
    return `<h2 class="seo-faq-heading">Frequently Asked Questions</h2>
    <dl>
        ${dl}
    </dl>`;
}

/** Shared PvP FAQ item list — used both for visible block and FAQPage JSON-LD,
 *  so the structured data matches exactly what the user sees.
 *
 *  Order: static spec context first (arena role, comps, stats) when we have it,
 *  then dynamic data-driven Q&A. Top placement of context Q&A means users see
 *  it expanded near the page top while keeping the intro short. */
function buildPvpFaqItems(route, sd) {
    const items = [];
    const specName = `${route.spec} ${route.cls}`;

    // Static spec context (when authored) — placed at the top of FAQ.
    const ctx = PVP_SPEC_CONTEXT[`${route.cls}|${route.spec}`];
    if (ctx) {
        if (ctx.roleAnswer) {
            items.push({
                q: `What is ${specName}'s role in TBC arena?`,
                a: ctx.roleAnswer,
            });
        }
        if (ctx.compsAnswer) {
            items.push({
                q: `Which arena compositions are strongest for ${specName}?`,
                a: ctx.compsAnswer,
            });
        }
        if (ctx.statsAnswer) {
            items.push({
                q: `What is the PvP stat priority for ${specName}?`,
                a: ctx.statsAnswer,
            });
        }
    }

    // Dynamic data-driven Q&A — skip if no scraped data for this spec.
    if (!sd) return items;
    const rr = sd.ratingRange || {};

    // Q1: top chest piece (high-popularity gold/strong tier item)
    const chest = (sd.slots && sd.slots.Chest && sd.slots.Chest[0]);
    if (chest) {
        items.push({
            q: `What chest piece do top ${specName} arena players wear?`,
            a: `${chest.name} is worn by ${chest.popularity}% of the ${sd.playerCount} top-rated ${specName}s analyzed in this snapshot. See alternatives and enchant choices in the live list above.`
        });
    }

    // Q2: chest enchant — Resilience-or-similar pattern
    const chestEnchant = chest && chest.topEnchants && chest.topEnchants[0];
    if (chestEnchant) {
        items.push({
            q: `What chest enchant should ${specName} use in PvP?`,
            a: `${cleanEnchantName(chestEnchant.name)} is used by ${chestEnchant.usage}% of top arena players in this spec, making it the standard PvP chest enchant.`
        });
    }

    // Q3: weapon
    const mainHand = sd.slots && sd.slots['Main Hand'] && sd.slots['Main Hand'][0];
    if (mainHand) {
        items.push({
            q: `What weapon do top ${specName} PvP players use?`,
            a: `${mainHand.name} is the most popular choice at ${mainHand.popularity}% usage. Weapon choice in TBC PvP often comes down to whether you've cleared the relevant rating gate or can afford the gold/honor cost — see alternatives in the live list above.`
        });
    }

    // Q4: rating range / data source
    items.push({
        q: `What rating range does this ${specName} PvP BiS list cover?`,
        a: `Data is based on ${sd.playerCount} ${specName} arena players rated between ${rr.min} and ${rr.max} (average ${rr.avg}). The list is refreshed weekly from ironforge.pro's arena leaderboard scrape.`
    });

    // Q5: PvE crossover
    items.push({
        q: `Should ${specName} use PvE gear in arena?`,
        a: `Some PvE epics with high stat budgets are worn by top arena players when the slot's PvP option is weak — they're marked "PvE flex" in the live list. However, Resilience-bearing pieces from the Honor and Arena vendors are still the foundation of any PvP gear set.`
    });

    return items;
}

/** Strip the "Enchanted: " prefix used in some PVP_DATA enchant names so the
 *  FAQ reads naturally ("+15 Resilience Rating" instead of "Enchanted: +15..."). */
function cleanEnchantName(name) {
    return String(name || '').replace(/^Enchanted:\s*/, '');
}

/** Build the visible PvP summary (cross-links to PvE BiS + sibling PvP specs +
 *  data refresh meta). */
function buildPvpSummaryBlock(route) {
    if (route.type !== 'pvp') return null;
    const cls  = route.cls;
    const spec = route.spec;

    const pveLink = `<a href="/${toSlug(cls)}/${toSlug(spec)}"><strong>${escapeHtmlText(spec)} ${escapeHtmlText(cls)} PvE BiS</strong></a>`;

    const otherSpecs = (CLASS_META[cls] ? CLASS_META[cls].specs : [])
        .filter(s => s !== spec)
        .map(s => {
            const a = SPEC_ABBREV[`${cls}-${s}`];
            const label = a ? `${s} (${a})` : s;
            return `<a href="/${toSlug(cls)}/${toSlug(s)}/pvp">${escapeHtmlText(label)} PvP</a>`;
        }).join(' · ');

    // Data freshness paragraph — visible E-E-A-T signal explaining methodology.
    const sd = getPvpSpecData(route);
    let dataNote = '';
    if (sd) {
        const data = getPvpData();
        const analyzedAt = (data.meta && data.meta.analyzedAt) ? data.meta.analyzedAt.slice(0, 10) : null;
        dataNote = `<p><em>How this list is built:</em> the items above are aggregated from the public arena leaderboard scrape at ironforge.pro, filtered to ${escapeHtmlText(spec)} ${escapeHtmlText(cls)}s within a competitive rating range. The snapshot refreshes weekly so the rankings track the live meta.${analyzedAt ? ` Current snapshot analyzed on ${escapeHtmlText(analyzedAt)}.` : ''}</p>`;
    }

    return `${dataNote}<p>Looking for raid gear instead? See ${pveLink} for phase-by-phase PvE Best in Slot.</p>
    ${otherSpecs ? `<p>Other ${escapeHtmlText(cls)} PvP specs: ${otherSpecs}</p>` : ''}`;
}

/** Build the visible #seoSummary content (closing paragraph + cross-links). */
function buildSeoSummaryBlock(route) {
    if (route.type !== 'phase') return null;
    const seoPhLabel = route.phase === 0 ? 'Pre-Raid' : PHASE_NAMES[route.phase].label;
    const raid = PHASE_RAID_CONTEXT[route.phase];
    const specName = specWithAbbrev(route.cls, route.spec);

    // Sibling-phase cross-links with raid-context anchor text
    // ("Phase 1 (Karazhan)" captures raid keyword volume in addition to phase keyword).
    const otherPhases = [0, 1, 2, 3, 4, 5]
        .filter(p => p !== route.phase)
        .map(p => {
            const slug  = PHASE_TO_SLUG_REV[p];
            const label = phaseAnchorText(p);
            const href  = `/${toSlug(route.cls)}/${toSlug(route.spec)}/${slug}`;
            return `<a href="${href}">${escapeHtmlText(label)}</a>`;
        }).join(' · ');

    // Sibling-spec cross-links (other specs in same class, same phase)
    const otherSpecs = (CLASS_META[route.cls] ? CLASS_META[route.cls].specs : [])
        .filter(s => s !== route.spec)
        .map(s => {
            const abbrev = SPEC_ABBREV[`${route.cls}-${s}`];
            const label = abbrev ? `${s} (${abbrev})` : s;
            const href = `/${toSlug(route.cls)}/${toSlug(s)}/${PHASE_TO_SLUG_REV[route.phase]}`;
            return `<a href="${href}">${escapeHtmlText(label)}</a>`;
        }).join(' · ');

    let html = `<p>This <strong>${escapeHtmlText(specName)} ${escapeHtmlText(seoPhLabel)} Best in Slot</strong> list covers gear for ${escapeHtmlText(raid)} in TBC Classic — including enchants, gems, and stat priority recommendations.</p>
    <p>Other phases: ${otherPhases}</p>`;
    if (otherSpecs) {
        html += `\n    <p>Other ${escapeHtmlText(route.cls)} specs (${escapeHtmlText(seoPhLabel)}): ${otherSpecs}</p>`;
    }
    return html;
}

// ─── JSON-LD builder ─────────────────────────────────────────────────

function buildJsonLd(route, seo) {
    const schemas = [];

    schemas.push({
        '@context': 'https://schema.org',
        '@type':    'WebPage',
        name:        seo.title,
        description: seo.desc,
        url:         seo.url,
        isPartOf: { '@type': 'WebSite', name: 'TBC BiS Guide', url: BASE_URL + '/' }
    });

    if (route.cls) {
        const items = [];
        let pos = 1;
        items.push({ '@type': 'ListItem', position: pos++, name: 'Home', item: BASE_URL + '/' });
        items.push({ '@type': 'ListItem', position: pos++, name: route.cls, item: BASE_URL + '/' + toSlug(route.cls) });

        if (route.spec) {
            items.push({
                '@type': 'ListItem', position: pos++,
                name: route.spec,
                item: BASE_URL + '/' + toSlug(route.cls) + '/' + toSlug(route.spec)
            });
            if (route.type === 'pvp') {
                items.push({ '@type': 'ListItem', position: pos++, name: 'PvP', item: seo.url });
            } else if (route.type === 'phase') {
                items.push({
                    '@type': 'ListItem', position: pos++,
                    name: PHASE_NAMES[route.phase].label,
                    item: seo.url
                });
            }
        }

        schemas.push({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items });
    }

    if (route.type === 'phase' || route.type === 'pvp') {
        schemas.push({
            '@context': 'https://schema.org',
            '@type':    'ItemList',
            name:        seo.title,
            description: seo.desc,
            url:         seo.url
        });
    }

    // Article schema for phase + PvP pages — eligible for rich results in search.
    // datePublished is fixed (original go-live); dateModified bumps on every prerender.
    if (route.type === 'phase' || route.type === 'pvp') {
        const today = new Date().toISOString().slice(0, 10);
        schemas.push({
            '@context': 'https://schema.org',
            '@type':    'Article',
            headline:    seo.title,
            description: seo.desc,
            url:         seo.url,
            datePublished: '2026-04-01',
            dateModified:  today,
            image:        BASE_URL + '/og-image.png',
            author: {
                '@type': 'Organization',
                name:    'TBC BiS Guide',
                url:     BASE_URL + '/'
            },
            publisher: {
                '@type': 'Organization',
                name:    'TBC BiS Guide',
                url:     BASE_URL + '/',
                logo: {
                    '@type': 'ImageObject',
                    url:     BASE_URL + '/android-chrome-192x192.png'
                }
            },
            mainEntityOfPage: {
                '@type': 'WebPage',
                '@id':   seo.url
            }
        });
    }

    if (route.type === 'phase') {
        const phLabel = PHASE_NAMES[route.phase].label;
        const faq = [
            {
                q: `What is BiS for ${route.spec} ${route.cls} in ${phLabel}?`,
                a: seo.desc
            },
            {
                q: `Where do I get ${route.spec} ${route.cls} ${phLabel} gear?`,
                a: 'The best gear comes from ' +
                    (route.phase === 0
                        ? 'dungeons, heroics, reputation vendors, and crafting.'
                        : 'raid drops, Badge of Justice vendor, arena, and crafted items.') +
                    ' See the full list above with item sources for each slot.'
            },
            {
                q: `What enchants should ${route.spec} ${route.cls} use in ${phLabel}?`,
                a: `Each slot has a recommended enchant shown next to the item. Enchants are chosen based on stat weights for ${route.spec} ${route.cls} in TBC Classic.`
            }
        ];
        schemas.push({
            '@context': 'https://schema.org',
            '@type':    'FAQPage',
            mainEntity: faq.map(f => ({
                '@type': 'Question',
                name: f.q,
                acceptedAnswer: { '@type': 'Answer', text: f.a }
            }))
        });
    }

    // FAQPage schema for PvP pages — questions/answers must mirror the visible
    // FAQ block exactly (Google flags mismatched structured data).
    if (route.type === 'pvp') {
        const sd = getPvpSpecData(route);
        const faq = buildPvpFaqItems(route, sd);
        if (faq.length) {
            schemas.push({
                '@context': 'https://schema.org',
                '@type':    'FAQPage',
                mainEntity: faq.map(f => ({
                    '@type': 'Question',
                    name: f.q,
                    acceptedAnswer: { '@type': 'Answer', text: f.a }
                }))
            });
        }
    }

    return schemas.map(s =>
        `<script type="application/ld+json" data-bis-jsonld>${JSON.stringify(s)}</script>`
    ).join('\n    ');
}

// ─── HTML rewriter ───────────────────────────────────────────────────

function escapeHtmlAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtmlText(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function rewriteHtml(template, seo, jsonLd, bodyBlocks) {
    let html = template;

    // <title>
    html = html.replace(
        /<title>[\s\S]*?<\/title>/,
        `<title>${escapeHtmlText(seo.title)}</title>`
    );

    // <meta name="description">
    html = html.replace(
        /<meta id="metaDescription"[^>]*>/,
        `<meta id="metaDescription" name="description" content="${escapeHtmlAttr(seo.desc)}">`
    );

    // <link rel="canonical">  +  drop the inline JS that overwrites it
    html = html.replace(
        /<link id="canonicalLink"[^>]*>\s*<script>document\.getElementById\('canonicalLink'\)[^<]*<\/script>/,
        `<link id="canonicalLink" rel="canonical" href="${escapeHtmlAttr(seo.url)}">`
    );

    // OG URL  +  drop its inline JS overwrite
    html = html.replace(
        /<meta id="ogUrl"[^>]*>\s*<script>document\.getElementById\('ogUrl'\)[^<]*<\/script>/,
        `<meta id="ogUrl" property="og:url" content="${escapeHtmlAttr(seo.url)}">`
    );

    // OG title / description
    html = html.replace(
        /<meta id="ogTitle"[^>]*>/,
        `<meta id="ogTitle" property="og:title" content="${escapeHtmlAttr(seo.title)}">`
    );
    html = html.replace(
        /<meta id="ogDescription"[^>]*>/,
        `<meta id="ogDescription" property="og:description" content="${escapeHtmlAttr(seo.desc)}">`
    );

    // Twitter title / description
    html = html.replace(
        /<meta id="twTitle"[^>]*>/,
        `<meta id="twTitle" name="twitter:title" content="${escapeHtmlAttr(seo.title)}">`
    );
    html = html.replace(
        /<meta id="twDescription"[^>]*>/,
        `<meta id="twDescription" name="twitter:description" content="${escapeHtmlAttr(seo.desc)}">`
    );

    // JSON-LD: inject right before </head>
    html = html.replace(
        /<\/head>/,
        `    ${jsonLd}\n</head>`
    );

    // H1 (#headerTitle)
    html = html.replace(
        /<h1 id="headerTitle">[\s\S]*?<\/h1>/,
        `<h1 id="headerTitle">${escapeHtmlText(seo.h1)}</h1>`
    );

    // Body content: visible SEO blocks
    if (bodyBlocks) {
        if (bodyBlocks.seoDesc) {
            html = html.replace(
                /<div class="seo-description hidden" id="seoDescription"><\/div>/,
                `<div class="seo-description" id="seoDescription">${bodyBlocks.seoDesc}</div>`
            );
        }
        if (bodyBlocks.seoFaq) {
            html = html.replace(
                /<section class="seo-faq hidden" id="seoFaq"([^>]*)><\/section>/,
                `<section class="seo-faq" id="seoFaq"$1>${bodyBlocks.seoFaq}</section>`
            );
        }
        if (bodyBlocks.seoSummary) {
            html = html.replace(
                /<div class="seo-summary hidden" id="seoSummary"><\/div>/,
                `<div class="seo-summary" id="seoSummary">${bodyBlocks.seoSummary}</div>`
            );
        }
        // Class landing (#seoClassLanding) — visible content for /paladin, /warrior, etc.
        if (bodyBlocks.classLanding) {
            html = html.replace(
                /<div class="seo-landing hidden" id="seoClassLanding"><\/div>/,
                `<div class="seo-landing" id="seoClassLanding">${bodyBlocks.classLanding}</div>`
            );
        }
        // Spec landing (#seoSpecLanding) — visible content for /paladin/retribution, etc.
        if (bodyBlocks.specLanding) {
            html = html.replace(
                /<div class="seo-landing hidden" id="seoSpecLanding"><\/div>/,
                `<div class="seo-landing" id="seoSpecLanding">${bodyBlocks.specLanding}</div>`
            );
        }
        // Static BiS summary (#bisStaticSummary) — prerendered top BIS per slot.
        if (bodyBlocks.staticBis) {
            html = html.replace(
                /<div class="bis-static-summary hidden" id="bisStaticSummary"><\/div>/,
                `<div class="bis-static-summary" id="bisStaticSummary">${bodyBlocks.staticBis}</div>`
            );
        }
    }

    return html;
}

// ─── Main ────────────────────────────────────────────────────────────

function parseSitemap(sitemapPath) {
    const xml = fs.readFileSync(sitemapPath, 'utf8');
    const urls = [];
    const re = /<loc>([^<]+)<\/loc>/g;
    let m;
    while ((m = re.exec(xml))) {
        const u = m[1].trim();
        if (u.startsWith(BASE_URL)) {
            const p = u.slice(BASE_URL.length) || '/';
            urls.push(p);
        }
    }
    return urls;
}

/** Build a { [className]: [specName, ...] } map of specs that have PvP pages,
 *  sourced from sitemap.xml so we never link to a non-existent /cls/spec/pvp URL.
 *  Resolves slug pairs via SPEC_SLUG_MAP and PVP_SPEC_OVERRIDES (for PvP-only
 *  specs like Druid Feral Combat that aren't in CLASS_META). */
function loadPvpSpecsFromSitemap(sitemapPath) {
    const xml = fs.readFileSync(sitemapPath, 'utf8');
    const byClass = {};
    const re = /<loc>([^<]+)<\/loc>/g;
    let m;
    while ((m = re.exec(xml))) {
        const u = m[1].trim();
        if (!u.startsWith(BASE_URL)) continue;
        const p = u.slice(BASE_URL.length).replace(/^\//, '').replace(/\/$/, '');
        const parts = p.split('/');
        if (parts.length !== 3 || parts[2] !== 'pvp') continue;
        const key = `${parts[0]}-${parts[1]}`;
        const entry = SPEC_SLUG_MAP[key] || PVP_SPEC_OVERRIDES[key];
        if (!entry) continue;
        if (!byClass[entry.cls]) byClass[entry.cls] = [];
        if (!byClass[entry.cls].includes(entry.spec)) byClass[entry.cls].push(entry.spec);
    }
    return byClass;
}

function urlToOutputPath(urlPath) {
    if (urlPath === '/') return path.join(ROOT, 'index.html');
    const clean = urlPath.replace(/^\//, '').replace(/\/$/, '');
    return path.join(ROOT, clean, 'index.html');
}

/** Bump every <lastmod> in sitemap.xml / sitemap-index.xml to today's date. */
function updateSitemapDates() {
    const today = new Date().toISOString().slice(0, 10);   // YYYY-MM-DD
    for (const file of ['sitemap.xml', 'sitemap-index.xml']) {
        const p = path.join(ROOT, file);
        if (!fs.existsSync(p)) continue;
        const before = fs.readFileSync(p, 'utf8');
        const after  = before.replace(/<lastmod>[^<]*<\/lastmod>/g, `<lastmod>${today}</lastmod>`);
        if (after !== before) {
            fs.writeFileSync(p, after);
            console.log(`✓ Updated <lastmod> dates in ${file} → ${today}`);
        }
    }
}

function main() {
    const args = process.argv.slice(2);
    const onlyIdx = args.indexOf('--only');
    const dryRun  = args.includes('--dry-run');
    const only    = onlyIdx >= 0 ? args[onlyIdx + 1] : null;

    if (!only && !dryRun) updateSitemapDates();

    const template = fs.readFileSync(TEMPLATE, 'utf8');
    const sitemapPath = path.join(ROOT, 'sitemap.xml');
    const pvpSpecsByClass = loadPvpSpecsFromSitemap(sitemapPath);

    let urls;
    if (only) {
        urls = [only];
    } else {
        urls = parseSitemap(sitemapPath);
    }

    let written = 0, skipped = 0, failed = 0;

    for (const urlPath of urls) {
        if (urlPath === '/') {
            // Skip the home page — template already serves it correctly
            skipped++;
            continue;
        }

        const route = parseRoute(urlPath);
        if (!route) {
            console.warn(`✗ Unknown route: ${urlPath}`);
            failed++;
            continue;
        }

        const fullUrl = BASE_URL + urlPath;
        const seo = seoForRoute(route, fullUrl);
        if (!seo) {
            console.warn(`✗ No SEO data for: ${urlPath}`);
            failed++;
            continue;
        }

        const jsonLd = buildJsonLd(route, seo);
        // Phase pages get description+FAQ+summary; PvP pages get a PvP-specific
        // description and summary (no FAQ, since arena gear has fewer canonical Q&A);
        // class/spec landing pages get their dedicated landing blocks.
        // Prototype: static BiS only on the prototype URL while we verify UX.
        const enableStaticBis = STATIC_BIS_PROTOTYPE_URL === null || urlPath === STATIC_BIS_PROTOTYPE_URL;
        const bodyBlocks = {
            seoDesc:      buildSeoDescriptionBlock(route, seo) || buildPvpDescriptionBlock(route, seo),
            seoFaq:       buildSeoFaqBlock(route, seo) || buildPvpFaqBlock(route),
            seoSummary:   buildSeoSummaryBlock(route) || buildPvpSummaryBlock(route),
            classLanding: buildClassLandingBlock(route, pvpSpecsByClass),
            specLanding:  buildSpecLandingBlock(route),
            staticBis:    enableStaticBis
                ? (buildStaticBisBlock(route) || buildPvpDataSummaryBlock(route))
                : null,
        };
        const html = rewriteHtml(template, seo, jsonLd, bodyBlocks);
        const outPath = urlToOutputPath(urlPath);

        if (dryRun) {
            console.log(`(dry) ${urlPath}\n  title: ${seo.title}\n  → ${path.relative(ROOT, outPath)}`);
            continue;
        }

        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, html);
        console.log(`✓ ${urlPath} → ${path.relative(ROOT, outPath)}`);
        written++;
    }

    console.log(`\nDone. Written: ${written}  Skipped: ${skipped}  Failed: ${failed}`);
}

main();
