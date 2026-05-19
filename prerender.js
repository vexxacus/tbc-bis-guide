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

const BASE_URL  = 'https://tbc-bis-guide.web.app';
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
            desc  = 'Complete TBC Classic Best in Slot gear guide for every class and spec — Pre-BiS through Sunwell. Includes enchants, gems, and phase-by-phase progression.';
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
                privacy:  'Privacy policy for tbc-bis-guide.web.app.',
                feedback: 'Send feedback, request new features, or view the public roadmap for TBC BiS Guide.'
            };
            title = titleMap[route.page];
            desc  = descMap[route.page];
            h1    = titleMap[route.page].split(' — ')[0];
            break;
        case 'class':
            title = `${route.cls} BiS Guide — TBC Classic`;
            desc  = `WoW Classic TBC Best in Slot gear for ${route.cls} — every spec, Pre-Raid through Sunwell Plateau. Includes enchants, gems, and stat priority for each phase.`;
            h1    = route.cls;
            break;
        case 'spec':
            title = `${route.spec} ${route.cls} BiS Guide — TBC Classic`;
            desc  = `${specWithAbbrev(route.cls, route.spec)} BiS for TBC Classic — Pre-Raid through Sunwell Plateau. Full gear lists with enchants, gems, and stat priority. Pick a phase below.`;
            h1    = `${route.cls} — ${route.spec}`;
            break;
        case 'pvp':
            title = `${route.spec} ${route.cls} PvP BiS — TBC Classic`;
            desc  = `Live arena snapshot of the best gear for ${specWithAbbrev(route.cls, route.spec)} PvP in TBC Classic, based on what the highest-rated arena players are wearing right now. Includes enchants and gems.`;
            h1    = `${route.cls} — ${route.spec} PvP`;
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
            h1    = `${route.spec} — ${phLabel}`;   // UI keeps the "Pre-BiS" label
            break;
        default:
            return null;
    }

    return { title, desc, h1, url: fullUrl };
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

function rewriteHtml(template, seo, jsonLd) {
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

function urlToOutputPath(urlPath) {
    if (urlPath === '/') return path.join(ROOT, 'index.html');
    const clean = urlPath.replace(/^\//, '').replace(/\/$/, '');
    return path.join(ROOT, clean, 'index.html');
}

function main() {
    const args = process.argv.slice(2);
    const onlyIdx = args.indexOf('--only');
    const dryRun  = args.includes('--dry-run');
    const only    = onlyIdx >= 0 ? args[onlyIdx + 1] : null;

    const template = fs.readFileSync(TEMPLATE, 'utf8');

    let urls;
    if (only) {
        urls = [only];
    } else {
        urls = parseSitemap(path.join(ROOT, 'sitemap.xml'));
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
        const html = rewriteHtml(template, seo, jsonLd);
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
