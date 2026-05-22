/* ═══════════════════════════════════════════════════════════════════════
   TBC BiS Guide — App Controller (v3 – Wowhead tooltips + PvP + Icons)
   ═══════════════════════════════════════════════════════════════════════ */

(() => {
    'use strict';

    // ─── State ───────────────────────────────────────────────────────
    const state = {
        selectedClass: null,
        selectedSpec: null,
        selectedPhase: null,
        isPvP: false,
        pvpKey: null,   // e.g. "Rogue|Subtlety" — key into PVP_DATA.specs
        history: [],
        excludedProfessions: new Set(),  // professions to hide from BiS list
        hidePvpRating: false,            // hide rating-gated PvP items (Merciless/Vengeful/Brutal weapons & shoulders)
        _pvpRatingLoaded: false,
        hideWorldBoss: false,            // hide items that drop from outdoor world bosses
        _worldBossLoaded: false,
        selectedItems: {},              // { "warrior-fury|3": { "Head": 29021 } } — user-chosen item overrides per slot
    };

    // ─── Item Selection helpers ──────────────────────────────────────
    /** Key into selectedItems for current spec+phase */
    function selectionKey() {
        const cls   = (state.selectedClass  || '').toLowerCase().replace(/\s+/g, '-');
        const spec  = (state.selectedSpec   || '').toLowerCase().replace(/\s+/g, '-');
        const phase = state.selectedPhase ?? 'x';
        return `${cls}-${spec}|${phase}`;
    }

    /** Return the user-selected item for a slot, or si[0] (BiS) as default */
    function getActiveItem(slot, slotItems) {
        const key = selectionKey();
        const overrideId = state.selectedItems[key]?.[slot];
        if (overrideId == null) return slotItems[0];
        const found = slotItems.find(i => String(i.itemId) === String(overrideId));
        return found || slotItems[0]; // fallback to BiS if item no longer in list (e.g. filtered out)
    }

    /** Set user selection for a slot; pass null to reset to BiS */
    function setSelectedItem(slot, itemId) {
        const key = selectionKey();
        if (!state.selectedItems[key]) state.selectedItems[key] = {};
        if (itemId == null) {
            delete state.selectedItems[key][slot];
        } else {
            state.selectedItems[key][slot] = String(itemId);
        }
        // Persist to localStorage
        try {
            localStorage.setItem('tbc-bis-selected-items', JSON.stringify(state.selectedItems));
        } catch (_) {}
        // Update URL with build param
        updateUrlWithBuild();
    }

    /** Load persisted selections from localStorage */
    function loadSelectedItems() {
        try {
            const raw = localStorage.getItem('tbc-bis-selected-items');
            if (raw) state.selectedItems = JSON.parse(raw);
        } catch (_) { state.selectedItems = {}; }
    }
    loadSelectedItems();

    // ─── Share Build helpers ─────────────────────────────────────────

    /** Slot name → short code for compact URL encoding */
    const SLOT_CODES = {
        'Head':'H','Neck':'N','Shoulder':'Sh','Back':'B','Chest':'C',
        'Wrist':'Wr','Hands':'G','Waist':'W','Legs':'L','Feet':'F',
        'Ring 1':'R1','Ring 2':'R2','Trinket 1':'T1','Trinket 2':'T2',
        'Rings':'Ri','Trinkets':'Tr',
        'Main Hand':'MH','Off Hand':'OH','Two-Hand':'2H','Ranged':'Ra',
        'Relic':'Re','Totem':'To','Libram':'Li','Idol':'Id','Sigil':'Si',
        'Wand':'Wa'
    };
    const CODE_TO_SLOT = Object.fromEntries(Object.entries(SLOT_CODES).map(([k,v])=>[v,k]));

    /** Encode current overrides for the active spec+phase into a compact query string value */
    function encodeBuild() {
        const key = selectionKey();
        const overrides = state.selectedItems[key];
        if (!overrides || !Object.keys(overrides).length) return null;
        // Format: SlotCode.ItemId~SlotCode.ItemId  (e.g. MH.28767~OH.28573)
        const parts = [];
        for (const [slot, itemId] of Object.entries(overrides)) {
            const code = SLOT_CODES[slot] || slot;
            parts.push(`${code}.${itemId}`);
        }
        return parts.join('~');
    }

    /** Encode filter toggles into a compact string for URL */
    function encodeFilters() {
        const parts = [];
        if (state.excludedProfessions.size) {
            // Short profession codes
            const profCodes = { 'Blacksmithing':'bs','Jewelcrafting':'jc','Leatherworking':'lw','Tailoring':'tw','Engineering':'en','Alchemy':'al','Enchanting':'ec' };
            const excluded = [...state.excludedProfessions].map(p => profCodes[p] || p.substring(0,2).toLowerCase()).join(',');
            parts.push(`xp=${excluded}`);
        }
        if (state.hidePvpRating) parts.push('pvp=0');
        if (state.hideWorldBoss) parts.push('wb=0');
        return parts.join('&');
    }

    /** Decode filter params from URL search params */
    function decodeFilters(params) {
        const profMap = { 'bs':'Blacksmithing','jc':'Jewelcrafting','lw':'Leatherworking','tw':'Tailoring','en':'Engineering','al':'Alchemy','ec':'Enchanting' };
        const xp = params.get('xp');
        if (xp) {
            state.excludedProfessions = new Set(xp.split(',').map(c => profMap[c] || c));
            try { localStorage.setItem('tbc-bis-excluded-profs', JSON.stringify([...state.excludedProfessions])); } catch(_) {}
        }
        if (params.get('pvp') === '0') {
            state.hidePvpRating = true;
            try { localStorage.setItem('tbc-bis-hide-pvp-rating', '1'); } catch(_) {}
        }
        if (params.get('wb') === '0') {
            state.hideWorldBoss = true;
            try { localStorage.setItem('tbc-bis-hide-world-boss', '1'); } catch(_) {}
        }
    }

    /** Decode a build string from URL and apply as overrides for the active spec+phase */
    function decodeBuild(buildStr) {
        if (!buildStr) return;
        const key = selectionKey();
        if (!state.selectedItems[key]) state.selectedItems[key] = {};
        for (const part of buildStr.split('~')) {
            const dot = part.indexOf('.');
            if (dot === -1) continue;
            const code = part.substring(0, dot);
            const itemId = part.substring(dot + 1);
            const slot = CODE_TO_SLOT[code] || code;
            state.selectedItems[key][slot] = String(itemId);
        }
        // Persist to localStorage too
        try { localStorage.setItem('tbc-bis-selected-items', JSON.stringify(state.selectedItems)); } catch(_) {}
    }

    /** Check if there's a ?build= param and return its value */
    function getBuildFromUrl() {
        const params = new URLSearchParams(location.search);
        return params.get('build');
    }

    /** Build the full shareable URL including build overrides and filter state */
    function buildShareUrl() {
        const base = location.origin + buildPath();
        const parts = [];
        const build = encodeBuild();
        if (build) parts.push(`build=${build}`);
        const filters = encodeFilters();
        if (filters) parts.push(filters);
        return parts.length ? `${base}?${parts.join('&')}` : base;
    }

    /** Update the URL with or without build/filter params (replaceState) */
    function updateUrlWithBuild() {
        const url = buildShareUrl();
        history.replaceState(history.state, '', url);
    }

    // ─── SEO / URL routing ───────────────────────────────────────────

    /** Convert display names to URL-friendly slugs */
    function toSlug(str) {
        return str.toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9-]/g, '');
    }

    /** Reverse-map slug → class name */
    const CLASS_SLUG_MAP = {};
    const SPEC_SLUG_MAP  = {};   // "warrior-fury" → {cls, spec}
    const PHASE_SLUG_MAP = {
        'pre-bis': 0, 'phase-0': 0,
        'phase-1': 1, 'phase-2': 2,
        'phase-3': 3, 'phase-4': 4, 'phase-5': 5
    };
    const PHASE_TO_SLUG = { 0:'pre-bis', 1:'phase-1', 2:'phase-2', 3:'phase-3', 4:'phase-4', 5:'phase-5' };

    // Populated after CLASS_META is defined (see below)
    function buildSlugMaps() {
        for (const cls of Object.keys(CLASS_META)) {
            CLASS_SLUG_MAP[toSlug(cls)] = cls;
            for (const spec of CLASS_META[cls].specs) {
                SPEC_SLUG_MAP[`${toSlug(cls)}-${toSlug(spec)}`] = { cls, spec };
            }
        }
    }

    /**
     * Build the canonical path for the current state.
     * /warrior/fury/phase-2  |  /warrior/fury/pre-bis  |  /warrior/fury  |  /warrior  |  /
     */
    function buildPath() {
        if (!state.selectedClass) return '/';
        const cls = toSlug(state.selectedClass);
        if (!state.selectedSpec) return `/${cls}`;
        if (state.isPvP) return `/${cls}/${toSlug(state.selectedSpec)}/pvp`;
        const spec = toSlug(state.selectedSpec);
        if (state.selectedPhase == null) return `/${cls}/${spec}`;
        const phase = PHASE_TO_SLUG[state.selectedPhase] || `phase-${state.selectedPhase}`;
        return `/${cls}/${spec}/${phase}`;
    }

    /** Push a new browser history entry matching current state */
    function pushRoute() {
        const path = buildPath();
        if (location.pathname !== path) {
            history.pushState({ ...state, excludedProfessions: [...state.excludedProfessions] }, '', path);
        }
    }

    /** Replace current history entry (for in-place updates like phase switcher) */
    function replaceRoute() {
        const path = buildPath();
        history.replaceState({ ...state, excludedProfessions: [...state.excludedProfessions] }, '', path);
    }

    /** Try to parse the current URL path and restore state */
    function restoreFromUrl() {
        const parts = location.pathname.replace(/^\//, '').split('/').filter(Boolean);
        if (!parts.length) return false;

        // Static pages: /about, /privacy, /feedback
        if (parts[0] === 'about' || parts[0] === 'privacy' || parts[0] === 'feedback') {
            showStaticPage(parts[0]);
            return true;
        }

        const clsSlug = parts[0];
        const cls = CLASS_SLUG_MAP[clsSlug];
        if (!cls) return false;

        if (parts.length === 1) {
            // /warrior — show spec select
            state.selectedClass = cls;
            headerTitle.textContent = cls;
            headerTitle.style.color = CLASS_META[cls].color;
            headerSub.textContent = 'Choose your spec';
            renderSpecGrid(cls);
            state.history.push('class');
            showStep(stepSpec);
            return true;
        }

        const specSlug = parts[1];
        let specEntry = SPEC_SLUG_MAP[`${clsSlug}-${specSlug}`];

        // PvP specs may use a different name than PvE (e.g. "subtlety" instead of "dps" for Rogue)
        // Check if this is a PvP-only spec slug that maps to a PvE spec
        let forcePvP = false;
        let forcePvPKey = null;
        if (!specEntry && parts[2] === 'pvp') {
            // Look through PVP_TO_PVE_SPEC for a match
            const specName = specSlug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            for (const [pvpKey, pveSpec] of Object.entries(PVP_TO_PVE_SPEC)) {
                const [pvpCls, pvpSpec] = pvpKey.split('|');
                if (toSlug(pvpCls) === clsSlug && toSlug(pvpSpec) === specSlug) {
                    specEntry = { cls, spec: pvpSpec };
                    forcePvP = true;
                    forcePvPKey = pvpKey;
                    break;
                }
            }
            // Also check scraped PVP_DATA.specs keys directly
            if (!specEntry && typeof PVP_DATA !== 'undefined' && PVP_DATA.specs) {
                for (const pvpKey of Object.keys(PVP_DATA.specs)) {
                    const [pvpCls, pvpSpec] = pvpKey.split('|');
                    if (toSlug(pvpCls) === clsSlug && toSlug(pvpSpec) === specSlug) {
                        const pveSpec = PVP_TO_PVE_SPEC[pvpKey] || pvpSpec;
                        specEntry = { cls, spec: pvpSpec };
                        forcePvP = true;
                        forcePvPKey = pvpKey;
                        break;
                    }
                }
            }
        }
        if (!specEntry) return false;

        state.selectedClass = specEntry.cls;
        state.selectedSpec = specEntry.spec;

        if (parts.length === 2) {
            // /warrior/fury — show phase select
            headerTitle.textContent = `${cls} — ${specEntry.spec}`;
            headerTitle.style.color = CLASS_META[cls].color;
            headerSub.textContent = 'Choose phase';
            renderSpecGrid(cls);      // needed so spec grid exists
            renderPhaseGrid();
            state.history.push('class', 'spec');
            showStep(stepPhase);
            return true;
        }

        const phaseSlug = parts[2];

        // /warrior/arms/pvp — restore PvP view
        if (phaseSlug === 'pvp') {
            state.selectedClass = specEntry.cls;
            state.selectedSpec  = specEntry.spec;
            state.isPvP         = true;
            state.pvpKey        = forcePvPKey || `${specEntry.cls}|${specEntry.spec}`;
            state.selectedPhase = null;
            const pvpTag = '<span class="pvp-tag">PvP</span>';
            headerTitle.innerHTML = `${cls} — ${specEntry.spec} PvP ${pvpTag}`;
            headerTitle.style.color = CLASS_META[cls].color;
            const meta = (typeof PVP_DATA !== 'undefined' && PVP_DATA.meta) || {};
            const dateStr = meta.analyzedAt
                ? new Date(meta.analyzedAt).toLocaleDateString('sv-SE')
                : 'recently';
            headerSub.textContent = `Live snapshot · Updated ${dateStr}`;
            renderSpecGrid(cls);
            renderBisList();
            state.history.push('class', 'spec');
            showStep(stepBis);
            return true;
        }

        const phase = PHASE_SLUG_MAP[phaseSlug];
        if (phase === undefined) return false;

        state.selectedPhase = phase;
        // Restore shared build overrides and filters from URL params
        const urlParams = new URLSearchParams(location.search);
        const buildParam = urlParams.get('build');
        if (buildParam) decodeBuild(buildParam);
        decodeFilters(urlParams);
        const phInfo = PHASE_NAMES[phase] || { label: `Phase ${phase}`, desc: '' };
        headerTitle.innerHTML = `${specEntry.spec} — ${phInfo.label}`;
        headerTitle.style.color = CLASS_META[cls].color;
        headerSub.textContent = phInfo.desc;
        renderSpecGrid(cls);         // spec grid must exist for other flows
        renderBisList();
        state.history.push('class', 'spec', 'phase');
        showStep(stepBis);
        return true;
    }

    // ─── Meta tag updater ────────────────────────────────────────────

    const BASE_URL = 'https://tbc-bis-guide.com';

    // Spec abbreviations injected into meta descriptions to capture searches like
    // "ret pally bis", "bm hunter bis", "boomkin enchants". Keep in sync with
    // SPEC_ABBREV in prerender.js.
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

    function specWithAbbrev(cls, spec) {
        const abbrev = SPEC_ABBREV[`${cls}-${spec}`];
        return abbrev ? `${spec} ${cls} (${abbrev})` : `${spec} ${cls}`;
    }

    // Hand-written PvP arena context per spec. Mirrors PVP_SPEC_CONTEXT in
    // prerender.js — keep both in sync when adding new specs. (Acceptable
    // duplication for the pilot; extract to a shared module if it grows.)
    const PVP_SPEC_CONTEXT = {
        'Warrior|Arms': {
            roleSummary: 'Melee DPS with Mortal Strike pressure and target swaps',
            playstyleHtml: `<p>Arms Warriors are the cornerstone of melee cleave compositions in TBC arena. Their value comes almost entirely from <strong>Mortal Strike</strong>, which applies a 50% healing reduction to the target — turning enemy heals into a finite resource the opposing team has to outlast. Above 2000 rating, Arms is typically played as a swap-and-pressure class: open on a kill target, force defensive cooldowns, then swap to a fresh target while Mortal Strike is still ticking on the original.</p>
<p>Stance dancing is core to the spec — Battle Stance for damage and Overpower, Berserker Stance for Whirlwind and crit chance, Defensive Stance for Spell Reflect and Disarm. Strong Arms Warriors rotate stances multiple times per opener.</p>`,
            compsHtml: `<p><strong>Common 2v2 compositions:</strong> Warrior/Druid (Resto) is the dominant pairing — sometimes called "WarDin" or just Warrior cleave — followed by Warrior/Paladin (Holy) and Warrior/Priest (Discipline).</p>
<p><strong>Common 3v3 compositions:</strong> Warrior/Mage/Druid (WMD) and Warrior/Mage/Priest (WMP) are the textbook setups, with Warrior/Rogue/Druid (WRD) seen as the burst-oriented variant. All three rely on CC chains from the caster to set up Mortal Strike windows.</p>`,
            statsHtml: `<p><strong>PvP stat priority:</strong> Resilience → Stamina → Strength → Critical Strike Rating → Hit Rating → Expertise. Resilience is non-negotiable in any arena bracket — pieces from the Honor and Arena vendors will outperform raid gear of similar item level once you're being globaled by mages and warlocks. Strength scales Mortal Strike's flat damage, making it the primary offensive stat once Resilience needs are met.</p>
<p>Two-handed weapons are mandatory — slow, high-damage weapons maximize Mortal Strike's weapon-damage component. The PvP weapon tokens from Arena and the Sunwell-era Apolyon-style 2H are the targets.</p>`,
        },
    };

    function cleanEnchantName(name) {
        return String(name || '').replace(/^Enchanted:\s*/, '');
    }

    /** Build the same 5-item FAQ that prerender produces — used both for
     *  visible runtime FAQ and (if we ever inject) JSON-LD parity. */
    function buildPvpFaqItemsRuntime(cls, spec, sd) {
        if (!sd) return [];
        const items = [];
        const rr = sd.ratingRange || {};
        const specName = `${spec} ${cls}`;

        const chest = sd.slots && sd.slots.Chest && sd.slots.Chest[0];
        if (chest) {
            items.push({
                q: `What chest piece do top ${specName} arena players wear?`,
                a: `${chest.name} is worn by ${chest.popularity}% of the ${sd.playerCount} top-rated ${specName}s analyzed in this snapshot. See alternatives and enchant choices in the live list above.`
            });
        }
        const chestEnchant = chest && chest.topEnchants && chest.topEnchants[0];
        if (chestEnchant) {
            items.push({
                q: `What chest enchant should ${specName} use in PvP?`,
                a: `${cleanEnchantName(chestEnchant.name)} is used by ${chestEnchant.usage}% of top arena players in this spec, making it the standard PvP chest enchant.`
            });
        }
        const mainHand = sd.slots && sd.slots['Main Hand'] && sd.slots['Main Hand'][0];
        if (mainHand) {
            items.push({
                q: `What weapon do top ${specName} PvP players use?`,
                a: `${mainHand.name} is the most popular choice at ${mainHand.popularity}% usage. Weapon choice in TBC PvP often comes down to whether you've cleared the relevant rating gate or can afford the gold/honor cost — see alternatives in the live list above.`
            });
        }
        items.push({
            q: `What rating range does this ${specName} PvP BiS list cover?`,
            a: `Data is based on ${sd.playerCount} ${specName} arena players rated between ${rr.min} and ${rr.max} (average ${rr.avg}). The list is refreshed weekly from ironforge.pro's arena leaderboard scrape.`
        });
        items.push({
            q: `Should ${specName} use PvE gear in arena?`,
            a: `Some PvE epics with high stat budgets are worn by top arena players when the slot's PvP option is weak — they're marked "PvE flex" in the live list. However, Resilience-bearing pieces from the Honor and Arena vendors are still the foundation of any PvP gear set.`
        });
        return items;
    }

    function injectAbbrev(desc, cls, spec) {
        const abbrev = SPEC_ABBREV[`${cls}-${spec}`];
        if (!abbrev || !desc) return desc;
        const needle = `${spec} ${cls}`;
        if (desc.indexOf(needle) !== -1) {
            return desc.replace(needle, `${spec} ${cls} (${abbrev})`);
        }
        return desc;
    }

    /**
     * Update <title>, meta description, canonical and OG tags to reflect
     * the currently selected class/spec/phase.
     */
    function updateSeoMeta() {
        const titleEl        = document.querySelector('title');
        const descEl         = document.getElementById('metaDescription');
        const canonicalEl    = document.getElementById('canonicalLink');
        const ogUrlEl        = document.getElementById('ogUrl');
        const ogTitleEl      = document.getElementById('ogTitle');
        const ogDescEl       = document.getElementById('ogDescription');
        const twTitleEl      = document.getElementById('twTitle');
        const twDescEl       = document.getElementById('twDescription');

        let pageTitle, metaDesc, path;

        if (!state.selectedClass) {
            pageTitle = 'TBC Classic BiS Guide — Best in Slot for Every Class & Spec';
            metaDesc  = 'Complete TBC Classic Best in Slot gear guide for every class and spec — Pre-Raid through Sunwell. Includes enchants, gems, stat priority, and phase-by-phase progression.';
            path      = '/';
        } else if (!state.selectedSpec) {
            pageTitle = `${state.selectedClass} BiS Guide — TBC Classic`;
            metaDesc  = `WoW Classic TBC Best in Slot gear for ${state.selectedClass} — every spec, Pre-Raid through Sunwell Plateau. Includes enchants, gems, and stat priority for each phase.`;
            path      = `/${toSlug(state.selectedClass)}`;
        } else if (state.isPvP) {
            pageTitle = `${state.selectedSpec} ${state.selectedClass} PvP BiS — TBC Classic`;
            metaDesc  = `Live arena snapshot of the best gear for ${specWithAbbrev(state.selectedClass, state.selectedSpec)} PvP in TBC Classic, based on what the highest-rated arena players are wearing right now. Includes enchants and gems.`;
            path      = `/${toSlug(state.selectedClass)}/${toSlug(state.selectedSpec)}/pvp`;
        } else if (state.selectedPhase == null) {
            pageTitle = `${state.selectedSpec} ${state.selectedClass} BiS Guide — TBC Classic`;
            metaDesc  = `${specWithAbbrev(state.selectedClass, state.selectedSpec)} BiS for TBC Classic — Pre-Raid through Sunwell Plateau. Full gear lists with enchants, gems, and stat priority. Pick a phase below.`;
            path      = `/${toSlug(state.selectedClass)}/${toSlug(state.selectedSpec)}`;
        } else {
            const phInfo  = PHASE_NAMES[state.selectedPhase] || { label: `Phase ${state.selectedPhase}` };
            const phSlug  = PHASE_TO_SLUG[state.selectedPhase] || `phase-${state.selectedPhase}`;
            const specDesc = generateSpecDescription(state.selectedClass, state.selectedSpec, state.selectedPhase);
            // SEO label: "Pre-Raid" matches search volume better than "Pre-BiS" (Ahrefs).
            const seoPhLabel = state.selectedPhase === 0 ? 'Pre-Raid' : phInfo.label;
            const bisSuffix = /bis/i.test(seoPhLabel) ? '' : ' BiS';
            pageTitle = `${state.selectedSpec} ${state.selectedClass} ${seoPhLabel}${bisSuffix} — TBC Classic`;
            metaDesc  = specDesc
                ? injectAbbrev(specDesc, state.selectedClass, state.selectedSpec)
                : `Best in Slot gear for ${specWithAbbrev(state.selectedClass, state.selectedSpec)} in TBC Classic ${phInfo.label}. Full gear list with enchants, gems, stat priority, and item sources.`;
            path      = `/${toSlug(state.selectedClass)}/${toSlug(state.selectedSpec)}/${phSlug}`;
        }

        const fullUrl = `${BASE_URL}${path}`;

        if (titleEl)     titleEl.textContent        = pageTitle;
        if (descEl)      descEl.setAttribute('content', metaDesc);
        if (canonicalEl) canonicalEl.setAttribute('href', fullUrl);
        if (ogUrlEl)     ogUrlEl.setAttribute('content', fullUrl);
        if (ogTitleEl)   ogTitleEl.setAttribute('content', pageTitle);
        if (ogDescEl)    ogDescEl.setAttribute('content', metaDesc);
        if (twTitleEl)   twTitleEl.setAttribute('content', pageTitle);
        if (twDescEl)    twDescEl.setAttribute('content', metaDesc);

        // Update H1 to match the SEO-friendly page title (without "— TBC Classic" suffix)
        if (headerTitle) {
            const h1Text = pageTitle.replace(/\s*—\s*TBC Classic$/, '');
            // Preserve any existing PvP tag HTML
            const pvpTag = state.isPvP ? ' <span class="pvp-tag">PvP</span>' : '';
            headerTitle.innerHTML = h1Text + pvpTag;
        }

        updateStructuredData(pageTitle, metaDesc, fullUrl);

        // SEO landing blocks for class/spec pages (each function self-gates on state)
        renderClassLanding();
        renderSpecLanding();

        // Google Analytics — SPA page view
        if (typeof gtag === 'function') {
            gtag('event', 'page_view', { page_title: pageTitle, page_location: fullUrl, page_path: path });
        }
    }

    // ─── JSON-LD Structured Data ─────────────────────────────────────

    /**
     * Inject/update JSON-LD structured data so Google understands each
     * SPA "page" as a distinct entity with breadcrumbs.
     */
    function updateStructuredData(pageTitle, metaDesc, fullUrl) {
        // Remove any previous structured data we injected
        document.querySelectorAll('script[data-bis-jsonld]').forEach(el => el.remove());

        const schemas = [];

        // 1. WebPage schema for every page
        schemas.push({
            '@context': 'https://schema.org',
            '@type': 'WebPage',
            name: pageTitle,
            description: metaDesc,
            url: fullUrl,
            isPartOf: {
                '@type': 'WebSite',
                name: 'TBC BiS Guide',
                url: BASE_URL + '/'
            }
        });

        // 2. BreadcrumbList when we have class/spec/phase
        if (state.selectedClass) {
            const items = [];
            let pos = 1;

            items.push({
                '@type': 'ListItem',
                position: pos++,
                name: 'Home',
                item: BASE_URL + '/'
            });

            items.push({
                '@type': 'ListItem',
                position: pos++,
                name: state.selectedClass,
                item: BASE_URL + '/' + toSlug(state.selectedClass)
            });

            if (state.selectedSpec) {
                items.push({
                    '@type': 'ListItem',
                    position: pos++,
                    name: state.selectedSpec,
                    item: BASE_URL + '/' + toSlug(state.selectedClass) + '/' + toSlug(state.selectedSpec)
                });

                if (state.isPvP) {
                    items.push({
                        '@type': 'ListItem',
                        position: pos++,
                        name: 'PvP',
                        item: fullUrl
                    });
                } else if (state.selectedPhase != null) {
                    const phInfo = PHASE_NAMES[state.selectedPhase] || { label: 'Phase ' + state.selectedPhase };
                    items.push({
                        '@type': 'ListItem',
                        position: pos++,
                        name: phInfo.label,
                        item: fullUrl
                    });
                }
            }

            schemas.push({
                '@context': 'https://schema.org',
                '@type': 'BreadcrumbList',
                itemListElement: items
            });
        }

        // 3. ItemList schema for gear list pages (phase or pvp selected)
        if (state.selectedSpec && (state.selectedPhase != null || state.isPvP)) {
            schemas.push({
                '@context': 'https://schema.org',
                '@type': 'ItemList',
                name: pageTitle,
                description: metaDesc,
                url: fullUrl,
                numberOfItems: document.querySelectorAll('.bis-row').length || undefined
            });
        }

        // 4. FAQPage schema for spec+phase pages (helps get rich results)
        if (state.selectedSpec && state.selectedPhase != null && state.selectedClass && !state.isPvP) {
            const cls = state.selectedClass;
            const spec = state.selectedSpec;
            const phInfo = PHASE_NAMES[state.selectedPhase] || { label: 'Phase ' + state.selectedPhase };
            const ph = phInfo.label;
            const faq = [
                {
                    q: 'What is BiS for ' + spec + ' ' + cls + ' in ' + ph + '?',
                    a: metaDesc
                },
                {
                    q: 'Where do I get ' + spec + ' ' + cls + ' ' + ph + ' gear?',
                    a: 'The best gear comes from ' + (state.selectedPhase === 0
                        ? 'dungeons, heroics, reputation vendors, and crafting.'
                        : 'raid drops, Badge of Justice vendor, arena, and crafted items.')
                    + ' See the full list above with item sources for each slot.'
                },
                {
                    q: 'What enchants should ' + spec + ' ' + cls + ' use in ' + ph + '?',
                    a: 'Each slot has a recommended enchant shown next to the item. Enchants are chosen based on stat weights for ' + spec + ' ' + cls + ' in TBC Classic.'
                }
            ];
            schemas.push({
                '@context': 'https://schema.org',
                '@type': 'FAQPage',
                mainEntity: faq.map(function(f) {
                    return {
                        '@type': 'Question',
                        name: f.q,
                        acceptedAnswer: { '@type': 'Answer', text: f.a }
                    };
                })
            });
        }

        // Inject all schemas
        schemas.forEach(function(schema) {
            var script = document.createElement('script');
            script.type = 'application/ld+json';
            script.setAttribute('data-bis-jsonld', '');
            script.textContent = JSON.stringify(schema);
            document.head.appendChild(script);
        });
    }

    // ─── Spec/phase contextual descriptions ──────────────────────────

    /**
     * Static descriptions per spec×phase covering stat priorities, key items, and raid context.
     * Used both for the in-page description block and for meta tags.
     */
    const SPEC_PHASE_DESCRIPTIONS = {
        'Warrior-Arms': {
            0: "Pre-raid Arms Warrior BiS features Lionheart Champion as the weapon. Mask of the Deceiver, Ragesteel Shoulders, Chestguard of Exile form the armor core.",
            1: "Phase 1 Arms Warrior BiS (Karazhan, Gruul & Magtheridon) features Lionheart Champion as the two-handed weapon. Warbringer Battle-Helm, Warbringer Shoulderplates, Warbringer Breastplate form the armor core. Bloodlust Brooch and Hourglass of the Unraveller are the top trinkets. Choker of Vile Intent and Mithril Band of the Unscarred fill key jewelry slots. Xavian Stiletto fills the ranged slot.",
            2: "Phase 2 Arms Warrior BiS (SSC & TK) features Twinblade of the Phoenix as the two-handed weapon. Destroyer Battle-Helm, Destroyer Shoulderblades, Destroyer Breastplate form the armor core. Bloodlust Brooch and Dragonspine Trophy are the top trinkets. Pendant of the Perilous and Ring of a Thousand Marks fill key jewelry slots. Serpentshrine Shuriken fills the ranged slot.",
            3: "Phase 3 Arms Warrior BiS (Black Temple & Hyjal) features Twinblade of the Phoenix as the two-handed weapon. Destroyer Battle-Helm, Destroyer Shoulderblades, Destroyer Breastplate form the armor core. Dragonspine Trophy and Dragonspine Trophy are the top trinkets. Pendant of the Perilous and Vindicator's Band of Triumph fill key jewelry slots. Sunfury Bow of the Phoenix fills the ranged slot.",
            4: "Phase 4 Arms Warrior BiS (ZA & Badge gear) features Cataclysm's Edge as the two-handed weapon. Onslaught Battle-Helm, Onslaught Shoulderblades, Onslaught Breastplate form the armor core. Dragonspine Trophy and Dragonspine Trophy are the top trinkets. Choker of Serrated Blades and Unstoppable Aggressor's Ring fill key jewelry slots. Ancient Amani Longbow fills the ranged slot.",
            5: "Phase 5 (Sunwell) Arms Warrior BiS (Sunwell Plateau) features Warglaive of Azzinoth main-hand with Warglaive of Azzinoth off-hand. Coif of Alleria, Demontooth Shoulderpads, Hard Khorium Battleplate form the armor core. Shard of Contempt and Dragonspine Trophy are the top trinkets. Hard Khorium Choker and Band of Ruinous Delight fill key jewelry slots. Golden Bow of Quel'Thalas fills the ranged slot.",
        },
        'Warrior-Fury': {
            0: "Pre-raid Fury Warrior BiS features Dragonmaw main-hand with Blinkstrike off-hand. Mask of the Deceiver, Ragesteel Shoulders, Chestguard of Exile form the armor core.",
            1: "Phase 1 Fury Warrior BiS (Karazhan, Gruul & Magtheridon) features Dragonmaw main-hand with Spiteblade off-hand. Warbringer Battle-Helm, Ragesteel Shoulders, Warbringer Breastplate form the armor core. Bloodlust Brooch and Dragonspine Trophy are the top trinkets. Choker of Vile Intent and Ring of a Thousand Marks fill key jewelry slots. Mama's Insurance fills the ranged slot.",
            2: "Phase 2 Fury Warrior BiS (SSC & TK) features Dragonstrike main-hand with Talon of Azshara off-hand. Destroyer Battle-Helm, Destroyer Shoulderblades, Destroyer Breastplate form the armor core. Dragonspine Trophy and Dragonspine Trophy are the top trinkets. Pendant of the Perilous and Ring of a Thousand Marks fill key jewelry slots. Sunfury Bow of the Phoenix fills the ranged slot.",
            3: "Phase 3 Fury Warrior BiS (Black Temple & Hyjal) features Dragonstrike main-hand with Talon of Azshara off-hand. Destroyer Battle-Helm, Destroyer Shoulderblades, Destroyer Breastplate form the armor core. Badge of the Swarmguard and Dragonspine Trophy are the top trinkets. Pendant of the Perilous and Vindicator's Band of Triumph fill key jewelry slots. Serpent Spine Longbow fills the ranged slot.",
            4: "Phase 4 Fury Warrior BiS (ZA & Badge gear) features Warglaive of Azzinoth main-hand with Warglaive of Azzinoth off-hand. Cursed Vision of Sargeras, Onslaught Shoulderblades, Onslaught Breastplate form the armor core. Dragonspine Trophy and Dragonspine Trophy are the top trinkets. Choker of Serrated Blades and Stormrage Signet Ring fill key jewelry slots. Ancient Amani Longbow fills the ranged slot.",
            5: "Phase 5 (Sunwell) Fury Warrior BiS (Sunwell Plateau) features Warglaive of Azzinoth main-hand with Warglaive of Azzinoth off-hand. Coif of Alleria, Demontooth Shoulderpads, Bladed Chaos Tunic form the armor core. Shard of Contempt and Blackened Naaru Sliver are the top trinkets. Hard Khorium Choker and Band of Ruinous Delight fill key jewelry slots. Golden Bow of Quel'Thalas fills the ranged slot.",
        },
        'Warrior-Protection': {
            0: "Pre-raid Protection Warrior BiS features Dragonmaw main-hand with Azure-Shield of Coldarra off-hand. Faceguard of Determination, Spaulders of Dementia, Breastplate of the Bold form the armor core.",
            1: "Phase 1 Protection Warrior BiS (Karazhan, Gruul & Magtheridon) features Dragonmaw main-hand with King's Defender off-hand. Warbringer Greathelm, Warbringer Shoulderplates, Gladiator's Plate Chestpiece form the armor core. Bloodlust Brooch and Bloodlust Brooch are the top trinkets. Pendant of Triumph and Shapeshifter's Signet fill key jewelry slots. Xavian Stiletto fills the ranged slot.",
            2: "Phase 2 Protection Warrior BiS (SSC & TK) features Dragonstrike main-hand with Fang of Vashj off-hand. Furious Gizmatic Goggles, Destroyer Shoulderguards, Destroyer Chestguard form the armor core. Bloodlust Brooch and Dragonspine Trophy are the top trinkets. Veteran's Pendant of Triumph and Shapeshifter's Signet fill key jewelry slots. Serpentshrine Shuriken fills the ranged slot.",
            3: "Phase 3 Protection Warrior BiS (Black Temple & Hyjal) features Mallet of the Tides main-hand with Aldori Legacy Defender off-hand. Destroyer Greathelm, Destroyer Shoulderguards, Destroyer Chestguard form the armor core. Dragonspine Trophy and Dragonspine Trophy are the top trinkets. Vindicator's Pendant of Triumph and Shapeshifter's Signet fill key jewelry slots. Serpentshrine Shuriken fills the ranged slot.",
            4: "Phase 4 Protection Warrior BiS (ZA & Badge gear) features The Brutalizer main-hand with Bulwark of Azzinoth off-hand. Vengeful Gladiator's Plate Helm, Onslaught Shoulderblades, Vengeful Gladiator's Plate Chestpiece form the armor core. Dragonspine Trophy and Dragonspine Trophy are the top trinkets. Brooch of Deftness and Band of the Eternal Champion fill key jewelry slots. Legionkiller fills the ranged slot.",
            5: "Phase 5 (Sunwell) Protection Warrior BiS (Sunwell Plateau) features Warglaive of Azzinoth main-hand with Warglaive of Azzinoth off-hand. Brutal Gladiator's Plate Helm, Pauldrons of Berserking, Brutal Gladiator's Plate Chestpiece form the armor core. Shard of Contempt and Commendation of Kael'thas are the top trinkets. Collar of the Pit Lord and Stormrage Signet Ring fill key jewelry slots. Blade of Life's Inevitability fills the ranged slot.",
        },
        'Paladin-Holy': {
            0: "Pre-raid Holy Paladin BiS features Gladiator's Salvation main-hand with Light-Bearer's Faith Shield off-hand. Helmet of the Steadfast Champion, Hallowed Pauldrons, Windhawk Hauberk form the armor core.",
            1: "Phase 1 Holy Paladin BiS (Karazhan, Gruul & Magtheridon) features Light's Justice main-hand with Aegis of the Vindicator off-hand. Justicar Diadem, Pauldrons of the Justice-Seeker, Justicar Chestpiece form the armor core. Essence of the Martyr and Essence of the Martyr are the top trinkets. Necklace of Eternal Hope and Naaru Lightwarden's Band fill key jewelry slots. Libram of Souls Redeemed fills the ranged slot.",
            2: "Phase 2 Holy Paladin BiS (SSC & TK) features Light's Justice main-hand with Aegis of the Vindicator off-hand. Justicar Diadem, Crystalforge Pauldrons, Crystalforge Chestpiece form the armor core. Pendant of the Violet Eye and Essence of the Martyr are the top trinkets. Emberspur Talisman and Naaru Lightwarden's Band fill key jewelry slots. Libram of Souls Redeemed fills the ranged slot.",
            3: "Phase 3 Holy Paladin BiS (Black Temple & Hyjal) features Lightfathom Scepter main-hand with Aegis of the Vindicator off-hand. Crystalforge Greathelm, Crystalforge Pauldrons, Crystalforge Chestpiece form the armor core. Essence of the Martyr and Essence of the Martyr are the top trinkets. Lord Sanguinar's Claim and Naaru Lightwarden's Band fill key jewelry slots. Libram of Souls Redeemed fills the ranged slot.",
            4: "Phase 4 Holy Paladin BiS (ZA & Badge gear) features Hammer of Atonement main-hand with Felstone Bulwark off-hand. Lightbringer Greathelm, Lightbringer Pauldrons, Lightbringer Chestpiece form the armor core. Essence of the Martyr and Pendant of the Violet Eye are the top trinkets. Nadina's Pendant of Purity and Blessed Band of Karabor fill key jewelry slots. Libram of Absolute Truth fills the ranged slot.",
            5: "Phase 5 (Sunwell) Holy Paladin BiS (Sunwell Plateau) features Hammer of Sanctification main-hand with Felstone Bulwark off-hand. Helm of Burning Righteousness, Spaulders of the Thalassian Savior, Lightbringer Chestpiece form the armor core. Pendant of the Violet Eye and Redeemer's Alchemist Stone are the top trinkets. Nadina's Pendant of Purity and Blessed Band of Karabor fill key jewelry slots. Libram of Absolute Truth fills the ranged slot.",
        },
        'Paladin-Protection': {
            0: "Pre-raid Protection Paladin BiS features Gladiator's Gavel main-hand with Crest of the Sha'tar off-hand. Faceguard of Determination, Gladiator's Lamellar Shoulders, Breastplate of the Righteous form the armor core.",
            1: "Phase 1 Protection Paladin BiS (Karazhan, Gruul & Magtheridon) features Bloodmaw Magus-Blade main-hand with Aldori Legacy Defender off-hand. Justicar Faceguard, Justicar Shoulderguards, Justicar Chestguard form the armor core. Icon of the Silver Crescent and Icon of the Silver Crescent are the top trinkets. Barbed Choker of Discipline and Ashyen's Gift fill key jewelry slots. Libram of Repentance fills the ranged slot.",
            2: "Phase 2 Protection Paladin BiS (SSC & TK) features Bloodmaw Magus-Blade main-hand with Aldori Legacy Defender off-hand. Crystalforge Faceguard, Justicar Shoulderguards, Justicar Chestguard form the armor core. Icon of the Silver Crescent and Eye of Magtheridon are the top trinkets. The Darkener's Grasp and Seventh Ring of the Tirisfalen fill key jewelry slots. Libram of Repentance fills the ranged slot.",
            3: "Phase 3 Protection Paladin BiS (Black Temple & Hyjal) features Hammer of Judgment main-hand with Aldori Legacy Defender off-hand. Lightbringer Faceguard, Lightbringer Shoulderguards, Lightbringer Chestguard form the armor core. Icon of the Silver Crescent and Icon of the Silver Crescent are the top trinkets. The Darkener's Grasp and Seventh Ring of the Tirisfalen fill key jewelry slots. Libram of Repentance fills the ranged slot.",
            4: "Phase 4 Protection Paladin BiS (ZA & Badge gear) features Tempest of Chaos main-hand with Bulwark of Azzinoth off-hand. Lightbringer Faceguard, Lightbringer Shoulderguards, Lightbringer Chestguard form the armor core. Icon of the Silver Crescent and Tome of Fiery Redemption are the top trinkets. The Darkener's Grasp and Band of the Eternal Sage fill key jewelry slots. Libram of Repentance fills the ranged slot.",
            5: "Phase 5 (Sunwell) Protection Paladin BiS (Sunwell Plateau) features Tempest of Chaos main-hand with Sword Breaker's Bulwark off-hand. Helm of Uther's Resolve, Spaulders of the Thalassian Defender, Heroic Judicator's Chestguard form the armor core. Hex Shrunken Head and Commendation of Kael'thas are the top trinkets. The Darkener's Grasp and Fused Nethergon Band fill key jewelry slots. Libram of Divine Purpose fills the ranged slot.",
        },
        'Paladin-Retribution': {
            0: "Pre-raid Retribution Paladin BiS features Gladiator's Greatsword as the weapon. Mask of the Deceiver, Ragesteel Shoulders, Ragesteel Breastplate form the armor core.",
            1: "Phase 1 Retribution Paladin BiS (Karazhan, Gruul & Magtheridon) features Lionheart Champion as the two-handed weapon. Justicar Crown, Justicar Shoulderplates, Justicar Breastplate form the armor core. Bloodlust Brooch and Bloodlust Brooch are the top trinkets. Mithril Chain of Heroism and Shapeshifter's Signet fill key jewelry slots. Libram of Avengement fills the ranged slot.",
            2: "Phase 2 Retribution Paladin BiS (SSC & TK) features Lionheart Executioner as the two-handed weapon. Furious Gizmatic Goggles, Shoulderpads of the Stranger, Crystalforge Breastplate form the armor core. Bloodlust Brooch and Bloodlust Brooch are the top trinkets. Pendant of the Perilous and Shapeshifter's Signet fill key jewelry slots. Libram of Avengement fills the ranged slot.",
            3: "Phase 3 Retribution Paladin BiS (Black Temple & Hyjal) features Torch of the Damned as the two-handed weapon. Furious Gizmatic Goggles, Shoulderpads of the Stranger, Crystalforge Breastplate form the armor core. Bloodlust Brooch and Dragonspine Trophy are the top trinkets. Pendant of the Perilous and Shapeshifter's Signet fill key jewelry slots. Libram of Avengement fills the ranged slot.",
            4: "Phase 4 Retribution Paladin BiS (ZA & Badge gear) features Torch of the Damned as the two-handed weapon. Cursed Vision of Sargeras, Shoulderpads of the Stranger, Midnight Chestguard form the armor core. Bloodlust Brooch and Dragonspine Trophy are the top trinkets. Pendant of the Perilous and Band of Devastation fill key jewelry slots. Libram of Avengement fills the ranged slot.",
            5: "Phase 5 (Sunwell) Retribution Paladin BiS (Sunwell Plateau) features Apolyon, the Soul-Render as the two-handed weapon. Duplicitous Guise, Pauldrons of Berserking, Warharness of Reckless Fury form the armor core. Shard of Contempt and Dragonspine Trophy are the top trinkets. Clutch of Demise and Hard Khorium Band fill key jewelry slots. Libram of Avengement fills the ranged slot.",
        },
        'Hunter-Beast Mastery': {
            0: "Pre-raid Beast Mastery Hunter BiS features Claw of the Watcher main-hand with Void-Talon off-hand. Beast Lord Helm, Beast Lord Mantle, Beast Lord Cuirass form the armor core.",
            1: "Phase 1 Beast Mastery Hunter BiS (Karazhan, Gruul & Magtheridon) features Claw of the Watcher main-hand with Stormreaver Warblades off-hand. Beast Lord Helm, Beast Lord Mantle, Beast Lord Cuirass form the armor core. Bloodlust Brooch and Bloodlust Brooch are the top trinkets. Choker of Vile Intent and Ring of the Recalcitrant fill key jewelry slots. Sunfury Bow of the Phoenix fills the ranged slot.",
            2: "Phase 2 Beast Mastery Hunter BiS (SSC & TK) features Claw of the Watcher main-hand with Stormreaver Warblades off-hand. Rift Stalker Helm, Rift Stalker Mantle, Rift Stalker Hauberk form the armor core. Bloodlust Brooch and Dragonspine Trophy are the top trinkets. Telonicus' Pendant of Mayhem and Ring of the Recalcitrant fill key jewelry slots. Serpent Spine Longbow fills the ranged slot.",
            3: "Phase 3 Beast Mastery Hunter BiS (Black Temple & Hyjal) features Talon of the Phoenix main-hand with Claw of the Phoenix off-hand. Rift Stalker Helm, Rift Stalker Mantle, Rift Stalker Hauberk form the armor core. Bloodlust Brooch and Dragonspine Trophy are the top trinkets. Telonicus' Pendant of Mayhem and Ring of the Recalcitrant fill key jewelry slots. Serpent Spine Longbow fills the ranged slot.",
            4: "Phase 4 Beast Mastery Hunter BiS (ZA & Badge gear) features Twinblade of the Phoenix as the two-handed weapon. Cursed Vision of Sargeras, Gronnstalker's Spaulders, Gronnstalker's Chestguard form the armor core. Dragonspine Trophy and Dragonspine Trophy are the top trinkets. Choker of Serrated Blades and Band of the Eternal Champion fill key jewelry slots. Bristleblitz Striker fills the ranged slot.",
            5: "Phase 5 (Sunwell) Beast Mastery Hunter BiS (Sunwell Plateau) features Shivering Felspine as the two-handed weapon. Coif of Alleria, Gronnstalker's Spaulders, Bladed Chaos Tunic form the armor core. Berserker's Call and Blackened Naaru Sliver are the top trinkets. Hard Khorium Choker and Hard Khorium Band fill key jewelry slots. Thori'dal, the Stars' Fury fills the ranged slot.",
        },
        'Hunter-Marksmanship': {
            0: "Pre-raid Marksmanship Hunter BiS features Claw of the Watcher main-hand with Claw of the Frost Wyrm off-hand. Beast Lord Helm, Beast Lord Mantle, Beast Lord Cuirass form the armor core.",
            1: "Phase 1 Marksmanship Hunter BiS (Karazhan, Gruul & Magtheridon) features Claw of the Watcher main-hand with Stormreaver Warblades off-hand. Beast Lord Helm, Beast Lord Mantle, Beast Lord Cuirass form the armor core. Bloodlust Brooch and Bloodlust Brooch are the top trinkets. Choker of Vile Intent and Garona's Signet Ring fill key jewelry slots. Sunfury Bow of the Phoenix fills the ranged slot.",
            2: "Phase 2 Marksmanship Hunter BiS (SSC & TK) features Claw of the Watcher main-hand with Claw of the Phoenix off-hand. Rift Stalker Helm, Rift Stalker Mantle, Rift Stalker Hauberk form the armor core. Bloodlust Brooch and Dragonspine Trophy are the top trinkets. Telonicus' Pendant of Mayhem and Band of Eternity fill key jewelry slots. Serpent Spine Longbow fills the ranged slot.",
            3: "Phase 3 Marksmanship Hunter BiS (Black Temple & Hyjal) features Talon of the Phoenix main-hand with Claw of the Phoenix off-hand. Rift Stalker Helm, Rift Stalker Mantle, Rift Stalker Hauberk form the armor core. Bloodlust Brooch and Dragonspine Trophy are the top trinkets. Telonicus' Pendant of Mayhem and Ring of Lethality fill key jewelry slots. Serpent Spine Longbow fills the ranged slot.",
            4: "Phase 4 Marksmanship Hunter BiS (ZA & Badge gear) features Dagger of Bad Mojo in both hands. Cursed Vision of Sargeras, Gronnstalker's Spaulders, Gronnstalker's Chestguard form the armor core. Dragonspine Trophy and Dragonspine Trophy are the top trinkets. Choker of Serrated Blades and Band of the Eternal Champion fill key jewelry slots. Bristleblitz Striker fills the ranged slot.",
            5: "Phase 5 (Sunwell) Marksmanship Hunter BiS (Sunwell Plateau) features Shivering Felspine as the two-handed weapon. Coif of Alleria, Gronnstalker's Spaulders, Bladed Chaos Tunic form the armor core. Berserker's Call and Dragonspine Trophy are the top trinkets. Hard Khorium Choker and Angelista's Revenge fill key jewelry slots. Thori'dal, the Stars' Fury fills the ranged slot.",
        },
        'Hunter-Survival': {
            0: "Pre-raid Survival Hunter BiS features Stellaris main-hand with Talon of Anzu off-hand. Beast Lord Helm, Beast Lord Mantle, Beast Lord Cuirass form the armor core.",
            1: "Phase 1 Survival Hunter BiS (Karazhan, Gruul & Magtheridon) features Claw of the Watcher main-hand with Blade of the Unrequited off-hand. Beast Lord Helm, Beast Lord Mantle, Beast Lord Cuirass form the armor core. Bloodlust Brooch and Bloodlust Brooch are the top trinkets. Choker of Vile Intent and Ring of the Recalcitrant fill key jewelry slots. Sunfury Bow of the Phoenix fills the ranged slot.",
            2: "Phase 2 Survival Hunter BiS (SSC & TK) features Claw of the Watcher main-hand with Claw of the Phoenix off-hand. Rift Stalker Helm, Rift Stalker Mantle, Rift Stalker Hauberk form the armor core. Bloodlust Brooch and Dragonspine Trophy are the top trinkets. Telonicus' Pendant of Mayhem and Band of Eternity fill key jewelry slots. Sunfury Bow of the Phoenix fills the ranged slot.",
            3: "Phase 3 Survival Hunter BiS (Black Temple & Hyjal) features Netherbane main-hand with Claw of the Phoenix off-hand. Rift Stalker Helm, Rift Stalker Mantle, Rift Stalker Hauberk form the armor core. Bloodlust Brooch and Dragonspine Trophy are the top trinkets. Telonicus' Pendant of Mayhem and Ring of the Recalcitrant fill key jewelry slots. Serpent Spine Longbow fills the ranged slot.",
            4: "Phase 4 Survival Hunter BiS (ZA & Badge gear) features Halberd of Desolation as the two-handed weapon. Gronnstalker's Helmet, Gronnstalker's Spaulders, Gronnstalker's Chestguard form the armor core. Berserker's Call and Dragonspine Trophy are the top trinkets. Telonicus' Pendant of Mayhem and Band of the Eternal Champion fill key jewelry slots. Bristleblitz Striker fills the ranged slot.",
            5: "Phase 5 (Sunwell) Survival Hunter BiS (Sunwell Plateau) features Shivering Felspine as the two-handed weapon. Coif of Alleria, Gronnstalker's Spaulders, Bladed Chaos Tunic form the armor core. Berserker's Call and Dragonspine Trophy are the top trinkets. Hard Khorium Choker and Angelista's Revenge fill key jewelry slots. Thori'dal, the Stars' Fury fills the ranged slot.",
        },
        'Rogue-Combat': {
            0: "Pre-raid Combat Rogue BiS features Dragonmaw main-hand with Latro's Shifting Sword off-hand. Wastewalker Helm, Wastewalker Shoulderpads, Wastewalker Tunic form the armor core.",
            1: "Phase 1 Combat Rogue BiS (Karazhan, Gruul & Magtheridon) features Spiteblade main-hand with Latro's Shifting Sword off-hand. Netherblade Facemask, Wastewalker Shoulderpads, Netherblade Chestpiece form the armor core. Bloodlust Brooch and Bloodlust Brooch are the top trinkets. Choker of Vile Intent and Garona's Signet Ring fill key jewelry slots. Sunfury Bow of the Phoenix fills the ranged slot.",
            2: "Phase 2 Combat Rogue BiS (SSC & TK) features Talon of Azshara main-hand with Merciless Gladiator's Quickblade off-hand. Deathmantle Helm, Deathmantle Shoulderpads, Bloodsea Brigand's Vest form the armor core. Warp-Spring Coil and Dragonspine Trophy are the top trinkets. Choker of Vile Intent and Ring of Lethality fill key jewelry slots. Arcanite Steam-Pistol fills the ranged slot.",
            3: "Phase 3 Combat Rogue BiS (Black Temple & Hyjal) features Talon of Azshara main-hand with Merciless Gladiator's Quickblade off-hand. Deathmantle Helm, Deathmantle Shoulderpads, Bloodsea Brigand's Vest form the armor core. Warp-Spring Coil and Dragonspine Trophy are the top trinkets. Choker of Vile Intent and Ring of Lethality fill key jewelry slots. Arcanite Steam-Pistol fills the ranged slot.",
            4: "Phase 4 Combat Rogue BiS (ZA & Badge gear) features Warglaive of Azzinoth main-hand with Warglaive of Azzinoth off-hand. Slayer's Helm, Slayer's Shoulderpads, Slayer's Chestguard form the armor core. Warp-Spring Coil and Dragonspine Trophy are the top trinkets. Choker of Endless Nightmares and Stormrage Signet Ring fill key jewelry slots. Arcanite Steam-Pistol fills the ranged slot.",
            5: "Phase 5 (Sunwell) Combat Rogue BiS (Sunwell Plateau) features Warglaive of Azzinoth main-hand with Warglaive of Azzinoth off-hand. Duplicitous Guise, Slayer's Shoulderpads, Bladed Chaos Tunic form the armor core. Blackened Naaru Sliver and Dragonspine Trophy are the top trinkets. Hard Khorium Choker and Stormrage Signet Ring fill key jewelry slots. Golden Bow of Quel'Thalas fills the ranged slot.",
        },
        'Rogue-Assassination': {
            0: "Pre-raid Assassination Rogue BiS features Dragonmaw main-hand with Latro's Shifting Sword off-hand. Wastewalker Helm, Wastewalker Shoulderpads, Wastewalker Tunic form the armor core.",
            1: "Phase 1 Assassination Rogue BiS (Karazhan, Gruul & Magtheridon) features Malchazeen main-hand with Emerald Ripper off-hand. Netherblade Facemask, Wastewalker Shoulderpads, Netherblade Chestpiece form the armor core. Bloodlust Brooch and Bloodlust Brooch are the top trinkets. Choker of Vile Intent and Garona's Signet Ring fill key jewelry slots. Sunfury Bow of the Phoenix fills the ranged slot.",
            2: "Phase 2 Assassination Rogue BiS (SSC & TK) features Fang of Vashj main-hand with Heartrazor off-hand. Deathmantle Helm, Deathmantle Shoulderpads, Bloodsea Brigand's Vest form the armor core. Warp-Spring Coil and Dragonspine Trophy are the top trinkets. Choker of Vile Intent and Garona's Signet Ring fill key jewelry slots. Arcanite Steam-Pistol fills the ranged slot.",
            3: "Phase 3 Assassination Rogue BiS (Black Temple & Hyjal) features Shard of Azzinoth main-hand with Fang of Vashj off-hand. Deathmantle Helm, Deathmantle Shoulderpads, Deathmantle Chestguard form the armor core. Warp-Spring Coil and Warp-Spring Coil are the top trinkets. Choker of Vile Intent and Ring of Lethality fill key jewelry slots. Arcanite Steam-Pistol fills the ranged slot.",
            4: "Phase 4 Assassination Rogue BiS (ZA & Badge gear) features Shard of Azzinoth main-hand with Fang of Vashj off-hand. Slayer's Helm, Slayer's Shoulderpads, Slayer's Chestguard form the armor core. Warp-Spring Coil and Dragonspine Trophy are the top trinkets. Choker of Endless Nightmares and Band of the Eternal Champion fill key jewelry slots. Arcanite Steam-Pistol fills the ranged slot.",
            5: "Phase 5 (Sunwell) Assassination Rogue BiS (Sunwell Plateau) features Crux of the Apocalypse in both hands. Duplicitous Guise, Slayer's Shoulderpads, Slayer's Chestguard form the armor core. Dragonspine Trophy and Dragonspine Trophy are the top trinkets. Choker of Endless Nightmares and Stormrage Signet Ring fill key jewelry slots. Blade of Life's Inevitability fills the ranged slot.",
        },
        'Rogue-Subtlety': {
            0: "Pre-raid Subtlety Rogue BiS features Dragonmaw main-hand with Latro's Shifting Sword off-hand. Wastewalker Helm, Wastewalker Shoulderpads, Wastewalker Tunic form the armor core.",
            1: "Phase 1 Subtlety Rogue BiS (Karazhan, Gruul & Magtheridon) features Dragonmaw main-hand with Latro's Shifting Sword off-hand. Netherblade Facemask, Wastewalker Shoulderpads, Netherblade Chestpiece form the armor core. Bloodlust Brooch and Bloodlust Brooch are the top trinkets. Choker of Vile Intent and Ring of a Thousand Marks fill key jewelry slots. Sunfury Bow of the Phoenix fills the ranged slot.",
            2: "Phase 2 Subtlety Rogue BiS (SSC & TK) features Talon of Azshara main-hand with Merciless Gladiator's Quickblade off-hand. Deathmantle Helm, Deathmantle Shoulderpads, Bloodsea Brigand's Vest form the armor core. Warp-Spring Coil and Dragonspine Trophy are the top trinkets. Choker of Vile Intent and Garona's Signet Ring fill key jewelry slots. Arcanite Steam-Pistol fills the ranged slot.",
            3: "Phase 3 Subtlety Rogue BiS (Black Temple & Hyjal) features Talon of Azshara main-hand with Merciless Gladiator's Quickblade off-hand. Deathmantle Helm, Deathmantle Shoulderpads, Deathmantle Chestguard form the armor core. Warp-Spring Coil and Dragonspine Trophy are the top trinkets. Telonicus' Pendant of Mayhem and Ring of Lethality fill key jewelry slots. Arcanite Steam-Pistol fills the ranged slot.",
            4: "Phase 4 Subtlety Rogue BiS (ZA & Badge gear) features Warglaive of Azzinoth main-hand with Blade of Savagery off-hand. Slayer's Helm, Slayer's Shoulderpads, Slayer's Chestguard form the armor core. Warp-Spring Coil and Dragonspine Trophy are the top trinkets. Choker of Endless Nightmares and Band of the Eternal Champion fill key jewelry slots. Arcanite Steam-Pistol fills the ranged slot.",
            5: "Phase 5 (Sunwell) Subtlety Rogue BiS (Sunwell Plateau) features Warglaive of Azzinoth main-hand with Warglaive of Azzinoth off-hand. Duplicitous Guise, Slayer's Shoulderpads, Slayer's Chestguard form the armor core. Warp-Spring Coil and Dragonspine Trophy are the top trinkets. Hard Khorium Choker and Stormrage Signet Ring fill key jewelry slots. Blade of Life's Inevitability fills the ranged slot.",
        },
        'Priest-Discipline': {
            0: "Pre-raid Discipline Priest BiS features Hand of Eternity main-hand with Windcaller's Orb off-hand. Cowl of Naaru Blessings, Primal Mooncloth Shoulders, Primal Mooncloth Robe form the armor core.",
            1: "Phase 1 Discipline Priest BiS (Karazhan, Gruul & Magtheridon) features Light's Justice main-hand with Windcaller's Orb off-hand. Light-Collar of the Incarnate, Primal Mooncloth Shoulders, Primal Mooncloth Robe form the armor core. Essence of the Martyr and Essence of the Martyr are the top trinkets. Shining Chain of the Afterworld and Violet Signet of the Grand Restorer fill key jewelry slots. Blue Diamond Witchwand fills the ranged slot.",
            2: "Phase 2 Discipline Priest BiS (SSC & TK) features Light's Justice main-hand with Talisman of the Sun King off-hand. Cowl of the Avatar, Mantle of the Avatar, Vestments of the Avatar form the armor core. Essence of the Martyr and Earring of Soulful Meditation are the top trinkets. Teeth of Gruul and Violet Signet of the Grand Restorer fill key jewelry slots. Luminescent Rod of the Naaru fills the ranged slot.",
            3: "Phase 3 Discipline Priest BiS (Black Temple & Hyjal) features Lightfathom Scepter main-hand with Talisman of the Sun King off-hand. Cowl of the Avatar, Mantle of the Avatar, Vestments of the Avatar form the armor core. Earring of Soulful Meditation and Earring of Soulful Meditation are the top trinkets. Lord Sanguinar's Claim and Coral Band of the Revived fill key jewelry slots. Luminescent Rod of the Naaru fills the ranged slot.",
            4: "Phase 4 Discipline Priest BiS (ZA & Badge gear) features Crystal Spire of Karabor main-hand with Scepter of Purification off-hand. Cowl of the Avatar, Mantle of the Avatar, Vestments of the Avatar form the armor core. Essence of the Martyr and Essence of the Martyr are the top trinkets. Lord Sanguinar's Claim and Blessed Band of Karabor fill key jewelry slots. Naaru-Blessed Life Rod fills the ranged slot.",
            5: "Phase 5 (Sunwell) Discipline Priest BiS (Sunwell Plateau) features Golden Staff of the Sin'dorei as the two-handed weapon. Cowl of the Avatar, Mantle of the Avatar, Vestments of the Avatar form the armor core. Essence of the Martyr and Redeemer's Alchemist Stone are the top trinkets. Brooch of Nature's Mercy and Blessed Band of Karabor fill key jewelry slots. Wand of Cleansing Light fills the ranged slot.",
        },
        'Priest-Holy': {
            0: "Pre-raid Holy Priest BiS features Hand of Eternity main-hand with Windcaller's Orb off-hand. Cowl of Naaru Blessings, Primal Mooncloth Shoulders, Primal Mooncloth Robe form the armor core.",
            1: "Phase 1 Holy Priest BiS (Karazhan, Gruul & Magtheridon) features Light's Justice main-hand with Windcaller's Orb off-hand. Light-Collar of the Incarnate, Primal Mooncloth Shoulders, Primal Mooncloth Robe form the armor core. Essence of the Martyr and Essence of the Martyr are the top trinkets. Shining Chain of the Afterworld and Violet Signet of the Grand Restorer fill key jewelry slots. Blue Diamond Witchwand fills the ranged slot.",
            2: "Phase 2 Holy Priest BiS (SSC & TK) features Light's Justice main-hand with Talisman of the Sun King off-hand. Cowl of the Avatar, Mantle of the Avatar, Vestments of the Avatar form the armor core. Essence of the Martyr and Essence of the Martyr are the top trinkets. Shining Chain of the Afterworld and Violet Signet of the Grand Restorer fill key jewelry slots. Luminescent Rod of the Naaru fills the ranged slot.",
            3: "Phase 3 Holy Priest BiS (Black Temple & Hyjal) features Lightfathom Scepter main-hand with Talisman of the Sun King off-hand. Cowl of the Avatar, Mantle of the Avatar, Vestments of the Avatar form the armor core. Earring of Soulful Meditation and Essence of the Martyr are the top trinkets. Lord Sanguinar's Claim and Coral Band of the Revived fill key jewelry slots. Luminescent Rod of the Naaru fills the ranged slot.",
            4: "Phase 4 Holy Priest BiS (ZA & Badge gear) features Crystal Spire of Karabor main-hand with Scepter of Purification off-hand. Cowl of the Avatar, Mantle of the Avatar, Vestments of Absolution form the armor core. Essence of the Martyr and Essence of the Martyr are the top trinkets. Brooch of Nature's Mercy and Blessed Band of Karabor fill key jewelry slots. Naaru-Blessed Life Rod fills the ranged slot.",
            5: "Phase 5 (Sunwell) Holy Priest BiS (Sunwell Plateau) features Golden Staff of the Sin'dorei as the two-handed weapon. Cowl of Light's Purity, Shawl of Wonderment, Robes of Faltered Light form the armor core. Redeemer's Alchemist Stone and Redeemer's Alchemist Stone are the top trinkets. Brooch of Nature's Mercy and Blessed Band of Karabor fill key jewelry slots. Wand of Cleansing Light fills the ranged slot.",
        },
        'Priest-Shadow': {
            0: "Pre-raid Shadow Priest BiS features Gavel of Unearthed Secrets main-hand with Orb of the Soul-Eater off-hand. Spellstrike Hood, Frozen Shadoweave Shoulders, Frozen Shadoweave Robe form the armor core.",
            1: "Phase 1 Shadow Priest BiS (Karazhan, Gruul & Magtheridon) features Nathrezim Mindblade main-hand with Orb of the Soul-Eater off-hand. Spellstrike Hood, Frozen Shadoweave Shoulders, Frozen Shadoweave Robe form the armor core. Icon of the Silver Crescent and Icon of the Silver Crescent are the top trinkets. Ritssyn's Lost Pendant and Ring of the Fallen God fill key jewelry slots. Flawless Wand fills the ranged slot.",
            2: "Phase 2 Shadow Priest BiS (SSC & TK) features Nathrezim Mindblade main-hand with Orb of the Soul-Eater off-hand. Hood of the Avatar, Wings of the Avatar, Shroud of the Avatar form the armor core. Icon of the Silver Crescent and Icon of the Silver Crescent are the top trinkets. Ritssyn's Lost Pendant and Band of Al'ar fill key jewelry slots. Flawless Wand fills the ranged slot.",
            3: "Phase 3 Shadow Priest BiS (Black Temple & Hyjal) features Hammer of Judgment main-hand with Orb of the Soul-Eater off-hand. Hood of the Avatar, Wings of the Avatar, Shroud of the Avatar form the armor core. Icon of the Silver Crescent and Icon of the Silver Crescent are the top trinkets. Ritssyn's Lost Pendant and Band of Al'ar fill key jewelry slots. Wand of the Forgotten Star fills the ranged slot.",
            4: "Phase 4 Shadow Priest BiS (ZA & Badge gear) features Zhar'doom, Greatstaff of the Devourer as the two-handed weapon. Hood of Absolution, Shoulderpads of Absolution, Shroud of Absolution form the armor core. Hex Shrunken Head and Icon of the Silver Crescent are the top trinkets. Loop of Cursed Bones and Ring of Ancient Knowledge fill key jewelry slots. Carved Witch Doctor's Stick fills the ranged slot.",
            5: "Phase 5 (Sunwell) Shadow Priest BiS (Sunwell Plateau) features Reign of Misery main-hand with Heart of the Pit off-hand. Dark Conjuror's Collar, Shoulderpads of Absolution, Sunfire Robe form the armor core. Hex Shrunken Head and Hex Shrunken Head are the top trinkets. Amulet of Unfettered Magics and Ring of Ancient Knowledge fill key jewelry slots. Wand of the Demonsoul fills the ranged slot.",
        },
        'Shaman-Elemental': {
            0: "Pre-raid Elemental Shaman BiS features Gladiator's Gavel main-hand with Khadgar's Knapsack off-hand. Storm Master's Helmet, Pauldrons of Wild Magic, Netherstrike Breastplate form the armor core.",
            1: "Phase 1 Elemental Shaman BiS (Karazhan, Gruul & Magtheridon) features Nathrezim Mindblade main-hand with Mazthoril Honor Shield off-hand. Cyclone Faceguard, Cyclone Shoulderguards, Netherstrike Breastplate form the armor core. Icon of the Silver Crescent and The Lightning Capacitor are the top trinkets. Adornment of Stolen Souls and Ring of Unrelenting Storms fill key jewelry slots. Totem of the Void fills the ranged slot.",
            2: "Phase 2 Elemental Shaman BiS (SSC & TK) features Nathrezim Mindblade main-hand with Mazthoril Honor Shield off-hand. Cyclone Faceguard, Cyclone Shoulderguards, Cataclysm Chestpiece form the armor core. Icon of the Silver Crescent and The Lightning Capacitor are the top trinkets. The Sun King's Talisman and Ring of Unrelenting Storms fill key jewelry slots. Totem of the Void fills the ranged slot.",
            3: "Phase 3 Elemental Shaman BiS (Black Temple & Hyjal) features The Nexus Key as the two-handed weapon. Skyshatter Headguard, Cyclone Shoulderguards, Cataclysm Chestpiece form the armor core. The Lightning Capacitor and The Lightning Capacitor are the top trinkets. The Sun King's Talisman and Ring of Unrelenting Storms fill key jewelry slots. Totem of the Void fills the ranged slot.",
            4: "Phase 4 Elemental Shaman BiS (ZA & Badge gear) features The Maelstrom's Fury main-hand with Antonidas' Aegis of Rapt Concentration off-hand. Skyshatter Headguard, Skyshatter Mantle, Skyshatter Breastplate form the armor core. The Lightning Capacitor and The Lightning Capacitor are the top trinkets. The Sun King's Talisman and Band of the Eternal Sage fill key jewelry slots. Totem of Ancestral Guidance fills the ranged slot.",
            5: "Phase 5 (Sunwell) Elemental Shaman BiS (Sunwell Plateau) features Sunflare main-hand with Antonidas' Aegis of Rapt Concentration off-hand. Cowl of Gul'dan, Skyshatter Mantle, Garments of Crashing Shores form the armor core. Hex Shrunken Head and The Lightning Capacitor are the top trinkets. Pendant of Sunfire and Loop of Forged Power fill key jewelry slots. Totem of Ancestral Guidance fills the ranged slot.",
        },
        'Shaman-Enhancement': {
            0: "Pre-raid Enhancement Shaman BiS features Gladiator's Right Ripper main-hand with Gladiator's Cleaver off-hand. Wastewalker Helm, Wastewalker Shoulderpads, Primalstrike Vest form the armor core.",
            1: "Phase 1 Enhancement Shaman BiS (Karazhan, Gruul & Magtheridon) features The Decapitator main-hand with The Harvester of Souls off-hand. Cyclone Helm, Bladed Shoulderpads of the Merciless, Ebon Netherscale Breastplate form the armor core. Bloodlust Brooch and Bloodlust Brooch are the top trinkets. Choker of Vile Intent and Ring of a Thousand Marks fill key jewelry slots. Totem of the Astral Winds fills the ranged slot.",
            2: "Phase 2 Enhancement Shaman BiS (SSC & TK) features Dragonstrike main-hand with Rod of the Sun King off-hand. Cataclysm Helm, Shoulderpads of the Stranger, Cataclysm Chestplate form the armor core. Bloodlust Brooch and Bloodlust Brooch are the top trinkets. Pendant of the Perilous and Ring of a Thousand Marks fill key jewelry slots. Totem of the Astral Winds fills the ranged slot.",
            3: "Phase 3 Enhancement Shaman BiS (Black Temple & Hyjal) features Talon of the Phoenix main-hand with Rod of the Sun King off-hand. Cataclysm Helm, Shoulderpads of the Stranger, Cataclysm Chestplate form the armor core. Bloodlust Brooch and Dragonspine Trophy are the top trinkets. Pendant of the Perilous and Band of the Ranger-General fill key jewelry slots. Totem of the Astral Winds fills the ranged slot.",
            4: "Phase 4 Enhancement Shaman BiS (ZA & Badge gear) features Vengeful Gladiator's Cleaver main-hand with Vengeful Gladiator's Chopper off-hand. Cursed Vision of Sargeras, Shoulderpads of the Stranger, Midnight Chestguard form the armor core. Dragonspine Trophy and Dragonspine Trophy are the top trinkets. Choker of Endless Nightmares and Band of the Eternal Champion fill key jewelry slots. Stonebreaker's Totem fills the ranged slot.",
            5: "Phase 5 (Sunwell) Enhancement Shaman BiS (Sunwell Plateau) features Hand of the Deceiver main-hand with Mounting Vengeance off-hand. Coif of Alleria, Mantle of the Golden Forest, Carapace of Sun and Shadow form the armor core. Shard of Contempt and Dragonspine Trophy are the top trinkets. Choker of Endless Nightmares and Stormrage Signet Ring fill key jewelry slots. Stonebreaker's Totem fills the ranged slot.",
        },
        'Shaman-Restoration': {
            0: "Pre-raid Restoration Shaman BiS features Hand of Eternity main-hand with Light-Bearer's Faith Shield off-hand. Whitemend Hood, Primal Mooncloth Shoulders, Primal Mooncloth Robe form the armor core.",
            1: "Phase 1 Restoration Shaman BiS (Karazhan, Gruul & Magtheridon) features Light's Justice main-hand with Aegis of the Vindicator off-hand. Cyclone Headdress, Cyclone Shoulderpads, Windhawk Hauberk form the armor core. Essence of the Martyr and Scarab of the Infinite Cycle are the top trinkets. Emberspur Talisman and Jade Ring of the Everliving fill key jewelry slots. Totem of Healing Rains fills the ranged slot.",
            2: "Phase 2 Restoration Shaman BiS (SSC & TK) features Light's Justice main-hand with Aegis of the Vindicator off-hand. Cyclone Headdress, Cataclysm Shoulderguards, Cataclysm Chestguard form the armor core. Essence of the Martyr and Essence of the Martyr are the top trinkets. Emberspur Talisman and Naaru Lightwarden's Band fill key jewelry slots. Totem of Healing Rains fills the ranged slot.",
            3: "Phase 3 Restoration Shaman BiS (Black Temple & Hyjal) features Lightfathom Scepter main-hand with Aegis of the Vindicator off-hand. Cataclysm Headguard, Cataclysm Shoulderguards, Cataclysm Chestguard form the armor core. Essence of the Martyr and Direbrew Hops are the top trinkets. Lord Sanguinar's Claim and Naaru Lightwarden's Band fill key jewelry slots. Totem of Healing Rains fills the ranged slot.",
            4: "Phase 4 Restoration Shaman BiS (ZA & Badge gear) features Crystal Spire of Karabor main-hand with Bastion of Light off-hand. Skyshatter Helmet, Skyshatter Shoulderpads, Skyshatter Chestguard form the armor core. Essence of the Martyr and Essence of the Martyr are the top trinkets. Brooch of Nature's Mercy and Blessed Band of Karabor fill key jewelry slots. Totem of Healing Rains fills the ranged slot.",
            5: "Phase 5 (Sunwell) Restoration Shaman BiS (Sunwell Plateau) features Hammer of Sanctification main-hand with Book of Highborne Hymns off-hand. Shroud of Chieftain Ner'zhul, Skyshatter Shoulderpads, Sun-Drenched Scale Chestguard form the armor core. Essence of the Martyr and Redeemer's Alchemist Stone are the top trinkets. Brooch of Nature's Mercy and Blessed Band of Karabor fill key jewelry slots. Totem of Healing Rains fills the ranged slot.",
        },
        'Mage-Arcane': {
            0: "Pre-raid Arcane Mage BiS features Stormcaller main-hand with Talisman of Kalecgos off-hand. Mana-Binders Cowl, Evoker's Silk Amice, Spellfire Robe form the armor core.",
            1: "Phase 1 Arcane Mage BiS (Karazhan, Gruul & Magtheridon) features Nathrezim Mindblade main-hand with Talisman of Kalecgos off-hand. Collar of the Aldor, Pauldrons of the Aldor, Spellfire Robe form the armor core. Icon of the Silver Crescent and Icon of the Silver Crescent are the top trinkets. Adornment of Stolen Souls and Violet Signet of the Archmage fill key jewelry slots. Eredar Wand of Obliteration fills the ranged slot.",
            2: "Phase 2 Arcane Mage BiS (SSC & TK) features The Nexus Key as the two-handed weapon. Cowl of Tirisfal, Mantle of Tirisfal, Robes of Tirisfal form the armor core. Icon of the Silver Crescent and Serpent-Coil Braid are the top trinkets. The Sun King's Talisman and Band of Eternity fill key jewelry slots. Eredar Wand of Obliteration fills the ranged slot.",
            3: "Phase 3 Arcane Mage BiS (Black Temple & Hyjal) features The Nexus Key as the two-handed weapon. Cowl of Tirisfal, Mantle of Tirisfal, Robes of Tirisfal form the armor core. Icon of the Silver Crescent and Serpent-Coil Braid are the top trinkets. The Sun King's Talisman and Violet Signet of the Archmage fill key jewelry slots. Eredar Wand of Obliteration fills the ranged slot.",
            4: "Phase 4 Arcane Mage BiS (ZA & Badge gear) features Zhar'doom, Greatstaff of the Devourer as the two-handed weapon. Cowl of Tirisfal, Mantle of Tirisfal, Robes of Tirisfal form the armor core. Serpent-Coil Braid and Serpent-Coil Braid are the top trinkets. The Sun King's Talisman and Band of the Eternal Sage fill key jewelry slots. Carved Witch Doctor's Stick fills the ranged slot.",
            5: "Phase 5 (Sunwell) Arcane Mage BiS (Sunwell Plateau) features Sunflare main-hand with Heart of the Pit off-hand. Cowl of Tirisfal, Mantle of Tirisfal, Robes of Ghostly Hatred form the armor core. Hex Shrunken Head and Hex Shrunken Head are the top trinkets. Brooch of Nature's Mercy and Loop of Forged Power fill key jewelry slots. Wand of the Demonsoul fills the ranged slot.",
        },
        'Mage-Fire': {
            0: "Pre-raid Fire Mage BiS features Eternium Runed Blade main-hand with Flametongue Seal off-hand. Mana-Etched Crown, Mana-Etched Spaulders, Spellfire Robe form the armor core.",
            1: "Phase 1 Fire Mage BiS (Karazhan, Gruul & Magtheridon) features Nathrezim Mindblade main-hand with Flametongue Seal off-hand. Spellstrike Hood, Pauldrons of the Aldor, Spellfire Robe form the armor core. Icon of the Silver Crescent and Quagmirran's Eye are the top trinkets. Adornment of Stolen Souls and Violet Signet of the Archmage fill key jewelry slots. Tirisfal Wand of Ascendancy fills the ranged slot.",
            2: "Phase 2 Fire Mage BiS (SSC & TK) features Nathrezim Mindblade main-hand with Flametongue Seal off-hand. Cowl of Tirisfal, Mantle of Tirisfal, Spellfire Robe form the armor core. Icon of the Silver Crescent and Icon of the Silver Crescent are the top trinkets. The Sun King's Talisman and Band of Eternity fill key jewelry slots. Eredar Wand of Obliteration fills the ranged slot.",
            3: "Phase 3 Fire Mage BiS (Black Temple & Hyjal) features Fang of the Leviathan main-hand with Flametongue Seal off-hand. Cowl of Tirisfal, Mantle of Tirisfal, Robes of Tirisfal form the armor core. Icon of the Silver Crescent and Icon of the Silver Crescent are the top trinkets. Hellfire-Encased Pendant and Violet Signet of the Archmage fill key jewelry slots. Wand of the Forgotten Star fills the ranged slot.",
            4: "Phase 4 Fire Mage BiS (ZA & Badge gear) features Zhar'doom, Greatstaff of the Devourer as the two-handed weapon. Cowl of the Illidari High Lord, Mantle of the Tempest, Robes of the Tempest form the armor core. The Skull of Gul'dan and The Skull of Gul'dan are the top trinkets. Hellfire-Encased Pendant and Ring of Ancient Knowledge fill key jewelry slots. Wand of the Forgotten Star fills the ranged slot.",
            5: "Phase 5 (Sunwell) Fire Mage BiS (Sunwell Plateau) features Sunflare main-hand with Chronicle of Dark Secrets off-hand. Dark Conjuror's Collar, Mantle of the Tempest, Sunfire Robe form the armor core. Shifting Naaru Sliver and The Skull of Gul'dan are the top trinkets. Amulet of Unfettered Magics and Loop of Forged Power fill key jewelry slots. Wand of the Demonsoul fills the ranged slot.",
        },
        'Mage-Frost': {
            0: "Pre-raid Frost Mage BiS features Eternium Runed Blade main-hand with Sapphiron's Wing Bone off-hand. Mana-Etched Crown, Frozen Shadoweave Shoulders, Frozen Shadoweave Robe form the armor core.",
            1: "Phase 1 Frost Mage BiS (Karazhan, Gruul & Magtheridon) features Nathrezim Mindblade main-hand with Sapphiron's Wing Bone off-hand. Spellstrike Hood, Frozen Shadoweave Shoulders, Frozen Shadoweave Robe form the armor core. Icon of the Silver Crescent and Icon of the Silver Crescent are the top trinkets. Adornment of Stolen Souls and Violet Signet of the Archmage fill key jewelry slots. The Black Stalk fills the ranged slot.",
            2: "Phase 2 Frost Mage BiS (SSC & TK) features Nathrezim Mindblade main-hand with Sapphiron's Wing Bone off-hand. Collar of the Aldor, Mantle of Tirisfal, Robes of Tirisfal form the armor core. Icon of the Silver Crescent and Icon of the Silver Crescent are the top trinkets. Adornment of Stolen Souls and Band of Eternity fill key jewelry slots. Eredar Wand of Obliteration fills the ranged slot.",
            3: "Phase 3 Frost Mage BiS (Black Temple & Hyjal) features The Nexus Key as the two-handed weapon. Cowl of Tirisfal, Mantle of Tirisfal, Robes of Tirisfal form the armor core. Icon of the Silver Crescent and Serpent-Coil Braid are the top trinkets. The Sun King's Talisman and Band of Eternity fill key jewelry slots. Eredar Wand of Obliteration fills the ranged slot.",
            4: "Phase 4 Frost Mage BiS (ZA & Badge gear) features Zhar'doom, Greatstaff of the Devourer as the two-handed weapon. Cowl of the Tempest, Mantle of the Tempest, Robes of the Tempest form the armor core. The Skull of Gul'dan and The Skull of Gul'dan are the top trinkets. The Sun King's Talisman and Ring of Ancient Knowledge fill key jewelry slots. Carved Witch Doctor's Stick fills the ranged slot.",
            5: "Phase 5 (Sunwell) Frost Mage BiS (Sunwell Plateau) features Sunflare main-hand with Heart of the Pit off-hand. Dark Conjuror's Collar, Amice of the Convoker, Sunfire Robe form the armor core. The Skull of Gul'dan and The Skull of Gul'dan are the top trinkets. Amulet of Unfettered Magics and Loop of Forged Power fill key jewelry slots. Wand of the Demonsoul fills the ranged slot.",
        },
        'Warlock-Affliction': {
            0: "Pre-raid Affliction Warlock BiS features Blade of Wizardry main-hand with Khadgar's Knapsack off-hand. Spellstrike Hood, Frozen Shadoweave Shoulders, Frozen Shadoweave Robe form the armor core.",
            1: "Phase 1 Affliction Warlock BiS (Karazhan, Gruul & Magtheridon) features Nathrezim Mindblade main-hand with Orb of the Soul-Eater off-hand. Voidheart Crown, Voidheart Mantle, Voidheart Robe form the armor core. Icon of the Silver Crescent and Quagmirran's Eye are the top trinkets. Ritssyn's Lost Pendant and Band of Crimson Fury fill key jewelry slots. Tirisfal Wand of Ascendancy fills the ranged slot.",
            2: "Phase 2 Affliction Warlock BiS (SSC & TK) features Nathrezim Mindblade main-hand with Orb of the Soul-Eater off-hand. Voidheart Crown, Voidheart Mantle, Voidheart Robe form the armor core. Icon of the Silver Crescent and Icon of the Silver Crescent are the top trinkets. The Sun King's Talisman and Band of Eternity fill key jewelry slots. Tirisfal Wand of Ascendancy fills the ranged slot.",
            3: "Phase 3 Affliction Warlock BiS (Black Temple & Hyjal) features Fang of the Leviathan main-hand with Fathomstone off-hand. Hood of the Corruptor, Voidheart Mantle, Vestments of the Sea-Witch form the armor core. Icon of the Silver Crescent and Quagmirran's Eye are the top trinkets. The Sun King's Talisman and Ring of Endless Coils fill key jewelry slots. Wand of the Forgotten Star fills the ranged slot.",
            4: "Phase 4 Affliction Warlock BiS (ZA & Badge gear) features Zhar'doom, Greatstaff of the Devourer as the two-handed weapon. Hood of the Malefic, Mantle of the Malefic, Vestments of the Sea-Witch form the armor core. Quagmirran's Eye and Quagmirran's Eye are the top trinkets. Loop of Cursed Bones and Band of the Eternal Sage fill key jewelry slots. Wand of the Forgotten Star fills the ranged slot.",
            5: "Phase 5 (Sunwell) Affliction Warlock BiS (Sunwell Plateau) features Sunflare main-hand with Heart of the Pit off-hand. Dark Conjuror's Collar, Mantle of the Malefic, Sunfire Robe form the armor core. The Skull of Gul'dan and The Skull of Gul'dan are the top trinkets. Amulet of Unfettered Magics and Loop of Forged Power fill key jewelry slots. Wand of the Demonsoul fills the ranged slot.",
        },
        'Warlock-Demonology': {
            0: "Pre-raid Demonology Warlock BiS features Blade of Wizardry main-hand with Khadgar's Knapsack off-hand. Spellstrike Hood, Frozen Shadoweave Shoulders, Frozen Shadoweave Robe form the armor core.",
            1: "Phase 1 Demonology Warlock BiS (Karazhan, Gruul & Magtheridon) features Nathrezim Mindblade main-hand with Khadgar's Knapsack off-hand. Voidheart Crown, Voidheart Mantle, Voidheart Robe form the armor core. Icon of the Silver Crescent and Quagmirran's Eye are the top trinkets. Ritssyn's Lost Pendant and Band of Crimson Fury fill key jewelry slots. Tirisfal Wand of Ascendancy fills the ranged slot.",
            2: "Phase 2 Demonology Warlock BiS (SSC & TK) features Nathrezim Mindblade main-hand with Orb of the Soul-Eater off-hand. Voidheart Crown, Voidheart Mantle, Voidheart Robe form the armor core. Icon of the Silver Crescent and Quagmirran's Eye are the top trinkets. The Sun King's Talisman and Band of Eternity fill key jewelry slots. Tirisfal Wand of Ascendancy fills the ranged slot.",
            3: "Phase 3 Demonology Warlock BiS (Black Temple & Hyjal) features Fang of the Leviathan main-hand with Fathomstone off-hand. Hood of the Corruptor, Mantle of the Corruptor, Vestments of the Sea-Witch form the armor core. Icon of the Silver Crescent and Quagmirran's Eye are the top trinkets. The Sun King's Talisman and Band of Eternity fill key jewelry slots. Wand of the Forgotten Star fills the ranged slot.",
            4: "Phase 4 Demonology Warlock BiS (ZA & Badge gear) features Zhar'doom, Greatstaff of the Devourer as the two-handed weapon. Hood of the Malefic, Mantle of the Malefic, Vestments of the Sea-Witch form the armor core. The Skull of Gul'dan and Quagmirran's Eye are the top trinkets. The Sun King's Talisman and Band of the Eternal Sage fill key jewelry slots. Wand of the Forgotten Star fills the ranged slot.",
            5: "Phase 5 (Sunwell) Demonology Warlock BiS (Sunwell Plateau) features Zhar'doom, Greatstaff of the Devourer as the two-handed weapon. Hood of the Malefic, Mantle of the Malefic, Sunfire Robe form the armor core. The Skull of Gul'dan and The Skull of Gul'dan are the top trinkets. Amulet of Unfettered Magics and Mana Attuned Band fill key jewelry slots. Wand of the Demonsoul fills the ranged slot.",
        },
        'Warlock-Destruction': {
            0: "Pre-raid Destruction Warlock BiS features Blade of Wizardry main-hand with Flametongue Seal off-hand. Spellstrike Hood, Frozen Shadoweave Shoulders, Frozen Shadoweave Robe form the armor core.",
            1: "Phase 1 Destruction Warlock BiS (Karazhan, Gruul & Magtheridon) features Nathrezim Mindblade main-hand with Flametongue Seal off-hand. Voidheart Crown, Voidheart Mantle, Spellfire Robe form the armor core. Icon of the Silver Crescent and Quagmirran's Eye are the top trinkets. Brooch of Unquenchable Fury and Band of Crimson Fury fill key jewelry slots. Tirisfal Wand of Ascendancy fills the ranged slot.",
            2: "Phase 2 Destruction Warlock BiS (SSC & TK) features Fang of the Leviathan main-hand with Fathomstone off-hand. Destruction Holo-Gogs, Voidheart Mantle, Vestments of the Sea-Witch form the armor core. Icon of the Silver Crescent and Quagmirran's Eye are the top trinkets. The Sun King's Talisman and Band of Eternity fill key jewelry slots. Wand of the Forgotten Star fills the ranged slot.",
            3: "Phase 3 Destruction Warlock BiS (Black Temple & Hyjal) features Fang of the Leviathan main-hand with Fathomstone off-hand. Hood of the Malefic, Voidheart Mantle, Vestments of the Sea-Witch form the armor core. Icon of the Silver Crescent and Quagmirran's Eye are the top trinkets. The Sun King's Talisman and Ring of Endless Coils fill key jewelry slots. Wand of the Forgotten Star fills the ranged slot.",
            4: "Phase 4 Destruction Warlock BiS (ZA & Badge gear) features Zhar'doom, Greatstaff of the Devourer as the two-handed weapon. Hood of the Malefic, Mantle of the Malefic, Vestments of the Sea-Witch form the armor core. The Skull of Gul'dan and Quagmirran's Eye are the top trinkets. The Sun King's Talisman and Ring of Ancient Knowledge fill key jewelry slots. Wand of the Forgotten Star fills the ranged slot.",
            5: "Phase 5 (Sunwell) Destruction Warlock BiS (Sunwell Plateau) features Sunflare main-hand with Heart of the Pit off-hand. Dark Conjuror's Collar, Mantle of the Malefic, Sunfire Robe form the armor core. The Skull of Gul'dan and The Skull of Gul'dan are the top trinkets. Amulet of Unfettered Magics and Loop of Forged Power fill key jewelry slots. Wand of the Demonsoul fills the ranged slot.",
        },
        'Druid-Balance': {
            0: "Pre-raid Balance Druid BiS features Eternium Runed Blade main-hand with Talisman of Kalecgos off-hand. Spellstrike Hood, Mana-Etched Spaulders, Spellfire Robe form the armor core.",
            1: "Phase 1 Balance Druid BiS (Karazhan, Gruul & Magtheridon) features Nathrezim Mindblade main-hand with Talisman of Kalecgos off-hand. Spellstrike Hood, Pauldrons of Malorne, Spellfire Robe form the armor core. Icon of the Silver Crescent and Quagmirran's Eye are the top trinkets. Brooch of Unquenchable Fury and Violet Signet of the Archmage fill key jewelry slots. Ivory Idol of the Moongoddess fills the ranged slot.",
            2: "Phase 2 Balance Druid BiS (SSC & TK) features Nathrezim Mindblade main-hand with Talisman of Kalecgos off-hand. Nordrassil Headpiece, Nordrassil Wrath-Mantle, Nordrassil Chestpiece form the armor core. Icon of the Silver Crescent and Quagmirran's Eye are the top trinkets. The Sun King's Talisman and Band of Eternity fill key jewelry slots. Ivory Idol of the Moongoddess fills the ranged slot.",
            3: "Phase 3 Balance Druid BiS (Black Temple & Hyjal) features The Nexus Key as the two-handed weapon. Nordrassil Headpiece, Nordrassil Wrath-Mantle, Nordrassil Chestpiece form the armor core. Icon of the Silver Crescent and Quagmirran's Eye are the top trinkets. The Sun King's Talisman and Ring of Recurrence fill key jewelry slots. Idol of the Raven Goddess fills the ranged slot.",
            4: "Phase 4 Balance Druid BiS (ZA & Badge gear) features Zhar'doom, Greatstaff of the Devourer as the two-handed weapon. Thunderheart Headguard, Thunderheart Shoulderpads, Thunderheart Vest form the armor core. Icon of the Silver Crescent and Quagmirran's Eye are the top trinkets. The Sun King's Talisman and Band of the Eternal Sage fill key jewelry slots. Idol of the Raven Goddess fills the ranged slot.",
            5: "Phase 5 (Sunwell) Balance Druid BiS (Sunwell Plateau) features Sunflare main-hand with Heart of the Pit off-hand. Dark Conjuror's Collar, Thunderheart Shoulderpads, Sunfire Robe form the armor core. The Skull of Gul'dan and The Skull of Gul'dan are the top trinkets. Amulet of Unfettered Magics and Loop of Forged Power fill key jewelry slots. Ivory Idol of the Moongoddess fills the ranged slot.",
        },
        'Druid-Bear': {
            0: "Pre-raid Feral Bear Druid BiS features Earthwarden as the weapon. Wastewalker Helm, Mantle of Perenolde, Ghoul Skin Tunic form the armor core.",
            1: "Phase 1 Feral Bear Druid BiS (Karazhan, Gruul & Magtheridon) features Terestian's Stranglestaff as the two-handed weapon. Stag-Helm of Malorne, Mantle of Malorne, Breastplate of Malorne form the armor core. Bloodlust Brooch and Bloodlust Brooch are the top trinkets. Worgen Claw Necklace and Shapeshifter's Signet fill key jewelry slots. Idol of Brutality fills the ranged slot.",
            2: "Phase 2 Feral Bear Druid BiS (SSC & TK) features Wildfury Greatstaff as the two-handed weapon. Nordrassil Headdress, Nordrassil Feral-Mantle, Nordrassil Chestplate form the armor core. Bloodlust Brooch and Bloodlust Brooch are the top trinkets. Veteran's Pendant of Triumph and Shapeshifter's Signet fill key jewelry slots. Idol of the Raven Goddess fills the ranged slot.",
            3: "Phase 3 Feral Bear Druid BiS (Black Temple & Hyjal) features Merciless Gladiator's Maul as the two-handed weapon. Thunderheart Cover, Thunderheart Pauldrons, Nordrassil Chestplate form the armor core. Bloodlust Brooch and Tsunami Talisman are the top trinkets. Vindicator's Pendant of Triumph and Shapeshifter's Signet fill key jewelry slots. Idol of the Raven Goddess fills the ranged slot.",
            4: "Phase 4 Feral Bear Druid BiS (ZA & Badge gear) features Vengeful Gladiator's Staff as the two-handed weapon. Vengeful Gladiator's Dragonhide Helm, Thunderheart Pauldrons, Thunderheart Chestguard form the armor core. Tsunami Talisman and Tsunami Talisman are the top trinkets. Brooch of Deftness and Band of the Eternal Champion fill key jewelry slots. Idol of the Raven Goddess fills the ranged slot.",
            5: "Phase 5 (Sunwell) Feral Bear Druid BiS (Sunwell Plateau) features Stanchion of Primal Instinct as the two-handed weapon. Brutal Gladiator's Dragonhide Helm, Demontooth Shoulderpads, Brutal Gladiator's Dragonhide Tunic form the armor core. Badge of Tenacity and Shard of Contempt are the top trinkets. Collar of the Pit Lord and Angelista's Revenge fill key jewelry slots. Idol of Terror fills the ranged slot.",
        },
        'Druid-Cat': {
            0: "Pre-raid Feral Cat Druid BiS features Staff of Natural Fury as the weapon. Wolfshead Helm, Wastewalker Shoulderpads, Primalstrike Vest form the armor core.",
            1: "Phase 1 Feral Cat Druid BiS (Karazhan, Gruul & Magtheridon) features Terestian's Stranglestaff as the two-handed weapon. Wolfshead Helm, Mantle of Malorne, Breastplate of Malorne form the armor core. Bloodlust Brooch and Bloodlust Brooch are the top trinkets. Choker of Vile Intent and Shapeshifter's Signet fill key jewelry slots. Everbloom Idol fills the ranged slot.",
            2: "Phase 2 Feral Cat Druid BiS (SSC & TK) features Terestian's Stranglestaff as the two-handed weapon. Wolfshead Helm, Mantle of Malorne, Breastplate of Malorne form the armor core. Bloodlust Brooch and Tsunami Talisman are the top trinkets. Braided Eternium Chain and Shapeshifter's Signet fill key jewelry slots. Everbloom Idol fills the ranged slot.",
            3: "Phase 3 Feral Cat Druid BiS (Black Temple & Hyjal) features Merciless Gladiator's Maul as the two-handed weapon. Wolfshead Helm, Nordrassil Feral-Mantle, Nordrassil Chestplate form the armor core. Bloodlust Brooch and Tsunami Talisman are the top trinkets. Telonicus' Pendant of Mayhem and Shapeshifter's Signet fill key jewelry slots. Everbloom Idol fills the ranged slot.",
            4: "Phase 4 Feral Cat Druid BiS (ZA & Badge gear) features Vengeful Gladiator's Staff as the two-handed weapon. Wolfshead Helm, Thunderheart Pauldrons, Thunderheart Chestguard form the armor core. Tsunami Talisman and Tsunami Talisman are the top trinkets. Telonicus' Pendant of Mayhem and Band of the Eternal Champion fill key jewelry slots. Everbloom Idol fills the ranged slot.",
            5: "Phase 5 (Sunwell) Feral Cat Druid BiS (Sunwell Plateau) features Stanchion of Primal Instinct as the two-handed weapon. Wolfshead Helm, Thunderheart Pauldrons, Bladed Chaos Tunic form the armor core. Shard of Contempt and Shard of Contempt are the top trinkets. Telonicus' Pendant of Mayhem and Angelista's Revenge fill key jewelry slots. Everbloom Idol fills the ranged slot.",
        },
        'Druid-Restoration': {
            0: "Pre-raid Restoration Druid BiS features Gladiator's Salvation main-hand with Tears of Heaven off-hand. Whitemend Hood, Primal Mooncloth Shoulders, Primal Mooncloth Robe form the armor core.",
            1: "Phase 1 Restoration Druid BiS (Karazhan, Gruul & Magtheridon) features Light's Justice main-hand with Windcaller's Orb off-hand. Crown of Malorne, Primal Mooncloth Shoulders, Primal Mooncloth Robe form the armor core. Essence of the Martyr and Essence of the Martyr are the top trinkets. Shining Chain of the Afterworld and Violet Signet of the Grand Restorer fill key jewelry slots. Idol of the Emerald Queen fills the ranged slot.",
            2: "Phase 2 Restoration Druid BiS (SSC & TK) features Light's Justice main-hand with Windcaller's Orb off-hand. Nordrassil Headguard, Nordrassil Life-Mantle, Nordrassil Chestguard form the armor core. Essence of the Martyr and Essence of the Martyr are the top trinkets. Teeth of Gruul and Violet Signet of the Grand Restorer fill key jewelry slots. Idol of the Emerald Queen fills the ranged slot.",
            3: "Phase 3 Restoration Druid BiS (Black Temple & Hyjal) features Lightfathom Scepter main-hand with Talisman of the Sun King off-hand. Nordrassil Headguard, Nordrassil Life-Mantle, Nordrassil Chestguard form the armor core. Essence of the Martyr and Essence of the Martyr are the top trinkets. Lord Sanguinar's Claim and Coral Band of the Revived fill key jewelry slots. Idol of the Emerald Queen fills the ranged slot.",
            4: "Phase 4 Restoration Druid BiS (ZA & Badge gear) features Crystal Spire of Karabor main-hand with Scepter of Purification off-hand. Thunderheart Helmet, Thunderheart Spaulders, Thunderheart Tunic form the armor core. Essence of the Martyr and Essence of the Martyr are the top trinkets. Lord Sanguinar's Claim and Blessed Band of Karabor fill key jewelry slots. Idol of the Emerald Queen fills the ranged slot.",
            5: "Phase 5 (Sunwell) Restoration Druid BiS (Sunwell Plateau) features Golden Staff of the Sin'dorei as the two-handed weapon. Cowl of Light's Purity, Spaulders of Reclamation, Nordrassil Chestguard form the armor core. Redeemer's Alchemist Stone and Redeemer's Alchemist Stone are the top trinkets. Brooch of Nature's Mercy and Blessed Band of Karabor fill key jewelry slots. Idol of the Crescent Goddess fills the ranged slot.",
        },
    };

    /**
     * Generate a contextual description for a given class/spec/phase.
     * Returns a short paragraph suitable for an in-page blurb and meta description.
     */
    function generateSpecDescription(cls, spec, phase) {
        const key = `${cls}-${spec}`;
        const phaseDesc = SPEC_PHASE_DESCRIPTIONS[key];
        if (!phaseDesc) return null;
        return phaseDesc[phase] || null;
    }

    // Phase → raid-tier context, used in the closing summary paragraph.
    const PHASE_RAID_CONTEXT = {
        0: 'Pre-Raid dungeons and heroics',
        1: "Karazhan, Gruul's Lair, and Magtheridon's Lair",
        2: 'Serpentshrine Cavern and Tempest Keep',
        3: 'Black Temple and Mount Hyjal',
        4: "Zul'Aman and Badge of Justice gear",
        5: 'Sunwell Plateau'
    };

    function escapeHtmlText(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    /**
     * Render the SEO description block (H2 + paragraph) below the GS summary.
     * Only shows in PvE BiS view with a known class/spec/phase.
     */
    function renderSeoDescription() {
        const el = $('seoDescription');
        if (!el) return;

        // PvP route — render the rich PvP intro (mirrors prerender).
        if (state.isPvP && state.selectedClass && state.selectedSpec) {
            renderPvpSeoDescription(el);
            return;
        }

        if (state.selectedPhase == null || !state.selectedClass || !state.selectedSpec) {
            el.classList.add('hidden');
            el.innerHTML = '';
            return;
        }

        const rawDesc = generateSpecDescription(state.selectedClass, state.selectedSpec, state.selectedPhase);
        if (!rawDesc) {
            el.classList.add('hidden');
            el.innerHTML = '';
            return;
        }

        const phInfo  = PHASE_NAMES[state.selectedPhase] || { label: `Phase ${state.selectedPhase}` };
        const seoPhLabel = state.selectedPhase === 0 ? 'Pre-Raid' : phInfo.label;
        const heading = `${specWithAbbrev(state.selectedClass, state.selectedSpec)} ${seoPhLabel} BiS Guide`;
        const text    = injectAbbrev(rawDesc, state.selectedClass, state.selectedSpec);
        el.innerHTML = `<div class="seo-desc-inner">
            <span class="seo-desc-icon">📖</span>
            <div>
                <h2 class="seo-desc-heading">${escapeHtmlText(heading)}</h2>
                <p class="seo-desc-text">${escapeHtmlText(text)}</p>
            </div>
        </div>`;
        el.classList.remove('hidden');
    }

    /** Render the PvP-specific seoDescription block — arena role, playstyle,
     *  comps, stat priority. Mirrors buildPvpDescriptionBlock in prerender.js. */
    function renderPvpSeoDescription(el) {
        const cls  = state.selectedClass;
        const spec = state.selectedSpec;
        const ctx  = PVP_SPEC_CONTEXT[`${cls}|${spec}`];
        const specLabel = specWithAbbrev(cls, spec);
        const baseDesc = `Live arena snapshot of the best gear for ${specLabel} PvP in TBC Classic, based on what the highest-rated arena players are wearing right now. Includes enchants and gems.`;

        const extra = ctx ? `
        <div class="pvp-context">
            <h3>Arena role</h3>
            <p class="pvp-context-role">${escapeHtmlText(ctx.roleSummary)}</p>
            ${ctx.playstyleHtml}
            <h3>Common arena compositions</h3>
            ${ctx.compsHtml}
            <h3>Stat priority</h3>
            ${ctx.statsHtml}
        </div>` : '';

        el.innerHTML = `<div class="seo-desc-inner">
            <span class="seo-desc-icon">⚔️</span>
            <div>
                <h2 class="seo-desc-heading">${escapeHtmlText(specLabel)} PvP BiS — TBC Classic Arena</h2>
                <p class="seo-desc-text">${escapeHtmlText(baseDesc)}</p>${extra}
            </div>
        </div>`;
        el.classList.remove('hidden');
    }

    /**
     * Render the visible FAQ block (same Q&A as the JSON-LD FAQPage schema).
     * Only shows on phase pages.
     */
    function renderSeoFaq() {
        const el = $('seoFaq');
        if (!el) return;
        if (state.isPvP && state.selectedClass && state.selectedSpec) {
            renderPvpFaq(el);
            return;
        }
        if (state.selectedPhase == null || !state.selectedClass || !state.selectedSpec) {
            el.classList.add('hidden');
            el.innerHTML = '';
            return;
        }
        const phLabel = (PHASE_NAMES[state.selectedPhase] || { label: `Phase ${state.selectedPhase}` }).label;
        const rawDesc = generateSpecDescription(state.selectedClass, state.selectedSpec, state.selectedPhase) || '';
        const desc    = injectAbbrev(rawDesc, state.selectedClass, state.selectedSpec);
        const items = [
            {
                q: `What is BiS for ${state.selectedSpec} ${state.selectedClass} in ${phLabel}?`,
                a: desc
            },
            {
                q: `Where do I get ${state.selectedSpec} ${state.selectedClass} ${phLabel} gear?`,
                a: state.selectedPhase === 0
                    ? 'The best gear comes from dungeons, heroics, reputation vendors, and crafting. See the full list above with item sources for each slot.'
                    : 'The best gear comes from raid drops, Badge of Justice vendor, arena, and crafted items. See the full list above with item sources for each slot.'
            },
            {
                q: `What enchants and gems should ${state.selectedSpec} ${state.selectedClass} use in ${phLabel}?`,
                a: `Each slot has a recommended enchant and gem shown next to the item. Enchants and gems are chosen based on the stat priority for ${state.selectedSpec} ${state.selectedClass} in TBC Classic.`
            }
        ];
        const dl = items.map(i => `<dt>${escapeHtmlText(i.q)}</dt><dd>${escapeHtmlText(i.a)}</dd>`).join('');
        el.innerHTML = `<h2 class="seo-faq-heading">Frequently Asked Questions</h2><dl>${dl}</dl>`;
        el.classList.remove('hidden');
    }

    /** Render the PvP-specific FAQ block using scraped PVP_DATA. Mirrors
     *  buildPvpFaqBlock in prerender.js. */
    function renderPvpFaq(el) {
        const cls  = state.selectedClass;
        const spec = state.selectedSpec;
        const sd   = (typeof PVP_DATA !== 'undefined' && PVP_DATA.specs) ? PVP_DATA.specs[`${cls}|${spec}`] : null;
        const items = buildPvpFaqItemsRuntime(cls, spec, sd);
        if (!items.length) {
            el.classList.add('hidden');
            el.innerHTML = '';
            return;
        }
        const dl = items.map(i => `<dt>${escapeHtmlText(i.q)}</dt><dd>${escapeHtmlText(i.a)}</dd>`).join('');
        el.innerHTML = `<h2 class="seo-faq-heading">Frequently Asked Questions</h2><dl>${dl}</dl>`;
        el.classList.remove('hidden');
    }

    /**
     * Render the closing summary block: keyword-rich paragraph + cross-links to
     * sibling phases and sibling specs. Strong internal-linking signal.
     */
    function renderSeoSummary() {
        const el = $('seoSummary');
        if (!el) return;
        if (state.isPvP && state.selectedClass && state.selectedSpec) {
            renderPvpSummary(el);
            return;
        }
        if (state.selectedPhase == null || !state.selectedClass || !state.selectedSpec) {
            el.classList.add('hidden');
            el.innerHTML = '';
            return;
        }
        const seoPhLabel = state.selectedPhase === 0 ? 'Pre-Raid' : (PHASE_NAMES[state.selectedPhase] || {}).label;
        const raid       = PHASE_RAID_CONTEXT[state.selectedPhase] || '';
        const specName   = specWithAbbrev(state.selectedClass, state.selectedSpec);
        const cls        = state.selectedClass;
        const spec       = state.selectedSpec;

        const otherPhases = [0, 1, 2, 3, 4, 5]
            .filter(p => p !== state.selectedPhase)
            .map(p => {
                const slug  = PHASE_TO_SLUG[p];
                const label = p === 0 ? 'Pre-Raid' : PHASE_NAMES[p].label;
                return `<a href="/${toSlug(cls)}/${toSlug(spec)}/${slug}">${escapeHtmlText(label)}</a>`;
            }).join(' · ');

        const otherSpecs = (CLASS_META[cls] ? CLASS_META[cls].specs : [])
            .filter(s => s !== spec)
            .map(s => {
                const abbrev = SPEC_ABBREV[`${cls}-${s}`];
                const label  = abbrev ? `${s} (${abbrev})` : s;
                return `<a href="/${toSlug(cls)}/${toSlug(s)}/${PHASE_TO_SLUG[state.selectedPhase]}">${escapeHtmlText(label)}</a>`;
            }).join(' · ');

        let html = `<p>This <strong>${escapeHtmlText(specName)} ${escapeHtmlText(seoPhLabel)} Best in Slot</strong> list covers gear for ${escapeHtmlText(raid)} in TBC Classic — including enchants, gems, and stat priority recommendations.</p>
        <p>Other phases: ${otherPhases}</p>`;
        if (otherSpecs) {
            html += `<p>Other ${escapeHtmlText(cls)} specs (${escapeHtmlText(seoPhLabel)}): ${otherSpecs}</p>`;
        }
        el.innerHTML = html;
        el.classList.remove('hidden');
    }

    /** Render the PvP-specific closing summary: data-refresh note + cross-links
     *  to PvE BiS and sibling PvP specs. Mirrors buildPvpSummaryBlock. */
    function renderPvpSummary(el) {
        const cls  = state.selectedClass;
        const spec = state.selectedSpec;
        const sd   = (typeof PVP_DATA !== 'undefined' && PVP_DATA.specs) ? PVP_DATA.specs[`${cls}|${spec}`] : null;
        const analyzedAt = (typeof PVP_DATA !== 'undefined' && PVP_DATA.meta && PVP_DATA.meta.analyzedAt)
            ? PVP_DATA.meta.analyzedAt.slice(0, 10) : null;

        const dataNote = sd
            ? `<p><em>How this list is built:</em> the items above are aggregated from the public arena leaderboard scrape at ironforge.pro, filtered to ${escapeHtmlText(spec)} ${escapeHtmlText(cls)}s within a competitive rating range. The snapshot refreshes weekly so the rankings track the live meta.${analyzedAt ? ` Current snapshot analyzed on ${escapeHtmlText(analyzedAt)}.` : ''}</p>`
            : '';

        const pveLink = `<a href="/${toSlug(cls)}/${toSlug(spec)}"><strong>${escapeHtmlText(spec)} ${escapeHtmlText(cls)} PvE BiS</strong></a>`;

        const otherSpecs = (CLASS_META[cls] ? CLASS_META[cls].specs : [])
            .filter(s => s !== spec)
            .map(s => {
                const a = SPEC_ABBREV[`${cls}-${s}`];
                const label = a ? `${s} (${a})` : s;
                return `<a href="/${toSlug(cls)}/${toSlug(s)}/pvp">${escapeHtmlText(label)} PvP</a>`;
            }).join(' · ');

        el.innerHTML = `${dataNote}<p>Looking for raid gear instead? See ${pveLink} for phase-by-phase PvE Best in Slot.</p>${otherSpecs ? `<p>Other ${escapeHtmlText(cls)} PvP specs: ${otherSpecs}</p>` : ''}`;
        el.classList.remove('hidden');
    }

    // Short raid name for anchor text in cross-links (matches prerender.js).
    const PHASE_RAID_SHORT = {
        0: 'Pre-Raid Dungeons', 1: 'Karazhan', 2: 'SSC & TK',
        3: 'Black Temple', 4: "Zul'Aman", 5: 'Sunwell'
    };

    function phaseAnchorText(phase) {
        const label = phase === 0 ? 'Pre-Raid' : (PHASE_NAMES[phase] || {}).label;
        const raid  = PHASE_RAID_SHORT[phase];
        if (!raid) return label;
        if (phase === 0) return 'Pre-Raid (Dungeons)';
        return `${label} (${raid})`;
    }

    /**
     * Render the SEO landing block for class pages (e.g. /paladin).
     * Visible content: H2 + intro + spec list + phase quick-links.
     * Uses existing SPEC_ROLES (defined further down — referenced lazily at call time).
     */
    function renderClassLanding() {
        const el = document.getElementById('seoClassLanding');
        if (!el) return;
        const cls = state.selectedClass;
        // Only render when on class landing (class selected, no spec).
        if (!cls || state.selectedSpec) {
            el.classList.add('hidden');
            el.innerHTML = '';
            return;
        }
        const specs = (CLASS_META[cls] || {}).specs || [];
        const specLis = specs.map(s => {
            const abbrev = SPEC_ABBREV[`${cls}-${s}`];
            const label  = abbrev ? `${s} (${abbrev}) ${cls}` : `${s} ${cls}`;
            const role   = SPEC_ROLES[s] || '';
            return `<li><a href="/${toSlug(cls)}/${toSlug(s)}"><strong>${escapeHtmlText(label)} BiS</strong></a>${role ? ' — ' + escapeHtmlText(role) : ''}</li>`;
        }).join('');

        // Phase quick-links: one row per spec, all six phases each.
        const phaseSpecBlocks = specs.map(s => {
            const links = [0, 1, 2, 3, 4, 5].map(p => {
                const slug = PHASE_TO_SLUG[p];
                const href = `/${toSlug(cls)}/${toSlug(s)}/${slug}`;
                return `<a href="${href}">${escapeHtmlText(phaseAnchorText(p))}</a>`;
            }).join(' · ');
            return `<p><strong>${escapeHtmlText(s)}:</strong> ${links}</p>`;
        }).join('');

        // PvP cross-links: only specs with scraped arena data (includes PvP-only
        // specs like Druid Feral Combat that aren't in CLASS_META).
        const pvpSpecs = [];
        if (typeof PVP_DATA !== 'undefined' && PVP_DATA.specs) {
            for (const key of Object.keys(PVP_DATA.specs)) {
                const [pvpCls, pvpSpec] = key.split('|');
                if (pvpCls === cls && !pvpSpecs.includes(pvpSpec)) pvpSpecs.push(pvpSpec);
            }
        }
        const pvpLinks = pvpSpecs.map(spec =>
            `<a href="/${toSlug(cls)}/${toSlug(spec)}/pvp">${escapeHtmlText(spec)} PvP</a>`
        ).join(' · ');

        el.innerHTML = `<h2>${escapeHtmlText(cls)} BiS for TBC Classic — Every Spec, Every Phase</h2>
            <p>Best in Slot gear guides for <strong>${escapeHtmlText(cls)}</strong> in WoW Classic TBC. Pick a spec for phase-by-phase BiS lists from Pre-Raid through Sunwell Plateau, including enchants, gems, and stat priority recommendations.</p>
            <h3>${escapeHtmlText(cls)} specs</h3>
            <ul>${specLis}</ul>
            ${phaseSpecBlocks ? `<h3>Quick links by phase</h3>${phaseSpecBlocks}` : ''}
            ${pvpLinks ? `<h3>${escapeHtmlText(cls)} PvP BiS</h3><p>Live arena snapshot of top-rated players. ${pvpLinks}</p>` : ''}`;
        el.classList.remove('hidden');
    }

    /**
     * Render the SEO landing block for spec pages (e.g. /paladin/retribution).
     * Visible content: H2 + intro + phase list with raid context.
     */
    function renderSpecLanding() {
        const el = document.getElementById('seoSpecLanding');
        if (!el) return;
        const cls  = state.selectedClass;
        const spec = state.selectedSpec;
        // Only render when on spec landing (class+spec selected, no phase, no PvP).
        if (!cls || !spec || state.selectedPhase != null || state.isPvP) {
            el.classList.add('hidden');
            el.innerHTML = '';
            return;
        }
        const abbrev   = SPEC_ABBREV[`${cls}-${spec}`];
        const specFull = abbrev ? `${spec} ${cls} (${abbrev})` : `${spec} ${cls}`;
        const role     = SPEC_ROLES[spec] || '';
        const phaseLis = [0, 1, 2, 3, 4, 5].map(p => {
            const slug = PHASE_TO_SLUG[p];
            const href = `/${toSlug(cls)}/${toSlug(spec)}/${slug}`;
            const phLabel = p === 0 ? 'Pre-Raid BiS' : `${PHASE_NAMES[p].label} BiS`;
            const raid = {
                0: 'Pre-Raid dungeons and heroics',
                1: "Karazhan, Gruul's Lair, and Magtheridon's Lair",
                2: 'Serpentshrine Cavern and Tempest Keep',
                3: 'Black Temple and Mount Hyjal',
                4: "Zul'Aman and Badge of Justice gear",
                5: 'Sunwell Plateau'
            }[p];
            return `<li><a href="${href}"><strong>${escapeHtmlText(phLabel)}</strong></a> — ${escapeHtmlText(raid)}</li>`;
        }).join('');
        const otherSpecs = (CLASS_META[cls] ? CLASS_META[cls].specs : [])
            .filter(s => s !== spec)
            .map(s => {
                const a = SPEC_ABBREV[`${cls}-${s}`];
                const label = a ? `${s} (${a})` : s;
                return `<a href="/${toSlug(cls)}/${toSlug(s)}">${escapeHtmlText(label)}</a>`;
            }).join(' · ');
        el.innerHTML = `<h2>${escapeHtmlText(specFull)} BiS for TBC Classic</h2>
            <p>Best in Slot gear lists for <strong>${escapeHtmlText(specFull)}</strong>${role ? ` (${escapeHtmlText(role)})` : ''} in TBC Classic. Choose a phase below for the full gear list with enchants, gems, stat priority, and item sources.</p>
            <h3>Phase guides</h3>
            <ul>${phaseLis}</ul>
            ${otherSpecs ? `<h3>Other ${escapeHtmlText(cls)} specs</h3><p>${otherSpecs}</p>` : ''}`;
        el.classList.remove('hidden');
    }

    // ─── DOM refs ────────────────────────────────────────────────────
    const $ = id => document.getElementById(id);
    const stepClass = $('stepClass');
    const stepSpec = $('stepSpec');
    const stepPhase = $('stepPhase');
    const stepBis = $('stepBis');
    const headerTitle = $('headerTitle');
    const headerSub = $('headerSub');
    const backBtn = $('backBtn');
    const specGrid = $('specGrid');
    const phaseTabs = $('phaseTabs');
    const phaseSwitcher = $('phaseSwitcher');
    const shareBuildBar = $('shareBuildBar');
    const shareBuildBtn = $('shareBuildBtn');
    const shareResetBtn = $('shareResetBtn');
    const shareToast    = $('shareToast');
    const slotList = $('slotList');
    const gsSummary = $('gsSummary');
    const professionFilter = $('professionFilter');
    const modalOverlay = $('modalOverlay');
    const modalTitle = $('modalTitle');
    const modalBody = $('modalBody');
    const modalClose = $('modalClose');

    // ─── Context Hints ───────────────────────────────────────────────
    // Dismissible hint banners — each has a unique key stored in localStorage.
    const DISMISSED_KEY = 'tbc-bis-dismissed-hints';
    const _dismissed = new Set(
        JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]')
    );

    function dismissHint(key) {
        _dismissed.add(key);
        localStorage.setItem(DISMISSED_KEY, JSON.stringify([..._dismissed]));
        const el = document.querySelector(`.ctx-hint[data-hint="${key}"]`);
        if (el) { el.style.opacity = '0'; setTimeout(() => el.remove(), 200); }
    }

    /**
     * Returns an HTML string for a hint banner.
     * @param {string} key   – unique id (for dismiss persistence)
     * @param {string} icon  – emoji
     * @param {string} html  – body HTML (can include <strong>)
     */
    function hintHtml(key, icon, html) {
        if (_dismissed.has(key)) return '';
        return `<div class="ctx-hint" data-hint="${key}">
            <span class="ctx-hint-icon">${icon}</span>
            <div class="ctx-hint-body">${html}</div>
            <button class="ctx-hint-dismiss" data-dismiss="${key}" aria-label="Dismiss">✕</button>
        </div>`;
    }

    /** Attach dismiss listeners to any new hint buttons in a container */
    function bindHintDismiss(container) {
        (container || document).querySelectorAll('.ctx-hint-dismiss[data-dismiss]').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                dismissHint(btn.dataset.dismiss);
            });
        });
    }

    // ─── Wowhead helper ──────────────────────────────────────────────
    const WH = 'tbc';
    const WH_ICON_CDN = 'https://wow.zamimg.com/images/wow/icons';

    // Mapping from wowsims negative IDs (random enchant suffix items) → Wowhead base item IDs
    // Used for icon lookup and Wowhead tooltip links since Wowhead doesn't know negative IDs.
    const NEGATIVE_ID_TO_WOWHEAD = {
        '-5':  30680,  // Glider's Foot-Wraps of Shadow Wrath
        '-9':  30675,  // Lurker's Cord of Shadow Wrath
        '-14': 30684,  // Ravager's Cuffs of Shadow Wrath
        '-16': 25295,  // Flawless Wand of Shadow Wrath
        '-18': 31201,  // Illidari Cloak of Shadow Wrath
        '-19': 24692,  // Elementalist Bracelets of Shadow Wrath
        '-20': 25043,  // Amber Cape of Shadow Wrath
        '-21': 24688,  // Elementalist Gloves of Shadow Wrath
        '-22': 31166,  // Nethersteel-Lined Handwraps of Shadow Wrath
    };

    // Shadow power bonus from each "of Shadow Wrath" random enchant item (verified on Wowhead TBC)
    const RANDOM_ENCHANT_SHADOW_POWER = {
        '-5':  78,   // Glider's Foot-Wraps of Shadow Wrath
        '-9':  78,   // Lurker's Cord of Shadow Wrath
        '-14': 58,   // Ravager's Cuffs of Shadow Wrath
        '-16': 25,   // Flawless Wand of Shadow Wrath
        '-18': 47,   // Illidari Cloak of Shadow Wrath
        '-19': 45,   // Elementalist Bracelets of Shadow Wrath
        '-20': 45,   // Amber Cape of Shadow Wrath
        '-21': 60,   // Elementalist Gloves of Shadow Wrath
        '-22': 62,   // Nethersteel-Lined Handwraps of Shadow Wrath
    };

    // Returns the positive Wowhead item ID for an item — maps negative wowsims IDs to base items.
    function toWhId(id) {
        const n = Number(id);
        return (n < 0 && NEGATIVE_ID_TO_WOWHEAD[String(n)]) || n;
    }

    function whItem(id, text, cls) {
        // Use mapped Wowhead ID for the tooltip/href, but keep original id in data-wh-item
        // so the modal click handler can find the item in phase data (which uses negative IDs).
        const whId = toWhId(id);
        return `<a href="https://www.wowhead.com/${WH}/item=${whId}" data-wowhead="item=${whId}&domain=${WH}" data-wh-item="${id}" class="${cls||''}">${text}</a>`;
    }

    function whSpell(id, text, enchSrcData) {
        const dataExtra = enchSrcData ? ` data-ench-src='${JSON.stringify(enchSrcData).replace(/'/g,"&#39;")}'` : '';
        return `<a href="https://www.wowhead.com/${WH}/spell=${id}" data-wowhead="spell=${id}&domain=${WH}" data-wh-spell="${id}"${dataExtra}>${text}</a>`;
    }

    function refreshWH() {
        if (window.$WowheadPower && window.$WowheadPower.refreshLinks) {
            setTimeout(() => window.$WowheadPower.refreshLinks(), 150);
        }
    }

    // ─── Item Notes helper ───────────────────────────────────────────
    function getNote(itemId) {
        if (typeof ITEM_NOTES === 'undefined' || !ITEM_NOTES.isLoaded()) return '';
        const specKey = `${state.selectedClass}-${state.selectedSpec}`;
        const note = ITEM_NOTES.get(itemId, specKey);
        if (!note) return '';
        return `<div class="item-note"><span class="item-note-icon">💬</span>${note}</div>`;
    }

    // ─── Icon helpers ────────────────────────────────────────────────
    function itemIcon(itemId, size, cssClass, altText) {
        size = size || 'medium';    // tiny|small|medium|large
        cssClass = cssClass || '';
        // For wowsims negative IDs (random enchant suffix items), use the base Wowhead item ID
        const whId = toWhId(itemId);
        const iconName = (typeof ICONS !== 'undefined' && ICONS[whId]) || 'inv_misc_questionmark';
        // Alt text: descriptive when provided (improves accessibility + image-search SEO).
        // Escape quotes since this goes inside attribute context.
        const altAttr = altText ? String(altText).replace(/"/g, '&quot;') : '';
        const img = `<img src="${WH_ICON_CDN}/${size}/${iconName}.jpg" alt="${altAttr}" class="${cssClass}" loading="lazy" onerror="this.src='${WH_ICON_CDN}/${size}/inv_misc_questionmark.jpg'">`;
        // Intercept click → open modal, keep data-wowhead for hover tooltip (link to base item on Wowhead)
        return `<a href="https://www.wowhead.com/${WH}/item=${whId}" data-wowhead="item=${whId}&domain=${WH}" data-wh-item="${itemId}" class="icon-link">${img}</a>`;
    }

    // Spec icons mapping (Wowhead CDN icon names)
    const SPEC_ICON_MAP = {
        // Warrior
        'Warrior-Arms':          'ability_rogue_eviscerate',
        'Warrior-Fury':          'ability_warrior_innerrage',
        'Warrior-Protection':    'ability_warrior_defensivestance',
        // Paladin
        'Paladin-Holy':          'spell_holy_holybolt',
        'Paladin-Protection':    'spell_holy_devotionaura',
        'Paladin-Retribution':   'spell_holy_auraoflight',
        // Hunter
        'Hunter-Beast Mastery':  'ability_hunter_beasttaming',
        'Hunter-Marksmanship':   'ability_marksmanship',
        'Hunter-Survival':       'ability_hunter_swiftstrike',
        // Rogue
        'Rogue-Dps':             'ability_backstab',
        'Rogue-Assassination':   'ability_rogue_eviscerate',
        'Rogue-Subtlety':        'ability_stealth',
        'Rogue-Combat':          'ability_backstab',
        // Priest
        'Priest-Holy':           'spell_holy_guardianspirit',
        'Priest-Shadow':         'spell_shadow_shadowwordpain',
        'Priest-Discipline':     'spell_holy_powerwordshield',
        // Shaman
        'Shaman-Elemental':      'spell_nature_lightning',
        'Shaman-Enhancement':    'spell_nature_lightningshield',
        'Shaman-Restoration':    'spell_nature_magicimmunity',
        // Mage
        'Mage-Arcane':           'spell_holy_magicalsentry',
        'Mage-Fire':             'spell_fire_firebolt02',
        'Mage-Frost':            'spell_frost_frostbolt02',
        // Warlock
        'Warlock-Affliction':    'spell_shadow_deathcoil',
        'Warlock-Demonology':    'spell_shadow_metamorphosis',
        'Warlock-Destruction':   'spell_shadow_rainoffire',
        // Druid
        'Druid-Balance':         'spell_nature_starfall',
        'Druid-Bear':            'ability_racial_bearform',
        'Druid-Cat':             'ability_druid_catform',
        'Druid-Restoration':     'spell_nature_healingtouch',
        'Druid-Feral Combat':    'ability_druid_catform',
    };

    // PvP spec icons
    const PVP_ICON_MAP = {
        Warrior: 'inv_sword_48',
        Paladin: 'spell_holy_auraoflight',
        Hunter:  'ability_marksmanship',
        Rogue:   'ability_stealth',
        Priest:  'spell_shadow_shadowwordpain',
        Shaman:  'spell_nature_lightning',
        Mage:    'spell_frost_frostbolt02',
        Warlock: 'spell_shadow_deathcoil',
        Druid:   'spell_nature_healingtouch',
    };

    function specIcon(cls, spec) {
        const key = `${cls}-${spec}`;
        const icon = SPEC_ICON_MAP[key] || 'inv_misc_questionmark';
        return `<img src="${WH_ICON_CDN}/medium/${icon}.jpg" alt="${spec}" loading="lazy">`;
    }

    function pvpSpecIcon(cls) {
        const icon = PVP_ICON_MAP[cls] || 'inv_misc_questionmark';
        return `<img src="${WH_ICON_CDN}/medium/${icon}.jpg" alt="PvP" loading="lazy">`;
    }

    // Slot fallback icons (when no item icon available)
    const SLOT_ICON_NAMES = {
        Head:           'inv_helmet_04',
        Neck:           'inv_jewelry_necklace_07',
        Shoulder:       'inv_shoulder_02',
        Back:           'inv_misc_cape_11',
        Chest:          'inv_chest_chain_13',
        Wrist:          'inv_bracer_13',
        Hands:          'inv_gauntlets_24',
        Waist:          'inv_belt_24',
        Legs:           'inv_pants_04',
        Feet:           'inv_boots_05',
        Ring:           'inv_jewelry_ring_27',
        Trinket:        'inv_trinket_naxxramas04',
        'Main Hand':    'inv_sword_04',
        'Off Hand':     'inv_shield_04',
        'Two Hand':     'inv_sword_27',
        'Ranged/Relic': 'inv_wand_01',
    };

    // ─── Class config ────────────────────────────────────────────────
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

    // Build slug ↔ class/spec maps now that CLASS_META is defined
    buildSlugMaps();

    // Legacy fallback PvP spec map (used when PVP_DATA not available)
    const PVP_SPEC_MAP_FALLBACK = {
        Warrior:  { pveSpec: 'Arms',          label: 'Arms PvP' },
        Paladin:  { pveSpec: 'Retribution',   label: 'Ret / Holy PvP' },
        Hunter:   { pveSpec: 'Marksmanship',  label: 'MM / Survival PvP' },
        Rogue:    { pveSpec: 'Combat',        label: 'Subtlety PvP' },
        Priest:   { pveSpec: 'Shadow',        label: 'Shadow / Disc PvP' },
        Shaman:   { pveSpec: 'Elemental',     label: 'Ele / Resto PvP' },
        Mage:     { pveSpec: 'Frost',         label: 'Frost PvP' },
        Warlock:  { pveSpec: 'Affliction',    label: 'SL/SL PvP' },
        Druid:    { pveSpec: 'Restoration',   label: 'Resto / Feral PvP' }
    };

    // ─── Build PvP spec list from scraped data ──────────────────────
    // Groups scraped specs by WoW class, producing per-class arrays
    // e.g. { Warrior: [{key:'Warrior|Arms', spec:'Arms', ...}], ... }
    // Tank specs make no sense in arena PvP — hide them
    const PVP_SKIP_SPECS = new Set(['Warrior|Protection', 'Paladin|Protection']);

    function buildPvpSpecs() {
        if (typeof PVP_DATA === 'undefined' || !PVP_DATA.specs) return {};
        const map = {};
        for (const [key, data] of Object.entries(PVP_DATA.specs)) {
            if (PVP_SKIP_SPECS.has(key)) continue;
            const cls = data.class;
            if (!map[cls]) map[cls] = [];
            map[cls].push({
                key,
                spec: data.spec,
                playerCount: data.playerCount,
                ratingRange: data.ratingRange,
            });
        }
        // Sort each class's specs by player count descending
        for (const cls in map) map[cls].sort((a, b) => b.playerCount - a.playerCount);
        return map;
    }
    const PVP_SPECS_BY_CLASS = buildPvpSpecs();

    // For backwards compat — pick the most popular PvP spec per class
    const PVP_SPEC_MAP = {};
    for (const [cls, specs] of Object.entries(PVP_SPECS_BY_CLASS)) {
        const top = specs[0];
        PVP_SPEC_MAP[cls] = { pvpSpec: top.spec, label: `${top.spec} PvP`, key: top.key };
    }
    // Fill in from fallback for classes not in scraped data
    for (const [cls, fb] of Object.entries(PVP_SPEC_MAP_FALLBACK)) {
        if (!PVP_SPEC_MAP[cls]) PVP_SPEC_MAP[cls] = fb;
    }

    // ─── PvP slot name mapping (scraped uses different names) ───────
    const PVP_SLOT_MAP = {
        'Head': 'Head', 'Neck': 'Neck', 'Shoulders': 'Shoulder',
        'Back': 'Back', 'Chest': 'Chest', 'Wrist': 'Wrist',
        'Hands': 'Hands', 'Waist': 'Waist', 'Legs': 'Legs',
        'Feet': 'Feet', 'Ring': 'Ring', 'Trinket': 'Trinket',
        'Main Hand': 'Main Hand', 'Off Hand': 'Off Hand',
        'Two Hand': 'Two Hand', 'Ranged': 'Ranged/Relic',
    };

    // ─── PvP tier config ────────────────────────────────────────────
    const PVP_TIER_META = {
        gold:   { badge: '🥇', label: 'Gold',   cls: 'pvp-tier-gold' },
        strong: { badge: '🥈', label: 'Strong', cls: 'pvp-tier-strong' },
        viable: { badge: '🥉', label: 'Viable', cls: 'pvp-tier-viable' },
        niche:  { badge: '',   label: 'Niche',  cls: 'pvp-tier-niche' },
    };

    // ─── PvP→PvE spec name mapping ──────────────────────────────────
    // Maps scraped PvP spec names to PvE DATA spec names for phase data
    const PVP_TO_PVE_SPEC = {
        'Druid|Feral Combat':   'Cat',
        // All others match directly (Arms→Arms, Frost→Frost, etc.)
    };

    const SPEC_ROLES = {
        Arms: 'Melee DPS', Fury: 'Melee DPS', Protection: 'Tank',
        Holy: 'Healer', Retribution: 'Melee DPS', Discipline: 'Healer',
        'Beast Mastery': 'Ranged DPS', Marksmanship: 'Ranged DPS', Survival: 'Ranged DPS',
        Combat: 'Melee DPS', Assassination: 'Melee DPS', Subtlety: 'Melee DPS',
        Dps: 'Melee DPS', Shadow: 'Ranged DPS',
        Elemental: 'Ranged DPS', Enhancement: 'Melee DPS', Restoration: 'Healer',
        Arcane: 'Ranged DPS', Fire: 'Ranged DPS', Frost: 'Ranged DPS',
        Affliction: 'Ranged DPS', Demonology: 'Ranged DPS', Destruction: 'Ranged DPS',
        Balance: 'Ranged DPS', Bear: 'Tank', Cat: 'Melee DPS'
    };

    const PHASE_NAMES = {
        0: { num: 'P0', label: 'Pre-BiS', desc: 'Dungeons & Quests' },
        1: { num: 'P1', label: 'Phase 1', desc: 'Kara · Gruul · Mag' },
        2: { num: 'P2', label: 'Phase 2', desc: 'SSC · TK' },
        3: { num: 'P3', label: 'Phase 3', desc: 'BT · Hyjal' },
        4: { num: 'P4', label: 'Phase 4', desc: 'ZA · Badge' },
        5: { num: 'P5', label: 'Phase 5', desc: 'Sunwell' }
    };

    const SLOT_ORDER = [
        'Head', 'Neck', 'Shoulder', 'Back', 'Chest', 'Wrist',
        'Hands', 'Waist', 'Legs', 'Feet',
        'Rings', 'Trinkets',
        'Main Hand', 'Off Hand', 'Two Hand', 'Ranged/Relic'
    ];

    // ─── Weapon style per spec ──────────────────────────────────────
    // 'dw'   = only show MH/OH (Fury, Rogue, Enh Shaman, Prot Warrior, Prot Pala, Holy Pala)
    // '2h'   = only show Two Hand (Bear, Cat, Ret Pala)
    // 'both' = show both sections (Arms Warrior, casters with both options, etc.)
    // If not listed → auto-detect from data
    const WEAPON_STYLE = {
        'Warrior-Fury':         'both',   // DW is BiS but user can toggle to 2H
        'Warrior-Protection':   'dw',
        'Rogue-Combat':            'dw',
        'Rogue-Assassination':    'dw',
        'Rogue-Subtlety':         'dw',
        'Shaman-Enhancement':   'dw',
        'Paladin-Holy':         'dw',
        'Paladin-Protection':   'dw',
        'Druid-Bear':           '2h',
        'Druid-Cat':            '2h',
        'Paladin-Retribution':  '2h',
        'Warrior-Arms':         'both',
        'Priest-Shadow':        'both',   // Staff (2H) or MH+OH
        'Mage-Fire':            'both',   // Staff or MH+OH
        'Mage-Frost':           'both',
        'Mage-Arcane':          'both',
        'Warlock-Destruction':  'both',
        'Warlock-Affliction':   'both',
        'Warlock-Demonology':   'both',
        'Druid-Balance':        'both',
        'Shaman-Elemental':     'both',
        'Priest-Holy':          'both',   // Staff or MH+OH
        'Priest-Discipline':    'both',   // Staff or MH+OH
        'Shaman-Restoration':   'both',   // MH+Shield or Staff
        'Druid-Restoration':    'both',   // Staff or MH+OH
        'Hunter-Beast Mastery':  'both',   // DW or 2H
        'Hunter-Marksmanship':  'both',
        'Hunter-Survival':      'both',
    };

    // Specs där user kan toggla mellan DW och 2H
    const WEAPON_TOGGLE_SPECS = new Set([
        'Warrior-Fury', 'Warrior-Arms', 'Priest-Shadow',
        'Mage-Fire', 'Mage-Frost', 'Mage-Arcane',
        'Warlock-Destruction', 'Warlock-Affliction', 'Warlock-Demonology',
        'Druid-Balance', 'Shaman-Elemental',
        'Priest-Holy', 'Priest-Discipline', 'Shaman-Restoration', 'Druid-Restoration',
        'Hunter-Beast Mastery', 'Hunter-Marksmanship', 'Hunter-Survival',
    ]);

    // weaponMode: per selectionKey() → 'dw' | '2h'
    // Automatically derived from the BiS item in the current phase/spec.
    // If the #1 BIS item is a Two Hand → '2h'; otherwise → 'dw'.
    // User can override per spec+phase; override is persisted in localStorage.
    const WEAPON_MODE_DEFAULT = {
        'Paladin-Retribution': '2h',
        'Warrior-Arms':        '2h',
    };
    const weaponModeState = {};

    /**
     * Return the effective weapon mode for the current spec+phase.
     * If the user has explicitly chosen a mode it wins; otherwise auto-detect
     * from slotGroups (the #1 ranked weapon in this phase).
     * @param {object} [slotGroups] - current slot groups (used for auto-detect)
     */
    function getWeaponMode(slotGroups) {
        const key = selectionKey();
        if (key in weaponModeState) return weaponModeState[key];
        // Specs with a fixed default bypass auto-detect
        const specKey = `${state.selectedClass}-${state.selectedSpec}`;
        if (WEAPON_MODE_DEFAULT[specKey]) {
            // Only use default if the preferred mode has items available
            const pref = WEAPON_MODE_DEFAULT[specKey];
            if (slotGroups) {
                const has2HItems = slotGroups['Two Hand']?.length > 0;
                const hasDWItems = (slotGroups['Main Hand']?.length > 0) || (slotGroups['Off Hand']?.length > 0);
                if (pref === '2h' && !has2HItems && hasDWItems) return 'dw';
                if (pref === 'dw' && !hasDWItems && has2HItems) return '2h';
            }
            return pref;
        }
        if (slotGroups) {
            const twoHanders = slotGroups['Two Hand'];
            const mainHanders = slotGroups['Main Hand'];
            const offHanders = slotGroups['Off Hand'];
            const weapons = slotGroups['Weapon'];
            // If top MH and top OH are the same item, check if it's a 2H weapon or dual-wielded
            const topMH = mainHanders && mainHanders.length ? mainHanders[0] : null;
            const topOH = offHanders && offHanders.length ? offHanders[0] : null;
            if (topMH && topOH && String(topMH.itemId) === String(topOH.itemId)) {
                // Only treat as 2H if the item is also in the Two Hand list
                if (twoHanders && twoHanders.some(i => String(i.itemId) === String(topMH.itemId))) return '2h';
                // Otherwise it's a "Main Hand~Off Hand" weapon dual-wielded
                // But still compare rank with Two Hand BIS before deciding
            }
            // If top MH matches a Weapon/Two Hand entry, it's a 2H
            if (topMH && weapons && weapons.some(i => String(i.itemId) === String(topMH.itemId))) return '2h';
            if (twoHanders && twoHanders.length) {
                if (!topMH) return '2h';
                const rankOrder = { 'BIS': 0, 'Pre-BIS': 1, 'Alt': 2 };
                const r2h = rankOrder[twoHanders[0].rank] ?? 99;
                const rmh = rankOrder[topMH.rank] ?? 99;
                if (r2h < rmh) return '2h';
                if (twoHanders.some(i => String(i.itemId) === String(topMH.itemId))) return '2h';
                return 'dw';
            }
        }
        return 'dw';
    }
    function setWeaponMode(mode) {
        weaponModeState[selectionKey()] = mode;
        try { localStorage.setItem('tbc-bis-weapon-mode', JSON.stringify(weaponModeState)); } catch(_) {}
    }
    // Load persisted weapon modes
    try {
        const wm = localStorage.getItem('tbc-bis-weapon-mode');
        if (wm) Object.assign(weaponModeState, JSON.parse(wm));
    } catch(_) {}

    // ─── PvP gear overrides per class/phase ──────────────────────────
    const PVP_ITEMS = {
        Warrior: {
            0: [
                { itemId:'24544', slot:'Chest',     rank:'PvP BIS', name:"Gladiator's Plate Chestpiece" },
                { itemId:'24545', slot:'Head',       rank:'PvP BIS', name:"Gladiator's Plate Helm" },
                { itemId:'24546', slot:'Shoulder',   rank:'PvP BIS', name:"Gladiator's Plate Shoulders" },
                { itemId:'24547', slot:'Legs',       rank:'PvP BIS', name:"Gladiator's Plate Legguards" },
                { itemId:'28995', slot:'Waist',      rank:'PvP BIS', name:"Marshal's Plate Belt" },
                { itemId:'28996', slot:'Wrist',      rank:'PvP BIS', name:"Marshal's Plate Bracers" },
                { itemId:'28997', slot:'Feet',       rank:'PvP BIS', name:"Marshal's Plate Greaves" },
                { itemId:'28295', slot:'Main Hand',  rank:'PvP BIS', name:"Gladiator's Slicer" },
                { itemId:'28307', slot:'Off Hand',   rank:'PvP BIS', name:"Gladiator's Quickblade" },
                { itemId:'24550', slot:'Two Hand',   rank:'PvP BIS', name:"Gladiator's Greatsword" },
                { itemId:'28244', slot:'Neck',       rank:'PvP BIS', name:"Pendant of Triumph" },
                { itemId:'28246', slot:'Ring',       rank:'PvP BIS', name:"Band of Triumph" },
                { itemId:'28358', slot:'Off Hand',   rank:'PvP Alt', name:"Gladiator's Shield Wall" },
            ],
            2: [
                { itemId:'30486', slot:'Chest',     rank:'PvP BIS', name:"Merciless Gladiator's Plate Chestpiece" },
                { itemId:'30488', slot:'Head',       rank:'PvP BIS', name:"Merciless Gladiator's Plate Helm" },
                { itemId:'30490', slot:'Shoulder',   rank:'PvP BIS', name:"Merciless Gladiator's Plate Shoulders" },
                { itemId:'30489', slot:'Legs',       rank:'PvP BIS', name:"Merciless Gladiator's Plate Legguards" },
                { itemId:'32052', slot:'Main Hand',  rank:'PvP BIS', name:"Merciless Gladiator's Slicer" },
                { itemId:'32027', slot:'Off Hand',   rank:'PvP BIS', name:"Merciless Gladiator's Quickblade" },
            ],
            3: [
                { itemId:'33730', slot:'Head',       rank:'PvP BIS', name:"Vengeful Gladiator's Plate Helm" },
                { itemId:'33728', slot:'Chest',     rank:'PvP BIS', name:"Vengeful Gladiator's Plate Chestpiece" },
                { itemId:'33732', slot:'Shoulder',   rank:'PvP BIS', name:"Vengeful Gladiator's Plate Shoulders" },
                { itemId:'33731', slot:'Legs',       rank:'PvP BIS', name:"Vengeful Gladiator's Plate Legguards" },
                { itemId:'33762', slot:'Main Hand',  rank:'PvP BIS', name:"Vengeful Gladiator's Slicer" },
            ],
            5: [
                { itemId:'35068', slot:'Head',       rank:'PvP BIS', name:"Brutal Gladiator's Plate Helm" },
                { itemId:'35066', slot:'Chest',     rank:'PvP BIS', name:"Brutal Gladiator's Plate Chestpiece" },
                { itemId:'35070', slot:'Shoulder',   rank:'PvP BIS', name:"Brutal Gladiator's Plate Shoulders" },
                { itemId:'35069', slot:'Legs',       rank:'PvP BIS', name:"Brutal Gladiator's Plate Legguards" },
                { itemId:'35101', slot:'Main Hand',  rank:'PvP BIS', name:"Brutal Gladiator's Slicer" },
                { itemId:'35072', slot:'Off Hand',   rank:'PvP BIS', name:"Brutal Gladiator's Quickblade" },
            ],
        },
        Rogue: {
            0: [
                { itemId:'24553', slot:'Head',       rank:'PvP BIS', name:"Gladiator's Leather Helm" },
                { itemId:'24554', slot:'Shoulder',   rank:'PvP BIS', name:"Gladiator's Leather Spaulders" },
                { itemId:'24552', slot:'Chest',     rank:'PvP BIS', name:"Gladiator's Leather Tunic" },
                { itemId:'24555', slot:'Legs',       rank:'PvP BIS', name:"Gladiator's Leather Legguards" },
                { itemId:'28312', slot:'Main Hand',  rank:'PvP BIS', name:"Gladiator's Shanker" },
                { itemId:'28310', slot:'Off Hand',   rank:'PvP BIS', name:"Gladiator's Shiv" },
            ],
        },
        Mage: {
            0: [
                { itemId:'24549', slot:'Head',       rank:'PvP BIS', name:"Gladiator's Silk Cowl" },
                { itemId:'28941', slot:'Off Hand',   rank:'PvP BIS', name:"Grand Marshal's Battletome" },
                { itemId:'28297', slot:'Main Hand',  rank:'PvP BIS', name:"Gladiator's Spellblade" },
            ],
        },
        Warlock: {
            0: [
                { itemId:'24556', slot:'Head',       rank:'PvP BIS', name:"Gladiator's Dreadweave Hood" },
                { itemId:'28297', slot:'Main Hand',  rank:'PvP BIS', name:"Gladiator's Spellblade" },
            ],
        },
        Priest: {
            0: [
                { itemId:'24543', slot:'Head',       rank:'PvP BIS', name:"Gladiator's Satin Hood" },
                { itemId:'28297', slot:'Main Hand',  rank:'PvP BIS', name:"Gladiator's Spellblade" },
            ],
        },
    };

    // ─── Data helpers ────────────────────────────────────────────────
    function findSpec(cls, spec) {
        let result = DATA.specs.find(s => s.className === cls && s.specName === spec);
        if (!result) {
            // Fallback: new spec names → old manual data spec names
            const fb = MANUAL_SPEC_FALLBACK[`${cls}|${spec}`];
            if (fb) {
                const [fbCls, fbSpec] = fb.split('|');
                result = DATA.specs.find(s => s.className === fbCls && s.specName === fbSpec);
            }
        }
        return result;
    }
    function getItemSource(id) { return DATA.itemSources[id] || null; }
    function getGemSource(id)  { return DATA.gemSources[id] || null; }
    function getEnchantSource(id) { return DATA.enchantSources[id] || null; }

    // ── Profession helpers ───────────────────────────────────────────
    // Normalise "Tailoring (375)" → "Tailoring"
    function extractProfession(sourceStr) {
        if (!sourceStr) return null;
        return sourceStr.replace(/\s*\(\d+\)\s*/g, '').trim();
    }

    // BoP crafted items that REQUIRE the profession to equip.
    // BoE crafts (Wolfshead Helm, Spellstrike, Belt of Blasting, etc.) are NOT filtered.
    const PROFESSION_REQUIRED_ITEMS = new Set([
        // Alchemy — stones are BoP
        13503, 35750,
        // Blacksmithing — all 375 BS weapons & shields are BoP
        28429, 28430, 28432, 28433, 28435, 28438, 28439, 28441, 28442, 28484, 28485,
        // Tailoring sets — Spellfire, Frozen Shadoweave, Primal Mooncloth (all BoP)
        21846, 21847, 21848, 21869, 21870, 21871, 21873, 21874, 21875,
        // Leatherworking sets — Ebon Netherscale, Netherstrike, Windhawk, Primalstrike (all BoP)
        29515, 29516, 29517, 29519, 29520, 29521, 29522, 29523, 29524, 29525, 29526, 29527,
        // Engineering — all goggles + Gyro-Balanced Khorium Destroyer + Goblin Rocket Launcher
        32461, 32472, 32473, 32474, 32475, 32476, 32478, 32479, 32480, 32494, 32495,
        34353, 34354, 34356, 34357, 34847, 35181, 35182, 35185, 32756, 23836,
        // Jewelcrafting — figurines (BoP trinkets)
        24128, 35700, 35702,
    ]);

    // Returns the profession name if this item requires that profession to EQUIP, else null.
    // Only BoP crafted items are filtered — BoE crafts (usable by anyone) are not.
    function itemProfession(itemId) {
        const id = Number(itemId);
        if (!PROFESSION_REQUIRED_ITEMS.has(id)) return null;
        const src = getItemSource(itemId);
        if (!src || src.sourceType !== 'Profession') return null;
        return extractProfession(src.source);
    }

    // Check if item should be hidden based on current profession exclusions
    function isItemExcluded(itemId) {
        if (!state.excludedProfessions.size) return false;
        const prof = itemProfession(itemId);
        return prof && state.excludedProfessions.has(prof);
    }

    // Outdoor world bosses in TBC — items from these sources can be optionally hidden
    const WORLD_BOSS_SOURCES = new Set([
        'Doom Lord Kazzak',
        'Doomwalker',
        'Lord Kazzak',
        'World Drop',
    ]);

    function isItemWorldBoss(itemId) {
        const src = getItemSource(itemId);
        if (!src) return false;
        return WORLD_BOSS_SOURCES.has(src.source);
    }

    // Rating-gated PvP items: ALL Gladiator-season weapons & shoulders require
    // an arena rating to purchase (S1 plain Gladiator included).
    // Grand Marshal / High Warlord are vanilla rank items — not matched.
    const RATING_GATED_PREFIXES = /^(Merciless Gladiator|Vengeful Gladiator|Brutal Gladiator|Deadly Gladiator|Gladiator)'s\s/i;
    const RATING_GATED_SLOTS = new Set(['Main Hand', 'Off Hand', 'Two Hand', 'One Hand', 'Weapon', 'Shoulder', 'Shoulders']);

    function isItemRatingGated(itemId, itemName, itemSlot) {
        if (!itemName) {
            const src = DATA.itemSources[itemId];
            if (!src) return false;
            itemName = src.name || '';
        }
        // Only weapons and shoulders require a rating to purchase
        if (itemSlot && !RATING_GATED_SLOTS.has(itemSlot)) return false;
        return RATING_GATED_PREFIXES.test(itemName);
    }

    // Get the PvE spec name for the current PvP selection
    function getPveSpecForCurrentState() {
        if (!state.isPvP) return state.selectedSpec;
        const pvpKey = state.pvpKey || `${state.selectedClass}|${state.selectedSpec}`;
        if (PVP_TO_PVE_SPEC[pvpKey]) return PVP_TO_PVE_SPEC[pvpKey];
        return state.selectedSpec; // Most specs have same name in PvE
    }

    function qualityClass(itemId) {
        // Look up actual item quality from Wowhead data
        if (typeof ITEM_QUALITY !== 'undefined' && ITEM_QUALITY[itemId] !== undefined) {
            const q = ITEM_QUALITY[itemId];
            if (q >= 5) return 'q-legendary';
            if (q >= 4) return 'q-epic';
            if (q >= 3) return 'q-rare';
            if (q >= 2) return 'q-uncommon';
            return 'q-common';
        }
        return 'q-epic'; // fallback
    }

    // ─── Navigation ──────────────────────────────────────────────────
    function showStep(el) {
        [stepClass, stepSpec, stepPhase, stepBis, stepStaticPage].forEach(s => { if (s) s.classList.add('hidden'); });
        el.classList.remove('hidden');
        backBtn.classList.toggle('hidden', state.history.length === 0);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function goBack() {
        if (!state.history.length) return;
        const prev = state.history.pop();
        if (prev === 'class') {
            state.selectedClass = null; state.isPvP = false; state.pvpKey = null;
            headerTitle.textContent = 'TBC Best in Slot';
            headerTitle.style.color = '';
            headerSub.textContent = 'Choose your class';
            showStep(stepClass);
            replaceRoute();
            updateSeoMeta();
        } else if (prev === 'spec') {
            // If we came from PvP (skipped phase), reset PvP state
            state.selectedSpec = null; state.isPvP = false; state.pvpKey = null;
            state.selectedPhase = null;
            headerTitle.textContent = state.selectedClass;
            headerTitle.style.color = CLASS_META[state.selectedClass].color;
            headerSub.textContent = 'Choose your spec';
            showStep(stepSpec);
            replaceRoute();
            updateSeoMeta();
        } else if (prev === 'phase') {
            // Phase switcher is now inline — go back to spec select directly
            state.selectedPhase = null;
            state.selectedSpec = null;
            state.isPvP = false;
            state.pvpKey = null;
            // Also pop the 'spec' history entry since we're skipping phase step
            if (state.history.length && state.history[state.history.length - 1] === 'spec') {
                state.history.pop();
            }
            headerTitle.textContent = state.selectedClass;
            headerTitle.style.color = CLASS_META[state.selectedClass].color;
            headerSub.textContent = 'Choose your spec';
            showStep(stepSpec);
            replaceRoute();
            updateSeoMeta();
        }
    }
    backBtn.addEventListener('click', goBack);

    // ─── Home link (logo + title) ────────────────────────────────────
    const headerHomeLink = document.getElementById('headerHomeLink');
    if (headerHomeLink) {
        headerHomeLink.addEventListener('click', (e) => {
            e.preventDefault();
            state.selectedClass = null;
            state.selectedSpec  = null;
            state.selectedPhase = null;
            state.isPvP         = false;
            state.pvpKey        = null;
            state.history       = [];
            headerTitle.textContent = 'TBC Best in Slot';
            headerTitle.style.color = '';
            headerSub.textContent = 'Choose your class';
            if (stepStaticPage) stepStaticPage.classList.add('hidden');
            showStep(stepClass);
            history.pushState({}, '', '/');
            updateSeoMeta();
        });
    }

    // ─── Step 1: Class ───────────────────────────────────────────────
    document.querySelectorAll('.class-card').forEach(card => {
        card.addEventListener('click', (e) => {
            e.preventDefault();
            const cls = card.dataset.class;
            state.selectedClass = cls;
            headerTitle.textContent = cls;
            headerTitle.style.color = CLASS_META[cls].color;
            headerSub.textContent = 'Choose your spec';
            renderSpecGrid(cls);
            state.history.push('class');
            showStep(stepSpec);
            pushRoute();
            updateSeoMeta();
        });
    });

    // ─── Step 2: Spec (with PvP) ─────────────────────────────────────
    function renderSpecGrid(cls) {
        const meta = CLASS_META[cls];
        const pvpSpecs = PVP_SPECS_BY_CLASS[cls] || [];
        let html = '';

        // Context hint
        html += hintHtml('spec-pick', '💡',
            `Choose a <strong>PvE spec</strong> to see gear ranked by what the <strong>top WarcraftLogs parsers</strong> actually wear — per spec and phase.`
        );

        // PvE specs
        for (const spec of meta.specs) {
            const specSlug = toSlug(spec);
            html += `
                <a class="spec-card" href="/${toSlug(cls)}/${specSlug}" data-spec="${spec}" data-pvp="false">
                    <div class="spec-emoji">${specIcon(cls, spec)}</div>
                    <div class="spec-info">
                        <div class="spec-name" style="color:${meta.color}">${spec}</div>
                        <div class="spec-role">${SPEC_ROLES[spec] || 'DPS'} · PvE</div>
                    </div>
                    <div class="spec-arrow">▸</div>
                </a>`;
        }

        // PvP specs — show ALL specs from scraped data, with player counts
        if (pvpSpecs.length) {
            html += `<div class="pvp-divider"><span>⚔️ PvP Arena Specs</span></div>`;
            html += hintHtml('pvp-pick', '📡',
                `<strong>PvP specs</strong> are based on a <strong>live snapshot</strong> of what the highest-rated arena players are actually wearing right now — ` +
                `not theorycrafting. Data is refreshed regularly, so recommendations change as the meta shifts.`
            );
            for (const pvp of pvpSpecs) {
                const playerLabel = pvp.playerCount + ' top players analyzed';
                const ratingLabel = pvp.ratingRange
                    ? `${pvp.ratingRange.min}–${pvp.ratingRange.max} rating`
                    : '';
                html += `
                    <a class="spec-card is-pvp" href="/${toSlug(cls)}/${toSlug(pvp.spec)}/pvp" data-spec="${pvp.spec}" data-pvp="true" data-pvp-key="${pvp.key}">
                        <div class="spec-emoji">${pvpSpecIconForSpec(cls, pvp.spec)}</div>
                        <div class="spec-info">
                            <div class="spec-name" style="color:#c41e3a">${pvp.spec} PvP</div>
                            <div class="spec-role">${playerLabel}${ratingLabel ? ' · ' + ratingLabel : ''}</div>
                        </div>
                        <span class="spec-pvp-badge">PVP</span>
                        <div class="spec-arrow">▸</div>
                    </a>`;
            }
        } else {
            // Fallback: show single PvP entry from fallback map
            const fb = PVP_SPEC_MAP_FALLBACK[cls];
            if (fb) {
                html += `
                    <a class="spec-card is-pvp" href="/${toSlug(cls)}/${toSlug(fb.pveSpec)}/pvp" data-spec="${fb.pveSpec}" data-pvp="true">
                        <div class="spec-emoji">${pvpSpecIcon(cls)}</div>
                        <div class="spec-info">
                            <div class="spec-name" style="color:#c41e3a">${fb.label}</div>
                            <div class="spec-role">Arena & Battlegrounds</div>
                        </div>
                        <span class="spec-pvp-badge">PVP</span>
                        <div class="spec-arrow">▸</div>
                    </a>`;
            }
        }

        specGrid.innerHTML = html;
        bindHintDismiss(specGrid);

        specGrid.querySelectorAll('.spec-card').forEach(card => {
            card.addEventListener('click', (e) => {
                e.preventDefault();
                state.selectedSpec = card.dataset.spec;
                state.isPvP = card.dataset.pvp === 'true';
                state.pvpKey = card.dataset.pvpKey || null;
                const pvpTag = state.isPvP ? ' <span class="pvp-tag">PvP</span>' : '';
                const lbl = state.isPvP ? `${state.selectedSpec} PvP` : state.selectedSpec;
                headerTitle.innerHTML = `${cls} — ${lbl}${pvpTag}`;

                // PvP with scraped data → skip phase, go straight to BiS
                const hasPvpData = state.isPvP && state.pvpKey
                    && typeof PVP_DATA !== 'undefined' && PVP_DATA.specs?.[state.pvpKey];

                if (hasPvpData) {
                    state.selectedPhase = null; // no phase for PvP
                    const meta = PVP_DATA.meta || {};
                    const dateStr = meta.analyzedAt
                        ? new Date(meta.analyzedAt).toLocaleDateString('sv-SE')
                        : 'recently';
                    headerSub.textContent = `Live snapshot · Updated ${dateStr}`;
                    renderBisList();
                    state.history.push('spec');
                    showStep(stepBis);
                    pushRoute();
                    updateSeoMeta();
                } else {
                    headerSub.textContent = 'Choose phase';
                    renderPhaseGrid();
                    state.history.push('spec');
                    showStep(stepPhase);
                    pushRoute();
                    updateSeoMeta();
                }
            });
        });
    }

    // PvP spec icon — try to match scraped spec name to SPEC_ICON_MAP
    function pvpSpecIconForSpec(cls, spec) {
        // Try exact match first
        const key = `${cls}-${spec}`;
        const icon = SPEC_ICON_MAP[key] || PVP_ICON_MAP[cls] || 'inv_misc_questionmark';
        return `<img src="${WH_ICON_CDN}/medium/${icon}.jpg" alt="${spec}" loading="lazy">`;
    }

    // ─── Step 3: Phase ───────────────────────────────────────────────
    function renderPhaseGrid() {
        // In PvP mode, map spec name to PvE equivalent for phase data
        const pveSpec = getPveSpecForCurrentState();
        const specData = findSpec(state.selectedClass, pveSpec);
        const phases = specData ? Object.keys(specData.phases).sort() : [];

        let phaseHtml = hintHtml('phase-pick', '💡',
            `Each phase represents a <strong>content tier</strong>. ` +
            `<strong>P0</strong> is pre-raid gear from dungeons &amp; quests. ` +
            `Higher phases add raid drops. Pick the phase that matches your current progression.`
        );

        phaseHtml += phases.map(p => {
            const info = PHASE_NAMES[p] || { num: `P${p}`, label: `Phase ${p}`, desc: '' };
            const phSlug = PHASE_TO_SLUG[p] || `phase-${p}`;
            const phaseHref = `/${toSlug(state.selectedClass)}/${toSlug(state.selectedSpec)}/${phSlug}`;
            return `<a class="phase-btn" href="${phaseHref}" data-phase="${p}">
                <span class="phase-num">${info.num}</span>
                <span class="phase-label">${info.label}</span>
            </a>`;
        }).join('');

        phaseTabs.innerHTML = phaseHtml;
        bindHintDismiss(phaseTabs);

        phaseTabs.querySelectorAll('.phase-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                state.selectedPhase = parseInt(btn.dataset.phase);
                const info = PHASE_NAMES[state.selectedPhase] || { label: `Phase ${state.selectedPhase}`, desc: '' };
                const pvpTag = state.isPvP ? ' <span class="pvp-tag">PvP</span>' : '';
                const lbl = state.isPvP ? `${state.selectedSpec} PvP` : state.selectedSpec;
                headerTitle.innerHTML = `${lbl} — ${info.label}${pvpTag}`;
                headerSub.textContent = info.desc;
                renderBisList();
                state.history.push('phase');
                showStep(stepBis);
                pushRoute();
                updateSeoMeta();
            });
        });
    }

    // ─── Phase Switcher (inline tabs in BiS view) ────────────────────
    function renderPhaseSwitcher() {
        // Only show for PvE (PvP has no phases)
        if (state.isPvP) {
            phaseSwitcher.classList.add('hidden');
            return;
        }

        const pveSpec = getPveSpecForCurrentState();
        const specData = findSpec(state.selectedClass, pveSpec);
        if (!specData) { phaseSwitcher.classList.add('hidden'); return; }

        const phases = Object.keys(specData.phases).sort();
        if (phases.length <= 1) { phaseSwitcher.classList.add('hidden'); return; }

        phaseSwitcher.innerHTML = phases.map(p => {
            const info = PHASE_NAMES[p] || { num: `P${p}`, label: `Phase ${p}` };
            const isActive = parseInt(p) === state.selectedPhase;
            const phSlug = PHASE_TO_SLUG[p] || `phase-${p}`;
            const phaseHref = `/${toSlug(state.selectedClass)}/${toSlug(state.selectedSpec)}/${phSlug}`;
            return `<a class="ps-tab${isActive ? ' active' : ''}" href="${phaseHref}" data-phase="${p}">
                <span class="ps-num">${info.num}</span>
                <span class="ps-label">${info.label}</span>
            </a>`;
        }).join('');

        phaseSwitcher.classList.remove('hidden');

        phaseSwitcher.querySelectorAll('.ps-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                e.preventDefault();
                const newPhase = parseInt(tab.dataset.phase);
                if (newPhase === state.selectedPhase) return;

                state.selectedPhase = newPhase;
                const info = PHASE_NAMES[newPhase] || { label: `Phase ${newPhase}`, desc: '' };
                const pvpTag = state.isPvP ? ' <span class="pvp-tag">PvP</span>' : '';
                const lbl = state.isPvP ? `${state.selectedSpec} PvP` : state.selectedSpec;
                headerTitle.innerHTML = `${lbl} — ${info.label}${pvpTag}`;
                headerSub.textContent = info.desc;
                renderBisList();
                replaceRoute();
                updateSeoMeta();
            });
        });

        // Scroll active tab into view
        const activeTab = phaseSwitcher.querySelector('.ps-tab.active');
        if (activeTab) {
            activeTab.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
    }

    // ─── Gem overlay builder (set per render cycle) ──────────────────
    let _buildGemOverlay = () => '';

    // ─── Render a single slot group ──────────────────────────────────
    function renderSlotGroup(slot, slotGroups, enchantLookup, isPvPMode = false) {
        const si = slotGroups[slot];
        if (!si || !si.length) return '';

        // Display name: "Rings" → "Ring", "Trinkets" → "Trinket", "Ring 1" → "Ring" etc.
        // "Ranged/Relic" → class-appropriate label (Relic for Paladin/Shaman/Druid, Ranged for others)
        const RELIC_CLASSES = new Set(['Paladin', 'Shaman', 'Druid']);
        let slotDisplayName = slot === 'Rings' ? 'Ring' : slot === 'Trinkets' ? 'Trinket' : slot.replace(/ [12]$/, '');
        if (slotDisplayName === 'Ranged/Relic') {
            slotDisplayName = RELIC_CLASSES.has(state.selectedClass) ? 'Relic' : 'Ranged';
        }

        // ── Active item: user selection or BiS (index 0) ──
        const bis = getActiveItem(slot, si);
        const isOverridden = String(bis.itemId) !== String(si[0].itemId);
        const alts = si.filter(i => String(i.itemId) !== String(bis.itemId));

        const isPvPItem = bis.rank?.toLowerCase().includes('pvp');
        const isGuideItem = bis.rank === 'Guide';
        const badgeCls = isGuideItem ? 'guide' : isPvPItem ? 'bis' : (bis.rank.toLowerCase().startsWith('bis') ? 'bis' : 'alt');
        const badgeStyle = isPvPItem ? ' style="background:#c41e3a"' : '';

        // Source info
        const src = getItemSource(bis.itemId);
        const srcText = src ? `${srcEmoji(src.sourceType)} ${src.source || src.sourceType}` : '';

        // Enchant info — look up by both the full slot key and the base name
        const enchant = enchantLookup[slot] || enchantLookup[slotDisplayName];
        const enchSrc = enchant ? getEnchantSource(enchant.spellId) : null;
        const enchantHtml = enchSrc
            ? `<div class="slot-enchant">${whSpell(enchant.spellId, enchSrc.name, enchSrc)}</div>`
            : '';

        // "Cloned from MH" note for auto-generated OH
        const clonedNote = bis._clonedFromMH
            ? '<div class="slot-clone-note">Same options as Main Hand</div>'
            : '';

        // Quality class: use PvP data quality if available, else infer
        const bisQuality = pvpQualityClass(bis);

        // Gem sockets — show gem icons below item icon
        const gemOverlayHtml = _buildGemOverlay(slot, bis);
        const bisItemAlt = `${bis.name || 'Item #' + bis.itemId} — ${slot} BiS for ${state.selectedSpec} ${state.selectedClass}`;
        const bisIconHtml = `<div class="slot-icon-wrap">${itemIcon(bis.itemId, 'medium', bisQuality, bisItemAlt)}</div>${gemOverlayHtml}`;

        // PvP popularity meta
        const bisPvpHtml = pvpMetaHtml(bis);

        // WCL popularity meta
        const bisWclHtml = wclMetaHtml(bis);

        // Guide meta (Wowhead original rank)
        const bisGuideHtml = guideMetaHtml(bis);

        let html = `<div class="slot-group${isOverridden ? ' slot-overridden' : ''}" data-slot="${slot}">
            <div class="slot-header" data-item-id="${bis.itemId}">
                <div class="slot-icon">${bisIconHtml}</div>
                <div class="slot-content">
                    <h2 class="slot-name">${slotDisplayName}${isOverridden ? ' <span class="slot-custom-tag">Custom</span>' : ''}</h2>
                    <div class="slot-bis-item">
                        <div class="slot-bis-name ${bisQuality}">${whItem(bis.itemId, bis.name || 'Item #'+bis.itemId, bisQuality)}</div>
                    </div>
                    ${enchantHtml}
                    ${srcText ? `<div class="slot-source">${srcText}</div>` : ''}
                    ${bisPvpHtml}
                    ${bisWclHtml}
                    ${bisGuideHtml}
                    ${clonedNote}
                </div>
                <div class="slot-meta">
                    ${isOverridden ? `<button class="slot-reset-btn" data-slot="${slot}" title="Återställ till BiS">✕</button>` : `<span class="slot-badge ${badgeCls}"${badgeStyle}>${bis.rank}</span>`}
                    ${alts.length ? `<span class="slot-alt-count">+${alts.length}</span>` : ''}
                    ${alts.length ? '<span class="slot-expand">▾</span>' : ''}
                </div>
            </div>`;

        if (alts.length) {
            // In PvP mode: no selection UI — items are read-only
            const showSelectUI = !isPvPMode;

            html += '<div class="slot-alts">';
            // Also show the original BiS (si[0]) at top when an override is active, so user can revert easily
            const displayItems = (isOverridden && showSelectUI)
                ? [si[0], ...alts]
                : alts;

            displayItems.forEach((alt) => {
                const isBisFallback = isOverridden && String(alt.itemId) === String(si[0].itemId);
                const isActive = String(alt.itemId) === String(bis.itemId);
                const ap = alt.rank?.toLowerCase().includes('pvp');
                const ag = alt.rank === 'Guide';
                const ac = ag ? 'guide' : ap ? 'bis' : (alt.rank.toLowerCase().startsWith('bis') ? 'bis' : 'alt');
                const as = ap ? ' style="background:#c41e3a"' : '';
                const altSrc = getItemSource(alt.itemId);
                const altSrcText = altSrc ? `${srcEmoji(altSrc.sourceType)} ${altSrc.source || altSrc.sourceType}` : '';
                const altQuality = pvpQualityClass(alt);
                const altItemAlt = `${alt.name || 'Item #' + alt.itemId} — ${slot} alternative for ${state.selectedSpec} ${state.selectedClass}`;
                const altIconHtml = itemIcon(alt.itemId, 'small', 'alt-icon ' + altQuality, altItemAlt);
                const altPvpHtml = pvpMetaHtml(alt);
                const altWclHtml = wclMetaHtml(alt);
                const altGuideHtml = guideMetaHtml(alt);
                const bisLabel = isBisFallback ? ' <span class="alt-bis-label">BiS</span>' : '';
                const selectBtn = showSelectUI
                    ? `<button class="alt-select-btn${isActive ? ' active' : ''}" data-slot="${slot}" data-item-id="${alt.itemId}" title="${isActive ? 'Selected' : 'Use this item'}">${isActive ? '✓' : 'Use'}</button>`
                    : '';
                html += `<div class="alt-item${isActive ? ' alt-item-active' : ''}" data-item-id="${alt.itemId}">
                    ${altIconHtml}
                    <div class="slot-content">
                        <span class="alt-name ${altQuality}">${whItem(alt.itemId, alt.name || 'Item #'+alt.itemId, altQuality)}${bisLabel}</span>
                        ${altSrcText ? `<div class="slot-source">${altSrcText}</div>` : ''}
                        ${altPvpHtml}
                        ${altWclHtml}
                        ${altGuideHtml}
                        ${getNote(alt.itemId)}
                    </div>
                    ${showSelectUI ? selectBtn : `<span class="slot-badge ${ac}"${as}>${alt.rank}</span>`}
                </div>`;
            });
            html += '</div>';
        }
        html += '</div>';
        return html;
    }

    // ─── PvP meta helpers ────────────────────────────────────────────
    function pvpQualityClass(item) {
        if (item._pvpMeta) {
            const q = (item._pvpMeta.quality || '').toLowerCase();
            if (q === 'legendary') return 'q-legendary';
            if (q === 'epic') return 'q-epic';
            if (q === 'rare') return 'q-rare';
            if (q === 'uncommon') return 'q-uncommon';
            return 'q-epic';
        }
        if (item._wclMeta) {
            const q = (item._wclMeta.quality || '').toLowerCase();
            if (q === 'legendary') return 'q-legendary';
            if (q === 'epic') return 'q-epic';
            if (q === 'rare') return 'q-rare';
            if (q === 'uncommon') return 'q-uncommon';
            if (q === 'common') return 'q-common';
            return 'q-epic';
        }
        return qualityClass(item.itemId);
    }

    function pvpMetaHtml(item) {
        if (!item._pvpMeta) return '';
        const m = item._pvpMeta;
        const tierMeta = PVP_TIER_META[m.tier] || {};
        let parts = [];

        // Popularity badge with tier color
        parts.push(`<span class="pvp-pop-badge ${tierMeta.cls || ''}">${tierMeta.badge || ''} ${m.popularity}%</span>`);

        // PvE Flex indicator
        if (m.isPvEFlex) {
            parts.push(`<span class="pvp-pve-flex-badge" title="PvE item commonly used in PvP">⚔️ PvE</span>`);
        }

        // Rating gate indicator
        if (m.ratingGate) {
            parts.push(`<span class="pvp-rating-gate" title="More popular at higher ratings">🔒 ${m.ratingGate}+</span>`);
        }

        // Top enchant (IDs from Ironforge are permanent-enchant IDs, not Wowhead spell IDs, so no link)
        if (m.topEnchants && m.topEnchants.length) {
            const e = m.topEnchants[0];
            const enchName = (e.name || '').replace(/^Enchanted:\s*/i, '');
            parts.push(`<span class="pvp-enchant-badge" title="Most popular enchant (${e.usage}% of players)">🔮 ${enchName} ${e.usage}%</span>`);
        }

        return `<div class="pvp-meta-row">${parts.join('')}</div>`;
    }

    // ─── Build PvP items list from scraped data ────────────────────

    // ─── WCL slot name mapping ───────────────────────────────────────
    const WCL_SLOT_MAP = {
        'Shoulders': 'Shoulder',
        'Wrists':    'Wrist',
        'Ranged':    'Ranged/Relic',
        'Ring 1':    'Ring',
        'Ring 2':    'Ring',
        'Trinket 1': 'Trinket',
        'Trinket 2': 'Trinket',
    };

    // ─── WCL popularity tier thresholds ──────────────────────────────
    const WCL_TIER_META = {
        'gold':   { badge: '🥇', label: 'Meta',    cls: 'wcl-tier-gold' },
        'strong': { badge: '🥈', label: 'Strong',  cls: 'wcl-tier-strong' },
        'viable': { badge: '🥉', label: 'Viable',  cls: 'wcl-tier-viable' },
        'niche':  { badge: '',    label: 'Niche',   cls: 'wcl-tier-niche' },
    };
    function wclTier(pop) {
        if (pop >= 70) return 'gold';
        if (pop >= 40) return 'strong';
        if (pop >= 15) return 'viable';
        return 'niche';
    }

    // ─── Build WCL items list from scraped data ──────────────────────
    // Specs where OH should only show shields
    const WCL_SHIELD_ONLY_SPECS = new Set(['Warrior|Protection', 'Paladin|Protection']);

    function buildWclItemsList(wclSpecData) {
        const specKey = `${state.selectedClass}|${state.selectedSpec}`;
        const appKey = APP_TO_WCL_SPEC[specKey] || specKey;
        const shieldOnly = WCL_SHIELD_ONLY_SPECS.has(appKey);
        const has2HSet = typeof ITEM_TWO_HAND_WEAPON !== 'undefined';
        const hasShieldSet = typeof ITEM_SHIELD !== 'undefined';

        const items = [];
        for (const [wclSlot, slotItems] of Object.entries(wclSpecData.slots)) {
            let appSlot = WCL_SLOT_MAP[wclSlot] || wclSlot;

            for (let i = 0; i < slotItems.length; i++) {
                const wi = slotItems[i];
                let finalSlot = appSlot;

                // Reclassify 2H weapons from "Main Hand" to "Two Hand"
                if (finalSlot === 'Main Hand' && has2HSet && ITEM_TWO_HAND_WEAPON.has(wi.id)) {
                    finalSlot = 'Two Hand';
                }

                // Filter Prot specs OH to shields only
                if (shieldOnly && finalSlot === 'Off Hand' && hasShieldSet && !ITEM_SHIELD.has(wi.id)) {
                    continue;
                }

                const tier = wclTier(wi.popularity);
                const rank = i === 0 ? 'BIS' : 'Alt';
                items.push({
                    itemId: String(wi.id),
                    slot: finalSlot,
                    rank,
                    name: wi.name,
                    _wclMeta: {
                        popularity: wi.popularity,
                        tier,
                        quality: wi.quality,
                    }
                });
            }
        }
        return items;
    }

    // ─── WCL popularity badge HTML ───────────────────────────────────
    function wclMetaHtml(item) {
        if (!item._wclMeta) return '';
        const m = item._wclMeta;
        const tierMeta = WCL_TIER_META[m.tier] || {};
        return `<div class="wcl-meta-row"><span class="wcl-pop-badge ${tierMeta.cls || ''}">${tierMeta.badge || ''} ${m.popularity}% used</span></div>`;
    }

    // ─── Guide meta HTML (Wowhead original rank) ────────────────────
    function guideMetaHtml(item) {
        if (!item._guideMeta) return '';
        return `<div class="wcl-meta-row"><span class="wcl-pop-badge guide-source">📖 ${item._guideMeta.originalRank}</span></div>`;
    }

    // ─── Get WCL data for current spec + phase ──────────────────────
    // App spec names → WCL spec names mapping
    const APP_TO_WCL_SPEC = {
        'Druid|Cat':    'Druid|Feral',         // App "Cat" = WCL "Feral"
        'Druid|Bear':   'Druid|Guardian',      // App "Bear" = WCL "Guardian"
    };

    // Manual BiS data fallback: maps new spec names → old data spec names for P0
    const MANUAL_SPEC_FALLBACK = {
        'Rogue|Combat':        'Rogue|Dps',
        'Rogue|Assassination': 'Rogue|Dps',
        'Rogue|Subtlety':     'Rogue|Dps',
        'Priest|Discipline':   'Priest|Holy',
    };
    function getWclSpecData() {
        if (typeof WCL_DATA === 'undefined' || !WCL_DATA.phases) return null;
        if (state.isPvP) return null;
        const phase = state.selectedPhase;
        if (!phase) return null; // P0 (Pre-BiS) has no WCL data
        const appKey = `${state.selectedClass}|${state.selectedSpec}`;
        const wclKey = APP_TO_WCL_SPEC[appKey] || appKey;
        const phaseData = WCL_DATA.phases[phase];
        if (!phaseData) return null;
        return phaseData[wclKey] || null;
    }

    function buildPvpItemsList(pvpSpecData) {
        // With very few players, rating gate is just noise — suppress it
        const suppressRatingGate = (pvpSpecData.playerCount || 0) < 10;
        const has2HSet = typeof ITEM_TWO_HAND_WEAPON !== 'undefined';

        const items = [];
        for (const [pvpSlot, slotItems] of Object.entries(pvpSpecData.slots)) {
            let appSlot = PVP_SLOT_MAP[pvpSlot] || pvpSlot;
            for (let i = 0; i < slotItems.length; i++) {
                const pi = slotItems[i];
                let finalSlot = appSlot;

                // Reclassify 2H weapons from "Main Hand" to "Two Hand"
                if (finalSlot === 'Main Hand' && has2HSet && ITEM_TWO_HAND_WEAPON.has(pi.id)) {
                    finalSlot = 'Two Hand';
                }

                const tierMeta = PVP_TIER_META[pi.tier] || {};
                const popLabel = `${pi.popularity}%`;
                const rank = i === 0 ? 'PvP BIS' : 'PvP Alt';
                items.push({
                    itemId: String(pi.id),
                    slot: finalSlot,
                    rank,
                    name: pi.name,
                    _pvpMeta: {
                        popularity: pi.popularity,
                        tier: pi.tier,
                        tierBadge: tierMeta.badge || '',
                        tierLabel: tierMeta.label || pi.tier,
                        tierCls: tierMeta.cls || '',
                        isPvEFlex: pi.isPvEFlex,
                        ratingGate: suppressRatingGate ? null : pi.ratingGate,
                        avgUserRating: pi.avgUserRating,
                        userCount: pi.userCount,
                        topGems: pi.topGems || [],
                        topEnchants: pi.topEnchants || [],
                        quality: pi.quality,
                    }
                });
            }
        }
        return items;
    }

    // ─── Wowhead Guide data — supplemental items ─────────────────────
    // Maps app spec names to Wowhead guide spec names
    const APP_TO_GUIDE_SPEC = {
        'Druid|Cat':    'Druid|Cat',       // guide already mapped by build script
        'Druid|Bear':   'Druid|Bear',
        'Priest|Holy':  'Priest|Holy',
        'Priest|Discipline': 'Priest|Discipline',
    };

    // Slot name normalisation from guide data → app slot names
    const GUIDE_SLOT_MAP = {
        'Helm': 'Head',
        'Two-Hand': 'Two Hand',
        'Weapon': 'Main Hand',
        'Relic': 'Ranged',       // Totems/Idols/Librams → Ranged slot in app
    };

    function getGuideSpecData() {
        if (typeof GUIDE_DATA === 'undefined' || !GUIDE_DATA.phases) return null;
        if (state.isPvP) return null;
        const phase = state.selectedPhase;
        if (!phase) return null; // P0 has no guide data
        const appKey = `${state.selectedClass}|${state.selectedSpec}`;
        const guideKey = APP_TO_GUIDE_SPEC[appKey] || appKey;
        const phaseData = GUIDE_DATA.phases[phase];
        if (!phaseData) return null;
        return phaseData[guideKey] || null;
    }

    /**
     * Build guide items list, excluding any items already present in the WCL/existing list.
     * Returns items with rank='Guide' to be appended to slot groups.
     */
    function buildGuideItemsList(guideSpecData, existingItemIds) {
        const has2HSet = typeof ITEM_TWO_HAND_WEAPON !== 'undefined';
        const items = [];
        for (const [guideSlot, slotItems] of Object.entries(guideSpecData.slots)) {
            let appSlot = GUIDE_SLOT_MAP[guideSlot] || guideSlot;

            for (const gi of slotItems) {
                if (!gi.id) continue;
                // Skip items already in WCL/existing data
                if (existingItemIds.has(String(gi.id))) continue;

                let finalSlot = appSlot;
                // Reclassify 2H weapons
                if (finalSlot === 'Main Hand' && has2HSet && ITEM_TWO_HAND_WEAPON.has(Number(gi.id))) {
                    finalSlot = 'Two Hand';
                }

                items.push({
                    itemId: String(gi.id),
                    slot: finalSlot,
                    rank: 'Guide',
                    name: gi.n,
                    _guideMeta: {
                        originalRank: gi.r,  // e.g. "Best", "Alternative", "Hit Option"
                    }
                });
            }
        }
        return items;
    }

    // ─── Profession Filter ──────────────────────────────────────────
    const PROFESSION_ICONS = {
        Tailoring:           'trade_tailoring',
        Leatherworking:      'trade_leatherworking',
        Blacksmithing:       'trade_blacksmithing',
        Engineering:         'trade_engineering',
        'Gnomish Engineer':  'trade_engineering',
        Jewelcrafting:       'inv_misc_gem_01',
        Alchemy:             'trade_alchemy',
        Enchanting:          'trade_engraving',
    };

    function renderProfessionFilter(professions, hasPvpRatingItems, hasWorldBossItems) {
        if ((!professions.length && !hasPvpRatingItems && !hasWorldBossItems) || state.isPvP) {
            professionFilter.classList.add('hidden');
            professionFilter.innerHTML = '';
            return;
        }

        // Load from localStorage (persistent)
        const saved = localStorage.getItem('tbc-bis-excluded-profs');
        if (saved && !state._profsLoaded) {
            try {
                const arr = JSON.parse(saved);
                state.excludedProfessions = new Set(arr);
            } catch (e) { /* ignore */ }
            state._profsLoaded = true;
        }

        let html = '<div class="prof-filter-header"><span class="prof-filter-label">🔨 Professions &amp; PvP</span>';
        html += `<span class="prof-info-icon-wrap">
            <span class="prof-info-icon" tabindex="0">ℹ️</span>
            <span class="prof-info-tooltip">Some BiS items require a specific <strong>profession</strong> to equip (e.g. Tailoring BoP robes), a <strong>PvP arena rating</strong> to purchase, or drop from <strong>outdoor world bosses</strong> (weekly respawn). Toggle off to show the next-best alternative.</span>
        </span></div>`;
        html += '<div class="prof-filter-chips">';

        // Profession chips
        for (const prof of professions) {
            const active = !state.excludedProfessions.has(prof);
            const icon = PROFESSION_ICONS[prof] || 'inv_misc_questionmark';
            html += `<button class="prof-chip${active ? ' active' : ''}" data-prof="${prof}">
                <img src="${WH_ICON_CDN}/small/${icon}.jpg" alt="${prof}" class="prof-chip-icon">
                <span>${prof}</span>
            </button>`;
        }

        // PvP Rating chip (only when there are rating-gated items in the list)
        if (hasPvpRatingItems) {
            const pvpActive = !state.hidePvpRating;
            html += `<button class="prof-chip pvp-rating-chip${pvpActive ? ' active' : ''}" id="pvpRatingToggle">
                <span class="prof-chip-pvp-icon">⚔️</span>
                <span>PvP Rating</span>
            </button>`;
        }

        // World Boss chip (only when there are world boss items in the list)
        if (hasWorldBossItems) {
            const wbActive = !state.hideWorldBoss;
            html += `<button class="prof-chip world-boss-chip${wbActive ? ' active' : ''}" id="worldBossToggle">
                <span class="prof-chip-pvp-icon">🌍</span>
                <span>World Bosses</span>
            </button>`;
        }

        html += '</div>';
        professionFilter.innerHTML = html;
        professionFilter.classList.remove('hidden');
        bindHintDismiss(professionFilter);

        professionFilter.querySelectorAll('.prof-chip').forEach(chip => {
            if (chip.id === 'pvpRatingToggle') {
                chip.addEventListener('click', () => {
                    state.hidePvpRating = !state.hidePvpRating;
                    localStorage.setItem('tbc-bis-hide-pvp-rating', state.hidePvpRating ? '1' : '0');
                    renderBisList();
                    updateUrlWithBuild();
                });
                return;
            }
            if (chip.id === 'worldBossToggle') {
                chip.addEventListener('click', () => {
                    state.hideWorldBoss = !state.hideWorldBoss;
                    localStorage.setItem('tbc-bis-hide-world-boss', state.hideWorldBoss ? '1' : '0');
                    renderBisList();
                    updateUrlWithBuild();
                });
                return;
            }
            chip.addEventListener('click', () => {
                const prof = chip.dataset.prof;
                if (state.excludedProfessions.has(prof)) {
                    state.excludedProfessions.delete(prof);
                } else {
                    state.excludedProfessions.add(prof);
                }
                // Persist
                localStorage.setItem('tbc-bis-excluded-profs', JSON.stringify([...state.excludedProfessions]));
                renderBisList();
                updateUrlWithBuild();
            });
        });
    }

    // ─── Share Build bar ────────────────────────────────────────────
    function renderShareBar() {
        if (!shareBuildBar) return;
        // Show only when a phase/pvp view is active
        if (state.selectedPhase == null && !state.isPvP) {
            shareBuildBar.classList.add('hidden');
            return;
        }
        shareBuildBar.classList.remove('hidden');

        // Show reset button only if there are overrides or non-default filters
        const key = selectionKey();
        const overrides = state.selectedItems[key];
        const hasOverrides = overrides && Object.keys(overrides).length > 0;
        const hasFilters = state.excludedProfessions.size > 0 || state.hidePvpRating || state.hideWorldBoss;
        shareResetBtn.classList.toggle('hidden', !hasOverrides && !hasFilters);

        // Update share button text if there are customizations
        const btnLabel = shareBuildBtn.querySelector('span');
        if (btnLabel) {
            btnLabel.textContent = (hasOverrides || hasFilters) ? 'Share Custom Build' : 'Share Build';
        }
    }

    function showShareToast(msg) {
        shareToast.textContent = msg || '✓ Link copied to clipboard!';
        shareToast.classList.remove('hidden');
        shareToast.classList.add('show');
        clearTimeout(shareToast._timer);
        shareToast._timer = setTimeout(() => {
            shareToast.classList.remove('show');
            setTimeout(() => shareToast.classList.add('hidden'), 300);
        }, 2200);
    }

    // Wire up share button
    if (shareBuildBtn) {
        shareBuildBtn.addEventListener('click', () => {
            const url = buildShareUrl();
            navigator.clipboard.writeText(url).then(() => {
                showShareToast('✓ Link copied to clipboard!');
            }).catch(() => {
                // Fallback
                const input = document.createElement('input');
                input.value = url;
                document.body.appendChild(input);
                input.select();
                document.execCommand('copy');
                document.body.removeChild(input);
                showShareToast('✓ Link copied to clipboard!');
            });
        });
    }

    // Wire up reset button
    if (shareResetBtn) {
        shareResetBtn.addEventListener('click', () => {
            const key = selectionKey();
            delete state.selectedItems[key];
            try { localStorage.setItem('tbc-bis-selected-items', JSON.stringify(state.selectedItems)); } catch(_) {}
            // Reset filters to defaults
            state.excludedProfessions = new Set();
            state.hidePvpRating = false;
            state.hideWorldBoss = false;
            try {
                localStorage.removeItem('tbc-bis-excluded-profs');
                localStorage.setItem('tbc-bis-hide-pvp-rating', '0');
                localStorage.setItem('tbc-bis-hide-world-boss', '0');
            } catch(_) {}
            // Remove query params from URL
            history.replaceState(history.state, '', buildPath());
            renderBisList();
            showShareToast('↺ Reset to default BiS!');
        });
    }

    // ─── Step 4: BiS List ────────────────────────────────────────────
    function renderBisList() {
        // Render inline phase tabs
        renderPhaseSwitcher();
        renderShareBar();

        const pveSpec = getPveSpecForCurrentState();
        const specData = findSpec(state.selectedClass, pveSpec);
        const phaseData = (specData && state.selectedPhase != null)
            ? specData.phases[state.selectedPhase]
            : null;

        let items = phaseData ? [...phaseData.items] : [];

        // ── WCL: Use top-parser data as primary source if available ──
        let wclSpecData = null;
        if (!state.isPvP) {
            wclSpecData = getWclSpecData();
            if (wclSpecData) {
                items = buildWclItemsList(wclSpecData);
            }
        }

        // ── PvP: Use scraped data if available, else fall back to old PVP_ITEMS ──
        let pvpSpecData = null;
        if (state.isPvP) {
            const pvpKey = state.pvpKey || `${state.selectedClass}|${state.selectedSpec}`;
            if (typeof PVP_DATA !== 'undefined' && PVP_DATA.specs && PVP_DATA.specs[pvpKey]) {
                pvpSpecData = PVP_DATA.specs[pvpKey];
                // In scraped PvP mode, items come ONLY from scraped data
                items = buildPvpItemsList(pvpSpecData);
            } else if (phaseData) {
                // Legacy fallback (needs phase data)
                const pvpData = PVP_ITEMS[state.selectedClass];
                if (pvpData) {
                    const pvpPhases = Object.keys(pvpData).map(Number).sort();
                    let best = pvpPhases[0];
                    for (const pp of pvpPhases) { if (pp <= state.selectedPhase) best = pp; }
                    items = [...(pvpData[best] || []), ...items];
                }
            }
        }

        // ── Guide data: append Wowhead guide items not already in WCL data ──
        if (wclSpecData && !state.isPvP) {
            const guideSpecData = getGuideSpecData();
            if (guideSpecData) {
                const existingIds = new Set(items.map(i => String(i.itemId)));
                const guideItems = buildGuideItemsList(guideSpecData, existingIds);
                items = [...items, ...guideItems];
            }
        }

        if (!items.length) {
            slotList.innerHTML = '<p>No data found.</p>';
            return;
        }

        // ── Apply world boss filter FIRST, before any slot grouping ──
        // Check if any world boss items exist BEFORE filtering (so the toggle button stays visible)
        const anyWorldBossItems = !pvpSpecData && items.some(i => isItemWorldBoss(i.itemId));
        if (state.hideWorldBoss && !pvpSpecData) {
            items = items.filter(i => !isItemWorldBoss(i.itemId));
        }

        // Group by slot, dedup
        // Ring and Trinket are split into slot 1 and slot 2 (you wear two of each)
        const _ringBuf = [], _trinketBuf = [], _mhohBuf = [];
        const slotGroups = {};
        for (const item of items) {
            let slot = item.slot;
            if (slot === 'Shoulders') slot = 'Shoulder';
            if (slot === 'Weapon')    slot = 'Main Hand';   // normalize to MH (some data uses "Weapon" for caster/tank MH)

            // Buffer Ring and Trinket for later split into 1/2
            if (slot === 'Ring')    { if (!_ringBuf.find(i => i.itemId === item.itemId))    _ringBuf.push(item);    continue; }
            if (slot === 'Trinket') { if (!_trinketBuf.find(i => i.itemId === item.itemId)) _trinketBuf.push(item); continue; }

            // "Main Hand~Off Hand" — defer until after regular items are placed
            if (slot === 'Main Hand~Off Hand') {
                _mhohBuf.push(item);
                continue;
            }

            if (!slotGroups[slot]) slotGroups[slot] = [];
            if (!slotGroups[slot].find(i => i.itemId === item.itemId)) {
                slotGroups[slot].push(item);
            }
        }

        // Now merge deferred MH~OH items into MH and OH by rank order
        if (_mhohBuf.length) {
            const rankOrder = { 'BIS': 0, 'Pre-BIS': 1, 'Alt': 2, 'PvP BIS': 3, 'PvP Alt': 4, 'Guide': 5 };
            for (const item of _mhohBuf) {
                for (const s of ['Main Hand', 'Off Hand']) {
                    if (!slotGroups[s]) slotGroups[s] = [];
                    if (!slotGroups[s].find(i => i.itemId === item.itemId)) {
                        const entry = { ...item, slot: s };
                        const entryRank = rankOrder[entry.rank] ?? 99;
                        let idx = slotGroups[s].findIndex(i => (rankOrder[i.rank] ?? 99) > entryRank);
                        if (idx === -1) idx = slotGroups[s].length;
                        slotGroups[s].splice(idx, 0, entry);
                    }
                }
            }
        }

        // ── Remove Two-Hand weapons from Main Hand / Off Hand groups ──
        if (slotGroups['Two Hand']) {
            const twoHandIds = new Set(slotGroups['Two Hand'].map(i => String(i.itemId)));
            for (const s of ['Main Hand', 'Off Hand']) {
                if (slotGroups[s]) {
                    slotGroups[s] = slotGroups[s].filter(i => !twoHandIds.has(String(i.itemId)));
                    if (!slotGroups[s].length) delete slotGroups[s];
                }
            }
        }

        // ── Split Ring and Trinket into two independent slots ──
        // BIS items 1 and 2 become the primary item for slot 1 and 2 respectively.
        // Remaining items are alts for both slots.
        // Unique items cannot appear as primary in BOTH slot 1 and slot 2.
        function splitDualSlot(buf, slotName1, slotName2) {
            if (!buf.length) return;
            // Trust data.json order — it is already ranked correctly (BIS first).
            // Do NOT re-sort by rank string, as some BIS items carry rank="Alt" due
            // to how parse-lua-data.js assigns ranks.
            const allSorted = buf;

            const primary1 = allSorted[0];
            // For slot 2: always pick a DIFFERENT item than primary1.
            // In TBC virtually all rings and trinkets are Unique-Equipped,
            // so you can never wear two of the same.
            const primary2 = allSorted.slice(1).find(i => i.itemId !== primary1?.itemId);
            // If no valid second item exists (e.g. only one unique ring in filtered data),
            // skip slot 2 entirely rather than showing a duplicate.
            if (!primary2) {
                if (primary1) {
                    slotGroups[slotName1] = [
                        { ...primary1, slot: slotName1 },
                        ...allSorted.slice(1).map(i => ({ ...i, slot: slotName1 }))
                    ];
                }
                return;
            }

            const altsFor1 = allSorted.slice(1); // everything else is alt for slot 1
            const altsFor2 = allSorted.filter(i => i !== primary2); // remove primary2, keep others as alts

            if (primary1) {
                slotGroups[slotName1] = [
                    { ...primary1, slot: slotName1 },
                    ...altsFor1.map(i => ({ ...i, slot: slotName1 }))
                ];
            }
            if (primary2) {
                slotGroups[slotName2] = [
                    { ...primary2, slot: slotName2 },
                    ...altsFor2.map(i => ({ ...i, slot: slotName2 }))
                ];
            }
        }

        splitDualSlot(_ringBuf,    'Ring 1',    'Ring 2');
        splitDualSlot(_trinketBuf, 'Trinket 1', 'Trinket 2');

        // ── WCL dedup: Ring/Trinket come pre-split but may share the same #1 item ──
        // If the primary item in slot 1 and slot 2 is identical (Unique-Equipped),
        // bump slot 2's primary to the next different item.
        function dedupeWclDualSlot(slot1, slot2) {
            const s1 = slotGroups[slot1], s2 = slotGroups[slot2];
            if (!s1?.length || !s2?.length) return;
            if (String(s1[0].itemId) !== String(s2[0].itemId)) return;
            // Find next different item in slot 2
            const altIdx = s2.findIndex(i => String(i.itemId) !== String(s1[0].itemId));
            if (altIdx > 0) {
                // Promote that item to primary, keep rest as alts
                const promoted = s2.splice(altIdx, 1)[0];
                s2.unshift(promoted);
            }
        }
        if (wclSpecData) {
            dedupeWclDualSlot('Ring 1', 'Ring 2');
            dedupeWclDualSlot('Trinket 1', 'Trinket 2');
        }

        // ── Merge dual slots (Ring 1+2 → Rings, Trinket 1+2 → Trinkets) ──
        // Dedup by itemId, keep highest popularity, top 2 = BIS, rest = ALT.
        function mergeDualSlots(slot1, slot2, mergedName) {
            const s1 = slotGroups[slot1] || [];
            const s2 = slotGroups[slot2] || [];
            if (!s1.length && !s2.length) return;

            // Merge all items, dedup by itemId keeping highest popularity
            const byId = {};
            for (const item of [...s1, ...s2]) {
                const id = String(item.itemId);
                const pop = item._wclMeta?.popularity || item._pvpMeta?.popularity || 0;
                const existing = byId[id];
                const existingPop = existing?._wclMeta?.popularity || existing?._pvpMeta?.popularity || 0;
                if (!existing || pop > existingPop) {
                    byId[id] = { ...item, slot: mergedName };
                }
            }

            // Sort by popularity descending (for WCL/PvP), or keep rank order (for manual)
            const hasPop = Object.values(byId).some(i => i._wclMeta || i._pvpMeta);
            const merged = Object.values(byId).sort((a, b) => {
                if (hasPop) {
                    return (b._wclMeta?.popularity || b._pvpMeta?.popularity || 0)
                         - (a._wclMeta?.popularity || a._pvpMeta?.popularity || 0);
                }
                // Manual data: BIS first, then Alt
                const rankOrder = { 'BIS': 0, 'Pre-BIS': 1, 'Alt': 2 };
                return (rankOrder[a.rank] ?? 99) - (rankOrder[b.rank] ?? 99);
            });

            // Top 2 = BIS, rest = ALT (preserve PvP prefix if applicable)
            const isPvP = merged.some(i => i._pvpMeta);
            for (let i = 0; i < merged.length; i++) {
                merged[i].rank = i < 2 ? (isPvP ? 'PvP BIS' : 'BIS') : (isPvP ? 'PvP Alt' : 'Alt');
            }

            slotGroups[mergedName] = merged;
            delete slotGroups[slot1];
            delete slotGroups[slot2];
        }

        if (wclSpecData) {
            mergeDualSlots('Ring 1', 'Ring 2', 'Rings');
            mergeDualSlots('Trinket 1', 'Trinket 2', 'Trinkets');
        }
        // For manual/PvP data, also merge after splitDualSlot
        if (!wclSpecData) {
            mergeDualSlots('Ring 1', 'Ring 2', 'Rings');
            mergeDualSlots('Trinket 1', 'Trinket 2', 'Trinkets');
        }

        // ── Remove 2H weapons from Main Hand slot ──
        // Some items (Zhar'doom, Earthwarden, etc.) are tagged in the source data as
        // BOTH 'Main Hand' AND 'Two Hand'. They are 2H weapons — remove them from MH
        // so they only appear in the Two Hand slot group. This prevents showing a 2H
        // weapon as if it could be equipped alongside an Off Hand.
        if (slotGroups['Two Hand'] && slotGroups['Main Hand']) {
            const twoHandIds = new Set(slotGroups['Two Hand'].map(i => String(i.itemId)));
            slotGroups['Main Hand'] = slotGroups['Main Hand'].filter(i => !twoHandIds.has(String(i.itemId)));
            if (!slotGroups['Main Hand'].length) delete slotGroups['Main Hand'];
        }

        // ── Dual-wield fix: if MH exists but OH is empty, clone MH → OH ──
        // Only for PvE mode — PvP scraped data already has correct slots
        // Only for true dual-wield melee specs (same weapon in both hands)
        const DUAL_WIELD_SPECS = {
            'Warrior-Arms': true, 'Warrior-Fury': true,
            'Rogue-Combat': true, 'Rogue-Assassination': true, 'Rogue-Subtlety': true,
            'Rogue-Dps': true,
            'Shaman-Enhancement': true,
        };
        const specKey = `${state.selectedClass}-${state.selectedSpec}`;
        const isDualWield = DUAL_WIELD_SPECS[specKey];

        if (!pvpSpecData && isDualWield && slotGroups['Main Hand']?.length && !slotGroups['Off Hand']?.length) {
            // Clone MH items as OH recommendations, but filter out:
            // 1. Items that are Main Hand only (cannot be equipped in OH)
            // 2. Items that are Unique (cannot wear two of the same)
            const isRestricted = typeof ITEM_MAIN_HAND_ONLY !== 'undefined' && typeof ITEM_UNIQUE !== 'undefined';
            slotGroups['Off Hand'] = slotGroups['Main Hand']
                .filter(i => {
                    const id = parseInt(i.itemId);
                    if (!isRestricted) return true;
                    if (ITEM_MAIN_HAND_ONLY.has(id)) return false; // MH only — can't go in OH
                    if (ITEM_UNIQUE.has(id)) return false;         // Unique — can't dual-wield same item
                    return true;
                })
                .map(i => ({ ...i, slot: 'Off Hand', _clonedFromMH: true }));
            // If nothing is valid for OH after filtering, remove the empty group
            if (!slotGroups['Off Hand'].length) delete slotGroups['Off Hand'];
        }

        // ── Also filter MH slot: remove MH-only items that snuck into OH from data ──
        if (!pvpSpecData && slotGroups['Off Hand']?.length) {
            const isRestricted = typeof ITEM_MAIN_HAND_ONLY !== 'undefined';
            if (isRestricted) {
                slotGroups['Off Hand'] = slotGroups['Off Hand'].filter(i => !ITEM_MAIN_HAND_ONLY.has(parseInt(i.itemId)));
                if (!slotGroups['Off Hand'].length) delete slotGroups['Off Hand'];
            }
        }

        // ── Profession filter: discover which professions appear in any item in the slot ──
        // Show toggles for all professions present (BIS or Alt) so the user can filter them all out.
        const professionSet = new Set();
        let hasPvpRatingItems = false;
        let hasWorldBossItems = anyWorldBossItems; // use pre-filter count so button stays visible when active
        if (!pvpSpecData) {
            for (const [slot, items] of Object.entries(slotGroups)) {
                if (!items.length) continue;
                // Check every item in the slot (BIS or alt) for profession, rating-gated PvP or world boss
                for (const it of items) {
                    const prof = itemProfession(it.itemId);
                    if (prof) professionSet.add(prof);
                    if (!hasPvpRatingItems && isItemRatingGated(it.itemId, it.name, slot)) {
                        hasPvpRatingItems = true;
                    }
                }
            }
        }

        // Restore persistent hidePvpRating from localStorage (once per session)
        if (!state._pvpRatingLoaded) {
            state.hidePvpRating = localStorage.getItem('tbc-bis-hide-pvp-rating') === '1';
            state._pvpRatingLoaded = true;
        }

        // Restore persistent hideWorldBoss from localStorage (once per session)
        if (!state._worldBossLoaded) {
            state.hideWorldBoss = localStorage.getItem('tbc-bis-hide-world-boss') === '1';
            state._worldBossLoaded = true;
        }

        renderProfessionFilter([...professionSet].sort(), hasPvpRatingItems, hasWorldBossItems);

        // ── Apply profession filter: remove excluded profession items ──
        if (state.excludedProfessions.size && !pvpSpecData) {
            for (const [slot, items] of Object.entries(slotGroups)) {
                slotGroups[slot] = items.filter(i => !isItemExcluded(i.itemId));
                if (!slotGroups[slot].length) delete slotGroups[slot];
            }
        }

        // ── Apply PvP rating filter: remove Merciless/Vengeful/Brutal items ──
        if (state.hidePvpRating && !pvpSpecData) {
            for (const [slot, items] of Object.entries(slotGroups)) {
                slotGroups[slot] = items.filter(i => !isItemRatingGated(i.itemId, i.name, slot));
                if (!slotGroups[slot].length) delete slotGroups[slot];
            }
        }

        // ── Determine weapon display mode (after filter) ──
        const hasMH = slotGroups['Main Hand']?.length > 0;
        const hasOH = slotGroups['Off Hand']?.length > 0;
        const has2H = slotGroups['Two Hand']?.length > 0;
        const hasOneHanders = hasMH || hasOH;

        // Build enchant lookup: slot → enchant (PvE only)
        // Enchants inherit from nearest phase when not specified for current phase.
        const enchantLookup = {};
        if (phaseData) {
            for (const e of phaseData.enchants || []) {
                for (const s of e.slot.split('~')) {
                    enchantLookup[s.trim()] = e;
                }
            }
            // Fill missing slots by inheriting from nearest earlier phase, then later
            if (specData && state.selectedPhase != null) {
                const INHERIT_SLOTS = ['Head','Shoulder','Back','Chest','Wrist','Hands','Legs','Feet','Main Hand','Off Hand','Ranged/Relic','Ring'];
                const allPhases = Object.keys(specData.phases).map(Number).sort();
                const lower = allPhases.filter(p => p < state.selectedPhase).reverse();
                const higher = allPhases.filter(p => p > state.selectedPhase);
                for (const sl of INHERIT_SLOTS) {
                    if (enchantLookup[sl]) continue;
                    for (const pp of [...lower, ...higher]) {
                        const ppEnch = specData.phases[pp]?.enchants || [];
                        const found = ppEnch.find(e => e.slot.split('~').some(es => es.trim() === sl));
                        if (found) { enchantLookup[sl] = found; break; }
                    }
                }
            }
            // Two Hand weapons use the Main Hand enchant when no specific 2H enchant
            if (!enchantLookup['Two Hand'] && enchantLookup['Main Hand']) {
                enchantLookup['Two Hand'] = enchantLookup['Main Hand'];
            }
        }

        // Build gem data for inline display
        const gems = phaseData ? (phaseData.gems || []) : [];
        let metaGem = gems.find(g => g.isMeta);
        let regularGems = gems.filter(g => !g.isMeta);

        // Fallback: if no meta gem or too few regular gems, inherit from nearest phase
        if (specData && state.selectedPhase != null) {
            const phases = Object.keys(specData.phases).map(Number).sort();
            const lower = phases.filter(p => p < state.selectedPhase).reverse();
            const higher = phases.filter(p => p > state.selectedPhase);
            const searchOrder = [...lower, ...higher];
            if (!metaGem) {
                for (const p of searchOrder) {
                    const found = (specData.phases[p]?.gems || []).find(g => g.isMeta);
                    if (found) { metaGem = found; break; }
                }
            }
            if (regularGems.length < 2) {
                for (const p of searchOrder) {
                    const pg = (specData.phases[p]?.gems || []).filter(g => !g.isMeta);
                    if (pg.length >= 2) { regularGems = pg; break; }
                }
            }
        }

        // Build complete gem list for sim (includes fallbacks)
        const gemsForSim = [...regularGems];
        if (metaGem) gemsForSim.push(metaGem);

        // ── Helper: gem color string for a gem ──
        function gemColor(gemId) {
            return (typeof GEM_COLORS !== 'undefined' && GEM_COLORS[gemId]) || '';
        }

        // ── Match gems to sockets for a specific item ──
        function matchGemsToSockets(itemId) {
            const sockets = (typeof ITEM_SOCKETS !== 'undefined' && ITEM_SOCKETS[itemId]) || null;
            if (!sockets || !sockets.length) return [];

            const matched = [];
            for (const socketColor of sockets) {
                if (socketColor === 'm') {
                    // Meta socket → use meta gem
                    matched.push(metaGem || null);
                } else {
                    // Find best-fitting regular gem for this socket color
                    // Priority: 1) exact single-color match, 2) multi-color match, 3) any gem
                    let exact = null, multi = null;
                    for (const gem of regularGems) {
                        const gc = gemColor(gem.itemId);
                        if (!gc) { if (!multi) multi = gem; continue; }
                        if (gc === socketColor) { exact = gem; break; }       // exact: "r" matches "r"
                        if (gc.includes(socketColor)) { if (!multi) multi = gem; } // multi: "ry" matches "r"
                    }
                    const best = exact || multi || (regularGems.length ? regularGems[0] : null);
                    matched.push(best);
                }
            }
            return matched;
        }

        // Set the gem row builder for this render cycle
        // IDs that are poisons/oils/temp enchants, not real gems
        const NON_GEM_IDS = new Set([
            22055,21927,9186,3776,22054,22522,20748,22521, // poisons & oils
            3775,2892,2893,6950,8926,8928,8984,8985,       // more poisons
        ]);

        _buildGemOverlay = function(slot, item) {
            const itemId = item.itemId || item;

            // PvP mode: use per-item topGems
            if (state.isPvP && item._pvpMeta) {
                const sockets = (typeof ITEM_SOCKETS !== 'undefined' && ITEM_SOCKETS[itemId]) || null;
                if (!sockets || !sockets.length) return '';

                // Filter real gems from topGems (exclude poisons/oils)
                const pvpGems = (item._pvpMeta.topGems || []).filter(g => !NON_GEM_IDS.has(g.id));
                if (!pvpGems.length) return '';

                // Match: meta socket → meta gem, color sockets → best-fit gem by color
                const parts = [];
                const usedGemIds = new Set(); // track used gems to avoid duplicating the same visual
                for (const socketColor of sockets) {
                    let bestGem = null;
                    if (socketColor === 'm') {
                        // Find meta gem (check GEM_COLORS)
                        bestGem = pvpGems.find(g => {
                            const gc = (typeof GEM_COLORS !== 'undefined' && GEM_COLORS[g.id]) || '';
                            return gc === 'm';
                        });
                    } else {
                        // Find best-fit gem for this socket color
                        // Priority: 1) exact single-color match, 2) multi-color match, 3) any non-meta gem
                        let exact = null, multi = null, fallback = null;
                        for (const gem of pvpGems) {
                            const gc = (typeof GEM_COLORS !== 'undefined' && GEM_COLORS[gem.id]) || '';
                            if (gc === 'm') continue; // skip meta gems
                            if (gc === socketColor) { exact = gem; break; }
                            if (gc.includes(socketColor) && !multi) multi = gem;
                            if (!fallback) fallback = gem;
                        }
                        bestGem = exact || multi || fallback;
                    }
                    if (!bestGem) continue;

                    const gemIcon = (typeof ICONS !== 'undefined' && ICONS[bestGem.id]) || 'inv_misc_gem_01';
                    const isMeta = (typeof GEM_COLORS !== 'undefined' && GEM_COLORS[bestGem.id]) === 'm';
                    const metaCls = isMeta ? ' gem-icon-meta' : '';
                    parts.push(`<a href="https://www.wowhead.com/${WH}/item=${bestGem.id}" data-wowhead="item=${bestGem.id}&domain=${WH}" data-wh-item="${bestGem.id}" data-gem-name="${bestGem.name}" class="gem-row-link"><img src="${WH_ICON_CDN}/small/${gemIcon}.jpg" class="gem-row-img${metaCls}" alt="${bestGem.name}"></a>`);
                }
                if (!parts.length) return '';
                return `<div class="gem-row">${parts.join('')}</div>`;
            }

            // PvE mode
            if (!gems.length && !metaGem) return '';

            const matched = matchGemsToSockets(itemId);
            if (!matched.length) return '';

            const parts = [];
            for (const gem of matched) {
                if (!gem) continue;
                const gemIcon = (typeof ICONS !== 'undefined' && ICONS[gem.itemId]) || 'inv_misc_gem_01';
                const metaCls = gem.isMeta ? ' gem-icon-meta' : '';
                parts.push(`<a href="https://www.wowhead.com/${WH}/item=${gem.itemId}" data-wowhead="item=${gem.itemId}&domain=${WH}" data-wh-item="${gem.itemId}" data-gem-name="${gem.name}" class="gem-row-link"><img src="${WH_ICON_CDN}/small/${gemIcon}.jpg" class="gem-row-img${metaCls}" alt="${gem.name}"></a>`);
            }
            if (!parts.length) return '';
            return `<div class="gem-row">${parts.join('')}</div>`;
        };

        // GearScore estimate (use phase 5 as default for PvP without phase)
        const gsPhase = state.selectedPhase != null ? state.selectedPhase : 5;
        const bisItems = [];
        for (const slot of SLOT_ORDER) {
            const si = slotGroups[slot];
            if (si && si.length) {
                // Merged slots (Rings, Trinkets) count as 2 items — push top 2
                if (slot === 'Rings' || slot === 'Trinkets') {
                    for (let i = 0; i < Math.min(2, si.length); i++) {
                        const il = GearScore.estimateItemLevel(si[i].itemId, gsPhase);
                        bisItems.push({ itemLevel: il, rarity: 4, slot: slot + ' ' + (i+1) });
                    }
                } else {
                    const il = GearScore.estimateItemLevel(si[0].itemId, gsPhase);
                    bisItems.push({ itemLevel: il, rarity: 4, slot });
                }
            }
        }
        const gs = GearScore.calcTotalScore(bisItems);
        const pvpLabel = state.isPvP ? '<span class="pvp-tag" style="margin-left:6px">PvP</span>' : '';

        // ── Determine which weapon sections to show ──
        // Use WEAPON_STYLE config if available, else auto-detect from slot data
        const weapStyle = WEAPON_STYLE[specKey] || 'auto';
        let showDW, show2H;
        if (weapStyle === 'dw')        { showDW = hasOneHanders; show2H = false; }
        else if (weapStyle === '2h')   { showDW = false;         show2H = has2H; }
        else if (weapStyle === 'both') { showDW = hasOneHanders; show2H = has2H; }
        else { showDW = hasOneHanders; show2H = has2H; } // auto

        // ── Weapon mode — computed early, used by both paperdoll and slot rendering ──
        const showWeaponToggle = WEAPON_TOGGLE_SPECS.has(specKey) && hasOneHanders && has2H;
        const weaponMode = showWeaponToggle ? getWeaponMode(slotGroups) : null;
        const effectiveDW = showWeaponToggle ? (weaponMode === 'dw') : showDW;
        const effective2H = showWeaponToggle ? (weaponMode === '2h') : show2H;

        // ── Paperdoll overview ──
        const paperdoll = $('paperdoll');
        const PD_ORDER = [
            'Head', 'Neck', 'Shoulder', 'Back', 'Chest', 'Wrist', 'Hands', 'Waist',
            'Legs', 'Feet', 'Rings', 'Trinkets',
            'Main Hand', 'Off Hand', 'Two Hand', 'Ranged/Relic'
        ];
        const RELIC_CLASSES_PD = new Set(['Paladin', 'Shaman', 'Druid']);
        const rangedLabel = RELIC_CLASSES_PD.has(state.selectedClass) ? 'Relic' : 'Rng';
        const PD_LABELS = {
            Head:'Head', Neck:'Neck', Shoulder:'Shld', Back:'Back', Chest:'Chest', Wrist:'Wrist',
            Hands:'Hands', Waist:'Waist', Legs:'Legs', Feet:'Feet',
            'Rings':'Ring', 'Trinkets':'Trkt',
            'Main Hand':'MH', 'Off Hand':'OH', 'Two Hand':'2H', 'Ranged/Relic':rangedLabel
        };

        let pdHtml = '';
        for (const slot of PD_ORDER) {
            const si = slotGroups[slot];
            if (!si || !si.length) continue;

            // Skip weapon slots that shouldn't be shown for this spec/mode
            const isMHOrOH = slot === 'Main Hand' || slot === 'Off Hand';
            const is2H     = slot === 'Two Hand';
            if (isMHOrOH && !effectiveDW && !showWeaponToggle) continue;
            if (is2H     && !effective2H && !showWeaponToggle) continue;

            const bis = getActiveItem(slot, si);
            const isOverridden = String(bis.itemId) !== String(si[0].itemId);
            const hasEnchant = !!enchantLookup[slot] || !!enchantLookup[slot === 'Rings' ? 'Ring' : slot === 'Trinkets' ? 'Trinket' : slot];
            const pdTitle = (bis.name || slot).replace(/"/g, '&quot;');

            // Weapon mode: dim inactive weapon slots (toggle specs only)
            const isWeaponDimmed = showWeaponToggle && (
                (weaponMode === '2h' && isMHOrOH) ||
                (weaponMode === 'dw' && is2H)
            );

            // Merged slots (Rings, Trinkets): show 2 icons side by side
            if ((slot === 'Rings' || slot === 'Trinkets') && si.length >= 2) {
                const bis2 = si[1];
                const title2 = (bis2.name || slot).replace(/"/g, '&quot;');
                const pdAlt1 = `${bis.name || 'Item #' + bis.itemId} — ${slot} BiS`;
                const pdAlt2 = `${bis2.name || 'Item #' + bis2.itemId} — ${slot} BiS`;
                pdHtml += `<div class="pd-slot pd-slot-dual" data-pd-slot="${slot}" title="${pdTitle} + ${title2}">
                    <div class="pd-dual-icons">
                        ${itemIcon(bis.itemId, 'small', 'pd-slot-icon ' + qualityClass(bis.itemId), pdAlt1)}
                        ${itemIcon(bis2.itemId, 'small', 'pd-slot-icon ' + qualityClass(bis2.itemId), pdAlt2)}
                    </div>
                    <span class="pd-slot-label">${PD_LABELS[slot] || slot}</span>
                    ${hasEnchant ? '<span class="pd-enchant-dot"></span>' : ''}
                </div>`;
            } else {
                const pdAlt = `${bis.name || 'Item #' + bis.itemId} — ${slot} BiS`;
                pdHtml += `<div class="pd-slot${isOverridden ? ' pd-slot-overridden' : ''}${isWeaponDimmed ? ' pd-slot-dimmed' : ''}" data-pd-slot="${slot}" title="${pdTitle}">
                    ${itemIcon(bis.itemId, 'medium', 'pd-slot-icon ' + qualityClass(bis.itemId), pdAlt)}
                    <span class="pd-slot-label">${PD_LABELS[slot] || slot}</span>
                    ${hasEnchant ? '<span class="pd-enchant-dot"></span>' : ''}
                    ${isOverridden ? '<span class="pd-custom-dot"></span>' : ''}
                    ${isWeaponDimmed ? '<span class="pd-dimmed-x">✕</span>' : ''}
                </div>`;
            }
        }
        paperdoll.innerHTML = pdHtml;

        // Paperdoll click → intercept item icon clicks to open modal
        paperdoll.addEventListener('click', e => {
            const el = e.target.closest('[data-wh-item]');
            if (el) {
                e.preventDefault();
                e.stopPropagation();
                const itemId = el.dataset.whItem;
                const pdSlot = el.closest('.pd-slot');
                const slot = pdSlot?.dataset.pdSlot || '';
                openItemModal(itemId, slot);
                return;
            }
            // Fallback: click on pd-slot label/area → scroll to slot
            const pd = e.target.closest('.pd-slot');
            if (pd) {
                const target = slotList.querySelector(`.slot-group[data-slot="${pd.dataset.pdSlot}"]`);
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    target.classList.add('open');
                    target.style.boxShadow = '0 0 0 2px var(--accent)';
                    setTimeout(() => target.style.boxShadow = '', 1500);
                }
            }
        });

        // ── GearScore summary ──
        gsSummary.innerHTML = `
            <div class="gs-stat"><div class="gs-label">GearScore${pvpLabel}</div>
                <div class="gs-value" style="color:${GearScore.getColor(gs.gearScore)}">${gs.gearScore}</div></div>
            <div class="gs-divider"></div>
            <div class="gs-stat"><div class="gs-label">Avg iLevel</div>
                <div class="gs-value">${gs.avgItemLevel}</div></div>
            <div class="gs-divider"></div>
            <div class="gs-stat"><div class="gs-label">Slots</div>
                <div class="gs-value">${Object.keys(slotGroups).length}</div></div>`;

        // ── SEO contextual description + visible FAQ + closing summary ──
        renderSeoDescription();
        renderSeoFaq();
        renderSeoSummary();

        // ── Build slot HTML ──
        let html = '';
        if (state.isPvP) {
            if (pvpSpecData) {
                const rr = pvpSpecData.ratingRange;
                const ratingInfo = rr ? `${rr.min}–${rr.max} rating (avg ${rr.avg})` : '';
                const meta = (typeof PVP_DATA !== 'undefined' && PVP_DATA.meta) || {};
                const dateStr = meta.analyzedAt
                    ? new Date(meta.analyzedAt).toLocaleDateString('sv-SE')
                    : '';
                const flexCount = pvpSpecData.flexSlots ? Object.keys(pvpSpecData.flexSlots).length : 0;
                html += `<div class="pvp-info-banner">
                    <div class="pvp-banner-title">⚔️ <strong>Arena BiS — Live Snapshot</strong></div>
                    <div class="pvp-banner-meta">
                        What the top ${pvpSpecData.playerCount} ${pvpSpecData.spec} players are wearing right now.
                        ${ratingInfo ? '<br>' + ratingInfo : ''}
                        ${dateStr ? '<br>📅 Last updated: ' + dateStr : ''}
                    </div>
                    <div class="pvp-banner-legend">
                        <span class="pvp-legend-item"><span class="pvp-pop-badge pvp-tier-gold">🥇 70%+</span> Gold</span>
                        <span class="pvp-legend-item"><span class="pvp-pop-badge pvp-tier-strong">🥈 40%+</span> Strong</span>
                        <span class="pvp-legend-item"><span class="pvp-pop-badge pvp-tier-viable">🥉 15%+</span> Viable</span>
                        <span class="pvp-legend-item"><span class="pvp-pve-flex-badge">⚔️ PvE</span> Flex slot</span>
                    </div>
                </div>`;
            } else {
                html += `<div style="padding:10px 14px;background:rgba(196,30,58,0.08);border:1px solid rgba(196,30,58,0.25);border-radius:var(--radius);margin-bottom:10px;font-size:0.78rem;color:var(--text-secondary);">
                    ⚔️ <strong style="color:#c41e3a">PvP Mode</strong> — Gladiator & Honor items prioritized.
                </div>`;
            }
        } else {
            if (wclSpecData) {
                // WCL data banner
                const meta = (typeof WCL_DATA !== 'undefined' && WCL_DATA.meta) || {};
                const dateStr = meta.scrapedAt
                    ? new Date(meta.scrapedAt).toLocaleDateString('sv-SE')
                    : '';
                // Build WCL rankings link
                const WCL_ZONE_IDS = { 1: 1007, 2: 1008, 3: 1010, 4: 1012, 5: 1013 };
                const WCL_SPEC_NAMES = {
                    'Cat': 'Feral', 'Bear': 'Guardian', 'Beast Mastery': 'BeastMastery',
                    'Dps': 'Rogue', 'Combat': 'Combat', 'Assassination': 'Assassination',
                };
                const wclZone = WCL_ZONE_IDS[state.selectedPhase] || '';
                const wclClass = state.selectedClass;
                const wclSpec = WCL_SPEC_NAMES[state.selectedSpec] || state.selectedSpec;
                const wclMetric = ['Protection', 'Guardian'].includes(wclSpec) ? 'tankhps' : (['Holy', 'Restoration', 'Discipline'].includes(wclSpec) ? 'hps' : 'dps');
                const wclLink = wclZone ? `https://classic.warcraftlogs.com/zone/rankings/${wclZone}#class=${wclClass}&spec=${wclSpec}&metric=${wclMetric}` : '';
                const wclLinkHtml = wclLink ? `<a href="${wclLink}" target="_blank" rel="noopener" class="wcl-banner-link">View on WarcraftLogs →</a>` : '';
                html += `<div class="wcl-info-banner">
                    <div class="wcl-banner-title">📊 <strong>WarcraftLogs Meta — Top Parsers</strong></div>
                    <div class="wcl-banner-meta">
                        What the top ${wclSpecData.totalPlayers} ${state.selectedSpec} ${state.selectedClass} parsers are wearing in Phase ${state.selectedPhase}.
                        ${dateStr ? '<br>📅 Data snapshot: ' + dateStr : ''}
                        ${wclLinkHtml}
                    </div>
                    <div class="wcl-banner-legend">
                        <span class="wcl-legend-item"><span class="wcl-pop-badge wcl-tier-gold">🥇 70%+</span> Meta</span>
                        <span class="wcl-legend-item"><span class="wcl-pop-badge wcl-tier-strong">🥈 40%+</span> Strong</span>
                        <span class="wcl-legend-item"><span class="wcl-pop-badge wcl-tier-viable">🥉 15%+</span> Viable</span>
                        <span class="wcl-legend-item"><span class="wcl-pop-badge wcl-tier-niche">Niche</span></span>
                    </div>
                </div>`;
            } else {
                // PvE hint (manual data fallback)
                html += hintHtml('pve-bis', '📖',
                    `These are <strong>curated BiS recommendations</strong> based on theorycrafting and community guides. ` +
                    `Tap any item to see alternatives, source info, and a Wowhead link. ` +
                    `Items with <strong>gem sockets</strong> show recommended gems below the icon.`
                );
            }
        }

        // ── Category-based rendering ──
        const ARMOR_SLOTS   = ['Head', 'Shoulder', 'Back', 'Chest', 'Wrist', 'Hands', 'Waist', 'Legs', 'Feet'];
        const JEWELRY_SLOTS = ['Neck', 'Rings', 'Trinkets'];
        const WEAPON_SLOTS  = new Set(['Main Hand', 'Off Hand', 'Two Hand', 'Ranged/Relic']);

        // Helper: render a category header
        function categoryHeader(icon, title, extraClass, note) {
            const noteHtml = note ? `<span class="weapon-section-note">${note}</span>` : '';
            return `<div class="weapon-section-header ${extraClass || ''}">
                <span class="weapon-section-icon">${icon}</span>
                <span class="weapon-section-title">${title}</span>
                ${noteHtml}
            </div>`;
        }

        // ── Armor ──
        html += categoryHeader('🛡️', 'Armor', 'first-category');
        for (const slot of ARMOR_SLOTS) {
            html += renderSlotGroup(slot, slotGroups, enchantLookup, !!pvpSpecData);
        }

        // ── Jewelry (Ring 1, Ring 2, Trinket 1, Trinket 2) ──
        html += categoryHeader('💎', 'Jewelry');
        for (const slot of JEWELRY_SLOTS) {
            html += renderSlotGroup(slot, slotGroups, enchantLookup, !!pvpSpecData);
        }

        // ── Weapons ──
        if (effectiveDW || effective2H) {
            const isCasterToggle = ['Mage-Fire','Mage-Frost','Mage-Arcane',
                'Warlock-Destruction','Warlock-Affliction','Warlock-Demonology',
                'Druid-Balance','Shaman-Elemental','Priest-Shadow',
                'Priest-Holy','Shaman-Restoration','Druid-Restoration'].includes(specKey);
            const toggleHtml = showWeaponToggle ? `
                <div class="weapon-toggle">
                    <button class="weapon-toggle-btn${weaponMode === 'dw' ? ' active' : ''}" data-weapon-mode="dw">${isCasterToggle ? '🪄 MH + Off Hand' : '⚔️ Dual-Wield'}</button>
                    <button class="weapon-toggle-btn${weaponMode === '2h' ? ' active' : ''}" data-weapon-mode="2h">${isCasterToggle ? '🔮 Staff / 2H' : '🗡️ Two-Handed'}</button>
                </div>` : '';
            const weaponTitle = (!showWeaponToggle && effectiveDW && !effective2H && isDualWield) ? 'Dual-Wield'
                              : (!showWeaponToggle && effective2H && !effectiveDW)                 ? 'Two-Handed'
                              : 'Weapons';
            html += `<div class="weapon-section-header">
                <span class="weapon-section-icon">⚔️</span>
                <span class="weapon-section-title">${weaponTitle}</span>
                ${toggleHtml}
            </div>`;
        }

        if (effectiveDW) {
            if (hasMH) html += renderSlotGroup('Main Hand', slotGroups, enchantLookup, !!pvpSpecData);
            if (hasOH) html += renderSlotGroup('Off Hand',  slotGroups, enchantLookup, !!pvpSpecData);
        }
        if (showWeaponToggle && weaponMode === '2h' && hasOneHanders) {
            // Show MH/OH dimmed so user can still browse/switch
            html += `<div class="slot-group-inactive-wrap">`;
            if (hasMH) html += renderSlotGroup('Main Hand', slotGroups, enchantLookup, !!pvpSpecData);
            if (hasOH) html += renderSlotGroup('Off Hand',  slotGroups, enchantLookup, !!pvpSpecData);
            html += `</div>`;
        }

        if (effective2H) {
            html += renderSlotGroup('Two Hand', slotGroups, enchantLookup, !!pvpSpecData);
        }
        if (showWeaponToggle && weaponMode === 'dw' && has2H) {
            // Only show dimmed 2H if it has items distinct from the active MH
            // (avoids showing the same item twice, e.g. The Nexus Key as both MH and 2H)
            const activeMHIds = new Set((slotGroups['Main Hand'] || []).map(i => String(i.itemId)));
            const distinct2H  = (slotGroups['Two Hand'] || []).filter(i => !activeMHIds.has(String(i.itemId)));
            if (distinct2H.length) {
                html += `<div class="slot-group-inactive-wrap">`;
                html += renderSlotGroup('Two Hand', slotGroups, enchantLookup, !!pvpSpecData);
                html += `</div>`;
            }
        }

        // NOTE: old fallback headers removed — title is now set dynamically above

        if (slotGroups['Ranged/Relic']?.length) {
            html += categoryHeader('🏹', 'Ranged / Relic');
            html += renderSlotGroup('Ranged/Relic', slotGroups, enchantLookup, !!pvpSpecData);
        }

        slotList.innerHTML = html;
        // Hide the prerendered static BiS summary now that the interactive
        // list has rendered. Doing this in the same JS tick as the innerHTML
        // assignment means the browser paints both changes together → no flicker.
        const staticBis = document.getElementById('bisStaticSummary');
        if (staticBis && !staticBis.classList.contains('hidden')) {
            staticBis.classList.add('hidden');
        }
        bindHintDismiss(slotList);

        // ── Weapon toggle buttons ──
        slotList.querySelectorAll('.weapon-toggle-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const scrollY = window.scrollY;
                setWeaponMode(btn.dataset.weaponMode);
                renderBisList();
                requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: 'instant' }));
            });
        });

        // Events — expand/collapse slot-header (but open modal if icon/name clicked)
        slotList.querySelectorAll('.slot-header').forEach(hdr => {
            hdr.addEventListener('click', e => {
                const whEl = e.target.closest('[data-wh-item]');
                if (whEl) return; // handled by delegation below
                const grp = hdr.closest('.slot-group');
                if (grp.querySelector('.slot-alts')) grp.classList.toggle('open');
            });
        });

        // Open modal on alt-item click (but not on select-btn or wh-item clicks)
        slotList.querySelectorAll('.alt-item').forEach(el => {
            el.addEventListener('click', e => {
                const whEl = e.target.closest('[data-wh-item]');
                if (whEl) return;
                const selBtn = e.target.closest('.alt-select-btn');
                if (selBtn) return; // handled separately below
                openItemModal(el.dataset.itemId, el.closest('.slot-group').dataset.slot);
            });
        });

        // ── Item selection: Välj-knapp ──
        slotList.querySelectorAll('.alt-select-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const scrollY = window.scrollY;
                setSelectedItem(btn.dataset.slot, btn.dataset.itemId);
                renderBisList();
                requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: 'instant' }));
            });
        });

        // ── Item selection: Reset-knapp (✕) ──
        slotList.querySelectorAll('.slot-reset-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const scrollY = window.scrollY;
                setSelectedItem(btn.dataset.slot, null);
                renderBisList();
                requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: 'instant' }));
            });
        });

        // Global delegation — intercept [data-wh-item] and [data-wh-spell] clicks
        slotList.addEventListener('click', e => {
            // Enchant spell link?
            const spellEl = e.target.closest('[data-wh-spell]');
            if (spellEl) {
                e.preventDefault();
                e.stopPropagation();
                const spellId = spellEl.dataset.whSpell;
                const name = spellEl.textContent.trim();
                let src = null;
                try { src = JSON.parse(spellEl.dataset.enchSrc || 'null'); } catch(e2) {}
                openEnchantModal(spellId, name, src);
                return;
            }
            // Item / gem link?
            const el = e.target.closest('[data-wh-item]');
            if (!el) return;
            e.preventDefault();
            e.stopPropagation();
            const itemId = el.dataset.whItem;
            const gemName = el.dataset.gemName;
            if (gemName !== undefined) {
                openGemModal(itemId, gemName || el.querySelector('img')?.alt || '');
            } else {
                const slotGrp = el.closest('.slot-group');
                const altItem = el.closest('.alt-item');
                const slot = slotGrp?.dataset.slot || '';
                openItemModal(altItem ? altItem.dataset.itemId : itemId, slot);
            }
        });

        refreshWH();

        // Uppdatera stats-panel om spec har sim-stöd
        scheduleSimStats(slotGroups, enchantLookup, gemsForSim);
    }

    // ─── Sim Stats Panel ─────────────────────────────────────────────
    // Specs som har sim-stöd (matchas mot specKey = "Class-Spec")
    const SIM_SUPPORTED_SPECS = new Set([
        'Warrior-Fury', 'Warrior-Arms', 'Warrior-Protection',
        'Priest-Shadow', 'Priest-Holy', 'Priest-Discipline',
        'Rogue-Combat',
        'Paladin-Retribution', 'Paladin-Protection', 'Paladin-Holy',
        'Shaman-Enhancement', 'Shaman-Elemental', 'Shaman-Restoration',
        'Druid-Cat', 'Druid-Bear', 'Druid-Balance', 'Druid-Restoration',
        'Mage-Fire', 'Mage-Frost', 'Mage-Arcane',
        'Warlock-Destruction', 'Warlock-Affliction', 'Warlock-Demonology',
        'Hunter-Beast Mastery', 'Hunter-Marksmanship', 'Hunter-Survival',
    ]);

    // Specs där DPS-simulering är aktiv
    const SIM_DPS_SPECS = new Set(['Warrior-Fury', 'Warrior-Arms', 'Rogue-Combat', 'Priest-Shadow', 'Shaman-Enhancement', 'Shaman-Elemental', 'Paladin-Retribution', 'Druid-Cat', 'Druid-Balance', 'Warlock-Affliction', 'Warlock-Destruction', 'Warlock-Demonology', 'Mage-Fire', 'Mage-Frost', 'Mage-Arcane', 'Hunter-Beast Mastery', 'Hunter-Marksmanship', 'Hunter-Survival']);

    const SIM_DISCLAIMER = {
        'Warrior-Fury':  'Simulation uses standard Fury Warrior rotation (Bloodthirst → Whirlwind → Execute priority). On-use trinkets activated on cooldown. 3 000 iterations, 300s fight, Orc vs. boss-level target.',
        'Warrior-Arms':  'Simulation uses standard Arms Warrior rotation (Mortal Strike → Overpower priority). On-use trinkets activated on cooldown. 3 000 iterations, 300s fight, Orc vs. boss-level target.',
        'Rogue-Dps':     'Simulation uses Combat Swords rotation (Sinister Strike → Slice and Dice / Rupture / Eviscerate). Expose Armor maintained, Blade Flurry + Adrenaline Rush on cooldown. 3 000 iterations, 300s fight, Human vs. boss-level target.',
        'Rogue-Combat':  'Simulation uses Combat Swords rotation (Sinister Strike → Slice and Dice / Rupture / Eviscerate). Expose Armor maintained, Blade Flurry + Adrenaline Rush on cooldown. 3 000 iterations, 300s fight, Human vs. boss-level target.',
        'Priest-Shadow': 'Simulation uses Ideal Shadow Priest rotation (VT → MB → SW:D → MF, Devouring Plague on CD). Shadowfiend used on cooldown. 3 000 iterations, 300s fight, Undead vs. boss-level target.',
        'Druid-Cat':     'Simulation uses Feral Cat rotation (Mangle → Shred → Rip/Bite weave, Rake maintained). Omen of Clarity procs, Faerie Fire maintained. 3 000 iterations, 300s fight, Tauren vs. boss-level target.',
        'Druid-Balance': 'Simulation uses Adaptive Balance Druid rotation (Starfire + Moonfire, Faerie Fire maintained, auto-adjusts for mana). Self-Innervate, Force of Nature on cooldown. 3 000 iterations, 300s fight, Tauren vs. boss-level target.',
        'Shaman-Elemental': 'Simulation uses Adaptive Elemental Shaman rotation (Lightning Bolt + Chain Lightning, Totem of Wrath, Water Shield). Bloodlust included. 3 000 iterations, 300s fight, Orc vs. boss-level target.',
        'Warlock-Affliction': 'Simulation uses Affliction Warlock rotation (Shadow Bolt filler + Corruption, UA, Siphon Life, CoE, Immolate). Succubus sacrifice for 15% shadow dmg. 3 000 iterations, 300s fight, Undead vs. boss-level target.',
        'Warlock-Destruction': 'Simulation uses Destruction Warlock rotation (Shadow Bolt filler + Immolate, Curse of Doom). Succubus sacrifice for 15% shadow dmg. 3 000 iterations, 300s fight, Undead vs. boss-level target.',
        'Warlock-Demonology': 'Simulation uses Demonology Warlock rotation (Shadow Bolt filler + Corruption, Immolate, Curse of Elements) with Felguard pet. 3 000 iterations, 300s fight, Undead vs. boss-level target.',
        'Mage-Fire': 'Simulation uses Fire Mage rotation (Fireball filler + maintain Improved Scorch + Fire Blast weave). Molten Armor. 3 000 iterations, 300s fight, Gnome vs. boss-level target.',
        'Mage-Frost': 'Simulation uses Deep Frost Mage rotation (Frostbolt spam + Water Elemental). Mage Armor. 3 000 iterations, 300s fight, Gnome vs. boss-level target.',
        'Mage-Arcane': 'Simulation uses Arcane Mage rotation (Arcane Blast ×3 + Frostbolt filler, regen at 20%/50% mana). Mage Armor. 3 000 iterations, 300s fight, Gnome vs. boss-level target.',
        'Hunter-Beast Mastery': 'Simulation uses BM Hunter rotation (Steady Shot + Multi-Shot, Aimed Shot precast, Serpent Sting, lazy rotation). Ravager pet, 90% uptime. Flask of Relentless Assault + FlameCap. 3 000 iterations, 300s fight, Troll vs. boss-level target.',
        'Hunter-Marksmanship': 'Simulation uses MM Hunter rotation (Steady Shot + Multi-Shot + Arcane Shot, Aimed Shot precast, Serpent Sting). Ravager pet, 90% uptime. Flask of Relentless Assault + FlameCap. 3 000 iterations, 300s fight, Troll vs. boss-level target.',
        'Hunter-Survival': 'Simulation uses Survival Hunter melee-weave rotation (Steady Shot + Multi-Shot + Arcane Shot, Serpent Sting, raptor strike weave 80%). Wind Serpent pet, 90% uptime. Flask of Relentless Assault + FlameCap. 3 000 iterations, 300s fight, Troll vs. boss-level target.',
    };

    const simPanel       = document.getElementById('simPanel');
    const simStats       = document.getElementById('simStats');
    const simDpsSection  = document.getElementById('simDpsSection');
    const simDisclaimer  = document.getElementById('simDisclaimer');
    let _simStatsDebounce = null;
    let _simStatsReqId = 0;

    function scheduleSimStats(slotGroups, enchantLookup, gems) {
        const specKey = `${state.selectedClass}-${state.selectedSpec}`;
        if (state.isPvP || !SIM_SUPPORTED_SPECS.has(specKey) || typeof WowSimBridge === 'undefined') {
            if (simPanel) simPanel.style.display = 'none';
            return;
        }
        if (simPanel) simPanel.style.display = 'block';

        // Visa/dölj DPS-knapp beroende på spec
        if (simDpsSection) simDpsSection.style.display = SIM_DPS_SPECS.has(specKey) ? 'block' : 'none';
        if (simDisclaimer) simDisclaimer.textContent = SIM_DISCLAIMER[specKey] || '';

        // Reset DPS sim result when gear context changes (phase / class / spec switch)
        if (simDpsResult)  simDpsResult.style.display = 'none';
        if (simDpsProgress) simDpsProgress.style.display = 'none';
        if (simDpsBtn)     { simDpsBtn.disabled = false; simDpsBtn.textContent = 'Simulate DPS'; }

        _lastSlotGroups    = slotGroups;
        _lastEnchantLookup = enchantLookup;
        _lastGems          = gems;

        clearTimeout(_simStatsDebounce);
        _simStatsDebounce = setTimeout(async () => {
            const reqId = ++_simStatsReqId;
            simStats.innerHTML = '<div class="sim-stat-loading">Computing stats…</div>';

            // Capture slotGroups + weaponMode at this moment.
            // For toggle specs: auto-detect from data (or use user override if set).
            // For non-toggle specs: derive from WEAPON_STYLE so we don't
            // accidentally skip weapons (e.g. Bear '2h' spec getting 'dw' default).
            let wMode;
            if (WEAPON_TOGGLE_SPECS.has(specKey)) {
                wMode = typeof getWeaponMode === 'function' ? getWeaponMode(slotGroups) : null;
            } else {
                const ws = WEAPON_STYLE[specKey] || 'auto';
                wMode = ws === '2h' ? '2h' : ws === 'dw' ? 'dw' : null;
            }
            const stats = await computeStatsForBis(slotGroups, getActiveItem, wMode, enchantLookup, gems, specKey);
            if (reqId !== _simStatsReqId) return; // stale

            if (!stats) {
                if (!_simReady) {
                    // WASM not loaded yet — retry once when ready
                    simStats.innerHTML = '<div class="sim-stat-loading">Stats unavailable — WASM loading…</div>';
                    onSimReady(() => scheduleSimStats(slotGroups, enchantLookup, gems));
                } else {
                    // WASM ready but this gear caused a crash — don't retry
                    // (error details visible in browser console)
                    simStats.innerHTML = '<div class="sim-stat-loading">Stats unavailable for this phase</div>';
                }
                return;
            }
            renderSimStats(stats, specKey);
        }, 300);
    }

    function renderSimStats(stats, specKey) {
        const CASTER_SPECS = new Set(['Priest-Shadow', 'Mage-Fire', 'Mage-Frost', 'Mage-Arcane',
            'Warlock-Destruction', 'Warlock-Affliction', 'Warlock-Demonology',
            'Shaman-Elemental', 'Druid-Balance']);
        const HUNTER_SPECS = new Set(['Hunter-Beast Mastery', 'Hunter-Marksmanship', 'Hunter-Survival']);
        const HEALER_SPECS = new Set(['Priest-Holy', 'Paladin-Holy', 'Shaman-Restoration', 'Druid-Restoration']);
        const isCaster = CASTER_SPECS.has(specKey);
        const isHunter = HUNTER_SPECS.has(specKey);
        const isHealer = HEALER_SPECS.has(specKey);
        const isBear   = specKey === 'Druid-Bear';
        const isTank   = isBear || specKey === 'Warrior-Protection' || specKey === 'Paladin-Protection';
        const labels = isHealer ? SIM_STAT_LABELS_HEALER
                     : isCaster ? SIM_STAT_LABELS_CASTER
                     : isHunter ? SIM_STAT_LABELS_HUNTER
                     : isTank   ? SIM_STAT_LABELS_TANK
                     :            SIM_STAT_LABELS_MELEE;
        // Bear uses a different stat order: no block/parry, has crit-immune badge via SotF
        const order  = isHealer ? SIM_STAT_ORDER_HEALER
                     : isCaster ? getCasterStatOrder(specKey)
                     : isHunter ? SIM_STAT_ORDER_HUNTER
                     : isBear   ? SIM_STAT_ORDER_TANK_BEAR
                     : isTank   ? SIM_STAT_ORDER_TANK
                     :            SIM_STAT_ORDER_MELEE;
        const rows = order.map(idx => {
            const def = labels[idx];
            if (!def) return '';
            // Sentinel 999 = Total Avoidance (dodge% + parry% + block%)
            // Sentinel 998 = Bear crit-immunity static badge
            let val;
            if (idx === 999) {
                const dodgePct = (stats[32] || 0) / DODGE_RATING_PER_PCT;
                const parryPct = (stats[33] || 0) / PARRY_RATING_PER_PCT;
                const blockPct = (stats[30] || 0) / BLOCK_RATING_PER_PCT;
                val = dodgePct + (isBear ? 0 : parryPct) + (isBear ? 0 : blockPct);
            } else if (idx === 998) {
                val = 0; // ignored — fmt returns static HTML
            } else {
                val = stats[idx] || 0;
            }
            // Defense (idx 29) fmt takes optional isBear flag
            const formatted = idx === 29 ? def.fmt(val, isBear) : def.fmt(val);
            return `<div class="sim-stat-row">
                <span class="sim-stat-label">${def.label}</span>
                <span class="sim-stat-value">${formatted}</span>
            </div>`;
        }).join('');

        // For Shadow Priest: visa hur mycket shadow power som kommer från random enchants
        let enchantNoteHtml = '';
        if ((isCaster || isHealer) && _lastSlotGroups) {
            let totalEnchantSP = 0;
            const enchantLines = [];
            for (const [slot, items] of Object.entries(_lastSlotGroups)) {
                const item = getActiveItem(slot, items);
                if (!item) continue;
                const key = String(item.itemId);
                const sp = RANDOM_ENCHANT_SHADOW_POWER[key];
                if (sp) {
                    totalEnchantSP += sp;
                    enchantLines.push(`${item.name || slot}: +${sp}`);
                }
            }
            if (totalEnchantSP > 0) {
                enchantNoteHtml = `<div class="sim-enchant-note">
                    <span class="sim-enchant-icon">🎲</span>
                    <span><strong>+${totalEnchantSP} sp</strong> från random enchants</span>
                    <span class="sim-enchant-detail">(${enchantLines.join(', ')})</span>
                </div>`;
            }
        }

        simStats.innerHTML = `<div class="sim-stat-grid${isTank ? ' sim-stat-grid--tank' : ''}">${rows}</div>${enchantNoteHtml}`;
    }

    // ─── Sim DPS Button ──────────────────────────────────────────────
    const simDpsBtn      = document.getElementById('simDpsBtn');
    const simDpsProgress = document.getElementById('simDpsProgress');
    const simDpsFill     = document.getElementById('simDpsFill');
    const simDpsStatus   = document.getElementById('simDpsStatus');
    const simDpsResult   = document.getElementById('simDpsResult');
    const simDpsNumber   = document.getElementById('simDpsNumber');
    const simDpsStdev    = document.getElementById('simDpsStdev');

    // Keep a reference to the latest slotGroups so the sim button can use them
    let _lastSlotGroups    = null;
    let _lastEnchantLookup = null;
    let _lastGems          = null;

    if (simDpsBtn) {
        simDpsBtn.addEventListener('click', async () => {
            if (!_lastSlotGroups || !_simReady) return;

            simDpsBtn.disabled = true;
            simDpsBtn.textContent = 'Simulating…';
            simDpsProgress.style.display = 'block';
            simDpsResult.style.display = 'none';
            simDpsFill.style.width = '0%';

            const wMode = typeof getWeaponMode === 'function' ? getWeaponMode(_lastSlotGroups) : null;
            const specKey = `${state.selectedClass}-${state.selectedSpec}`;
            const simFn = specKey === 'Warrior-Arms'   ? simulateArmsWarrior
                        : specKey === 'Priest-Shadow'   ? simulateShadowPriest
                        : specKey === 'Rogue-Dps'       ? simulateRogue
                        : specKey === 'Rogue-Combat'    ? simulateRogue
                        : specKey === 'Shaman-Enhancement' ? simulateEnhShaman
                        : specKey === 'Paladin-Retribution' ? simulateRetPaladin
                        : specKey === 'Druid-Cat'       ? simulateFeralDruid
                        : specKey === 'Druid-Balance'   ? simulateBalanceDruid
                        : specKey === 'Shaman-Elemental' ? simulateEleShaman
                        : specKey === 'Warlock-Affliction' ? simulateAfflictionWarlock
                        : specKey === 'Warlock-Destruction' ? simulateDestructionWarlock
                        : specKey === 'Warlock-Demonology' ? simulateDemonologyWarlock
                        : specKey === 'Mage-Fire' ? simulateFireMage
                        : specKey === 'Mage-Frost' ? simulateFrostMage
                        : specKey === 'Mage-Arcane' ? simulateArcaneMage
                        : specKey === 'Hunter-Beast Mastery' ? simulateBMHunter
                        : specKey === 'Hunter-Marksmanship' ? simulateMMHunter
                        : specKey === 'Hunter-Survival' ? simulateSurvivalHunter
                        : simulateFuryWarrior;

            try {
                const result = await simFn(
                    _lastSlotGroups,
                    getActiveItem,
                    wMode,
                    _lastEnchantLookup,
                    _lastGems,
                    p => {
                        const pct = p.totalIterations > 0
                            ? Math.round(p.completedIterations / p.totalIterations * 100) : 0;
                        simDpsFill.style.width = pct + '%';
                        simDpsStatus.textContent = `${p.completedIterations} / ${p.totalIterations}`;
                        if (p.dps > 0) simDpsNumber.textContent = Math.round(p.dps);
                    }
                );
                simDpsNumber.textContent = Math.round(result.avg);
                simDpsStdev.textContent  = `±${Math.round(result.stdev)} stdev`;
                simDpsResult.style.display = 'flex';
                simDpsProgress.style.display = 'none';
            } catch (e) {
                simDpsStatus.textContent = 'Error: ' + e.message.split('\n')[0];
            }

            simDpsBtn.disabled = false;
            simDpsBtn.textContent = '▶ Simulate DPS';
        });
    }

    // Trigger WASM init early (before user gets to the BiS list)
    if (typeof WowSimBridge !== 'undefined') {
        onSimReady(() => {}); // just warms up the worker
    }
    function srcEmoji(t) {
        return { Drop:'💀', Quest:'❗', Profession:'🔨', PvP:'⚔️', Vendor:'🏪', Reputation:'⭐',
                 Badge:'🎖️', 'Dungeon Token':'🎖️', Crafted:'🔨' }[t] || '📦';
    }

    // ─── Item Modal ──────────────────────────────────────────────────
    function openItemModal(itemId, slot) {
        const source = getItemSource(itemId);
        const iLvl = GearScore.estimateItemLevel(itemId, state.selectedPhase);
        const itemGS = GearScore.calcItemScore(iLvl, 4, slot);
        const gsColor = GearScore.getColor(itemGS * 16);

        const specData = findSpec(state.selectedClass, state.selectedSpec);
        const phaseData = specData?.phases[state.selectedPhase];
        const itemData = phaseData?.items.find(i => i.itemId === itemId);
        const itemName = itemData?.name || source?.name || `Item #${itemId}`;

        // Modal title with icon — plain text (Wowhead button is at the bottom)
        const modalIcon = itemIcon(itemId, 'large', 'modal-item-icon');
        modalTitle.innerHTML = `${modalIcon}<span class="${qualityClass(itemId)}">${itemName}</span>`;

        const enchant = phaseData?.enchants?.find(e => e.slot.split('~').some(s => s.trim() === slot));
        const enchSrc = enchant ? getEnchantSource(enchant.spellId) : null;
        // Build effective gem list for this specific item, matched to its sockets.
        // Only show gems that correspond to the item's actual socket colors — never
        // show a meta gem for a non-head slot that has no meta socket.
        const allPhaseGems = [...(phaseData?.gems || [])];
        let modalMetaGem = allPhaseGems.find(g => g.isMeta) || null;
        // Inherit meta gem from nearest phase if missing
        if (!modalMetaGem && specData && state.selectedPhase != null) {
            const phases = Object.keys(specData.phases).map(Number).sort();
            const lower = phases.filter(p => p < state.selectedPhase).reverse();
            const higher = phases.filter(p => p > state.selectedPhase);
            for (const p of [...lower, ...higher]) {
                const pg = specData.phases[p]?.gems || [];
                const found = pg.find(g => g.isMeta);
                if (found) { modalMetaGem = found; break; }
            }
        }
        const modalRegularGems = allPhaseGems.filter(g => !g.isMeta);

        // Match gems to this item's actual sockets (same logic as inline gem overlay)
        const itemSockets = (typeof ITEM_SOCKETS !== 'undefined' && ITEM_SOCKETS[itemId]) || null;
        let modalGems = []; // gems to display in modal
        if (itemSockets && itemSockets.length) {
            const seen = new Set();
            for (const socketColor of itemSockets) {
                let gem = null;
                if (socketColor === 'm') {
                    gem = modalMetaGem;
                } else {
                    // Same priority logic as matchGemsToSockets: exact > multi-color > any
                    let exact = null, multi = null;
                    for (const g of modalRegularGems) {
                        const gc = (typeof GEM_COLORS !== 'undefined' && GEM_COLORS[g.itemId]) || '';
                        if (!gc) { if (!multi) multi = g; continue; }
                        if (gc === socketColor) { exact = g; break; }
                        if (gc.includes(socketColor) && !multi) multi = g;
                    }
                    gem = exact || multi || (modalRegularGems.length ? modalRegularGems[0] : null);
                }
                if (gem && !seen.has(gem.itemId)) {
                    seen.add(gem.itemId);
                    modalGems.push(gem);
                }
            }
        } else {
            // Item has no socket data — fall back to showing all phase gems except meta
            // (don't assume there's a meta socket if we have no socket info)
            modalGems = modalRegularGems;
        }

        // Embedded Wowhead tooltip for item stats (especially useful on mobile)
        let html = `
            <div class="modal-wh-tooltip-wrap" data-wh-item-id="${toWhId(itemId)}"></div>
            <div class="modal-gs">
                <div class="modal-gs-box"><div class="modal-gs-label">Item GS</div><div class="modal-gs-val" style="color:${gsColor}">${itemGS}</div></div>
                <div class="modal-gs-box"><div class="modal-gs-label">Est. iLevel</div><div class="modal-gs-val">${iLvl}</div></div>
            </div>`;

        html += `<div class="modal-section"><div class="modal-section-title">How to Get</div>`;

        if (source) {
            html += `<div class="modal-row"><span class="modal-row-icon">${srcIcon(source.sourceType)}</span>
                <div><div class="modal-row-label">${source.sourceType}</div><div class="modal-row-value">${source.source || 'Unknown'}</div></div></div>`;
            if (source.sourceLocation)
                html += `<div class="modal-row"><span class="modal-row-icon">📍</span>
                    <div><div class="modal-row-label">Location</div><div class="modal-row-value">${source.sourceLocation}</div></div></div>`;
        } else {
            html += `<div class="modal-row"><span class="modal-row-icon">❓</span>
                <div><div class="modal-row-value">Source not in database</div><div class="modal-row-label">Item ID: ${itemId}</div></div></div>`;
        }
        html += '</div>';

        if (enchSrc) {
            html += `<div class="modal-section"><div class="modal-section-title">Recommended Enchant for ${slot}</div>
                <div class="modal-enchant-item"><span>✨</span><span>${whSpell(enchant.spellId, enchSrc.name)}</span></div>
                <div style="font-size:0.72rem;color:var(--text-muted);margin-top:4px;padding-left:4px;">
                    ${enchSrc.source ? 'From: '+enchSrc.source : ''}${enchSrc.sourceLocation ? ' — '+enchSrc.sourceLocation : ''}
                </div></div>`;
        }

        if (modalGems.length) {
            html += `<div class="modal-section"><div class="modal-section-title">Recommended Gems</div>`;
            for (const g of modalGems) {
                const gSrc = getGemSource(g.itemId);
                const gIcon = itemIcon(g.itemId, 'small', '');
                html += `<div class="modal-gem-item"><span class="modal-gem-icon">${gIcon}</span>
                    <span>${whItem(g.itemId, g.name || gSrc?.name || 'Gem #'+g.itemId)}</span></div>`;
            }
            html += '</div>';
        }

        // Prominent Wowhead button at the bottom
        html += `<a href="https://www.wowhead.com/${WH}/item=${toWhId(itemId)}" target="_blank" rel="noopener" class="modal-wowhead-btn">
            <img src="${WH_ICON_CDN}/small/inv_misc_note_01.jpg" alt="" class="modal-wowhead-icon" onerror="this.style.display='none'">
            View on Wowhead →
        </a>`;

        modalBody.innerHTML = html;
        // Wire up wh-item clicks inside the modal (gems in "Recommended Gems")
        modalBody.addEventListener('click', e => {
            const el = e.target.closest('[data-wh-item]');
            if (!el) return;
            e.preventDefault();
            e.stopPropagation();
            const id = el.dataset.whItem;
            const gemName = el.dataset.gemName;
            if (gemName !== undefined) {
                openGemModal(id, gemName || el.querySelector('img')?.alt || '');
            } else {
                openItemModal(id, '');
            }
        }, { once: true });
        modalOverlay.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        refreshWH();

        // Fetch Wowhead tooltip and embed inline for item stats
        embedWowheadTooltip(modalBody);
    }

    // ─── Shared: embed Wowhead tooltip inline ────────────────────────
    function embedWowheadTooltip(container) {
        try {
            const wrap = container.querySelector('.modal-wh-tooltip-wrap');
            if (!wrap) return;
            const whId = wrap.dataset.whItemId;
            const probe = document.createElement('a');
            probe.href = `https://www.wowhead.com/${WH}/item=${whId}`;
            probe.dataset.wowhead = `item=${whId}&domain=${WH}`;
            probe.style.cssText = 'position:absolute;left:-9999px;top:-9999px;';
            document.body.appendChild(probe);
            refreshWH();
            let attempts = 0;
            const poll = setInterval(() => {
                attempts++;
                try {
                    probe.dispatchEvent(new MouseEvent('mouseover', {bubbles:true}));
                    setTimeout(() => {
                        const ttNode = document.querySelector('.wowhead-tooltip');
                        if (ttNode && ttNode.innerHTML.length > 100) {
                            wrap.innerHTML = `<div class="modal-inline-tooltip">${ttNode.innerHTML}</div>`;
                            ttNode.style.display = 'none';
                            probe.dispatchEvent(new MouseEvent('mouseout', {bubbles:true}));
                            probe.remove();
                            clearInterval(poll);
                        } else if (attempts >= 8) {
                            probe.remove();
                            clearInterval(poll);
                        }
                    }, 100);
                } catch(e4) { clearInterval(poll); probe.remove(); }
            }, 400);
        } catch(e3) {}
    }

    // ─── Gem Modal ───────────────────────────────────────────────────
    function openGemModal(itemId, gemName) {
        const source = getGemSource(itemId);
        const iconName = (typeof ICONS !== 'undefined' && ICONS[itemId]) || 'inv_misc_gem_01';

        modalTitle.innerHTML = `
            <span class="icon-link"><img src="${WH_ICON_CDN}/large/${iconName}.jpg" alt="" class="modal-item-icon" onerror="this.src='${WH_ICON_CDN}/large/inv_misc_questionmark.jpg'"></span>
            <span class="${qualityClass(itemId)}">${gemName || 'Gem #'+itemId}</span>`;

        let html = `<div class="modal-wh-tooltip-wrap" data-wh-item-id="${toWhId(itemId)}"></div>`;
        if (source) {
            html += `<div class="modal-section"><div class="modal-section-title">How to Get</div>
                <div class="modal-row"><span class="modal-row-icon">📦</span>
                    <div><div class="modal-row-label">Source</div><div class="modal-row-value">${source.source || 'Unknown'}</div></div></div>`;
            if (source.sourceLocation)
                html += `<div class="modal-row"><span class="modal-row-icon">📍</span>
                    <div><div class="modal-row-label">Location</div><div class="modal-row-value">${source.sourceLocation}</div></div></div>`;
            html += '</div>';
        } else {
            html += `<div class="modal-section"><div class="modal-row"><span class="modal-row-icon">❓</span>
                <div><div class="modal-row-value">Source not in database</div><div class="modal-row-label">Item ID: ${itemId}</div></div></div></div>`;
        }

        html += `<a href="https://www.wowhead.com/${WH}/item=${toWhId(itemId)}" target="_blank" rel="noopener" class="modal-wowhead-btn">
            View on Wowhead →
        </a>`;

        modalBody.innerHTML = html;
        modalOverlay.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        refreshWH();
        embedWowheadTooltip(modalBody);
    }

    // ─── Enchant Modal ───────────────────────────────────────────────
    function openEnchantModal(spellId, name, src) {
        modalTitle.innerHTML = `<span style="font-size:1.4rem;margin-right:10px">✨</span><span>${name}</span>`;

        let html = '';
        if (src) {
            html += `<div class="modal-section"><div class="modal-section-title">How to Get</div>
                <div class="modal-row"><span class="modal-row-icon">${srcIcon(src.sourceType)}</span>
                    <div><div class="modal-row-label">${src.sourceType}</div><div class="modal-row-value">${src.source || 'Unknown'}</div></div></div>`;
            if (src.sourceLocation)
                html += `<div class="modal-row"><span class="modal-row-icon">📍</span>
                    <div><div class="modal-row-label">Location</div><div class="modal-row-value">${src.sourceLocation}</div></div></div>`;
            html += '</div>';
        } else {
            html += `<div class="modal-section"><div class="modal-row"><span class="modal-row-icon">❓</span>
                <div><div class="modal-row-value">Source not in database</div><div class="modal-row-label">Spell ID: ${spellId}</div></div></div></div>`;
        }

        html += `<a href="https://www.wowhead.com/${WH}/spell=${spellId}" target="_blank" rel="noopener" class="modal-wowhead-btn">
            View on Wowhead →
        </a>`;

        modalBody.innerHTML = html;
        modalOverlay.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        refreshWH();
    }

    function closeModal() {
        modalOverlay.classList.add('hidden');
        document.body.style.overflow = '';
    }
    modalClose.addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

    function srcIcon(t) {
        return { Drop:'💀', Quest:'❗', Profession:'🔨', PvP:'⚔️', Vendor:'🏪', Reputation:'⭐', Badge:'🎖️' }[t] || '📦';
    }

    // ─── Static Pages (About / Privacy) ─────────────────────────────
    const stepStaticPage = $('stepStaticPage');
    const staticPageContent = $('staticPageContent');

    const STATIC_PAGES = {
        about: {
            title: 'About — TBC BiS Guide',
            description: 'About TBC BiS Guide — a community-driven Best in Slot gear guide for TBC Classic.',
            html: `
                <h1>About TBC BiS Guide</h1>
                <p>TBC BiS Guide is a free, community-driven tool that helps World of Warcraft: The Burning Crusade Classic players find the <strong>best in slot gear</strong> for every class, spec, and phase — from Pre-BiS dungeon gear all the way through Sunwell Plateau.</p>

                <h2>What we offer</h2>
                <ul>
                    <li>� <strong>WarcraftLogs meta gear</strong> — items ranked by what top parsers actually wear, per spec &amp; phase</li>
                    <li>�📋 <strong>Complete BiS lists</strong> for all 9 classes and every viable spec</li>
                    <li>💎 <strong>Gems &amp; enchants</strong> recommendations per phase</li>
                    <li>� <strong>Character stats</strong> computed via wowsims WASM engine — see your stats with buffs &amp; consumables</li>
                    <li>⚔️ <strong>DPS simulation</strong> for select specs</li>
                    <li>🏟️ <strong>PvP gear snapshots</strong> based on real arena data from Ironforge.pro</li>
                    <li>🔄 <strong>Phase-by-phase progression</strong> from P0 Pre-BiS to P5 Sunwell</li>
                </ul>

                <h2>How it works</h2>
                <p>Our PvE gear recommendations are powered by <strong>WarcraftLogs data</strong>. We analyze the gear worn by the top-performing players (by DPS or HPS parse) for each spec and content phase. Items are ranked by <strong>usage popularity</strong> — how many of the top parsers actually equip that item:</p>
                <ul>
                    <li>🥇 <strong>70%+</strong> — Meta pick. Almost everyone uses it.</li>
                    <li>🥈 <strong>40–69%</strong> — Strong pick. Widely used among top players.</li>
                    <li>🥉 <strong>15–39%</strong> — Viable pick. Used by a significant minority.</li>
                    <li>📊 <strong>&lt;15%</strong> — Niche pick. Situational or used by specific builds.</li>
                </ul>
                <p>This means you see what <em>actually works in practice</em>, not just theoretical best-in-slot. Some items may surprise you — real top players sometimes prefer unexpected gear due to set bonuses, hit caps, or fight-specific needs.</p>

                <h2>Credits &amp; Acknowledgements</h2>
                <p>This project wouldn't be possible without the amazing WoW community and open-source tools:</p>
                <ul class="credits-list">
                    <li>
                        <span class="credit-name"><a href="https://classic.warcraftlogs.com" target="_blank" rel="noopener">WarcraftLogs</a></span>
                        <span class="credit-desc">Top-parser gear data that powers our PvE recommendations. We analyze what the best players actually wear.</span>
                    </li>
                    <li>
                        <span class="credit-name"><a href="https://www.wowhead.com/tbc" target="_blank" rel="noopener">Wowhead</a></span>
                        <span class="credit-desc">Item data, icons, and tooltips. The backbone of WoW theorycrafting.</span>
                    </li>
                    <li>
                        <span class="credit-name"><a href="https://wowsims.github.io/tbc/" target="_blank" rel="noopener">wowsims / TBC</a></span>
                        <span class="credit-desc">The open-source WoW TBC simulator. We use their WASM engine for character stats and DPS simulation.</span>
                    </li>
                    <li>
                        <span class="credit-name"><a href="https://www.curseforge.com/wow/addons/atlaslootclassic" target="_blank" rel="noopener">AtlasLoot Classic</a></span>
                        <span class="credit-desc">Community BiS lists that form the foundation of our gear recommendations.</span>
                    </li>
                    <li>
                        <span class="credit-name"><a href="https://seventyupgrades.com" target="_blank" rel="noopener">Seventy Upgrades</a></span>
                        <span class="credit-desc">Inspiration for gear planning and stat computation UX.</span>
                    </li>
                </ul>

                <h2>Contact</h2>
                <p>Found a bug or have a suggestion? Open an issue on <a href="https://github.com/vexxacus/tbc-bis-guide" target="_blank" rel="noopener">GitHub</a>.</p>
            `
        },
        privacy: {
            title: 'Privacy Policy — TBC BiS Guide',
            description: 'Privacy Policy for TBC BiS Guide.',
            html: `
                <h1>Privacy Policy</h1>
                <p><em>Last updated: April 2026</em></p>

                <h2>Overview</h2>
                <p>TBC BiS Guide is a free tool for the World of Warcraft community. We respect your privacy and collect minimal data.</p>

                <h2>What we collect</h2>
                <ul>
                    <li><strong>Local storage:</strong> Your gear selections and UI preferences are saved in your browser's localStorage. This data never leaves your device.</li>
                    <li><strong>Firebase Hosting:</strong> Our site is hosted on Firebase (Google). Standard web server logs may include your IP address, browser type, and pages visited. See <a href="https://firebase.google.com/support/privacy" target="_blank" rel="noopener">Firebase Privacy Policy</a>.</li>
                </ul>

                <h2>What we don't collect</h2>
                <ul>
                    <li>We do not use analytics or tracking cookies</li>
                    <li>We do not collect personal information (name, email, etc.)</li>
                    <li>We do not sell or share any data with third parties</li>
                </ul>

                <h2>Third-party services</h2>
                <ul>
                    <li><strong>Wowhead tooltips:</strong> We load tooltip scripts from <code>wow.zamimg.com</code>. Wowhead may set cookies — see their <a href="https://www.wowhead.com/privacy" target="_blank" rel="noopener">Privacy Policy</a>.</li>
                    <li><strong>Google Fonts:</strong> We load the Inter font from Google Fonts. See <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Google's Privacy Policy</a>.</li>
                </ul>

                <h2>Your choices</h2>
                <p>You can clear your saved preferences at any time by clearing your browser's localStorage for this site. No account or login is required to use this tool.</p>

                <h2>Changes</h2>
                <p>We may update this policy occasionally. Changes will be reflected on this page with an updated date.</p>
            `
        },
        feedback: {
            title: 'Feedback & Roadmap — TBC BiS Guide',
            description: 'Submit feedback, report bugs, and see what features are planned or completed for TBC BiS Guide.',
            html: `
                <h1>Feedback & Roadmap</h1>
                <p>Help us improve! Submit your ideas, bug reports, or feature requests below. You can also see what we're working on and what's been completed.</p>

                <div class="feedback-form-wrap">
                    <h2>💡 Submit Feedback</h2>
                    <form id="feedbackForm" class="feedback-form">
                        <div class="fb-field">
                            <label for="fbName">Name <span class="fb-optional">(optional)</span></label>
                            <input type="text" id="fbName" placeholder="Anonymous hero">
                        </div>
                        <div class="fb-field">
                            <label for="fbCategory">Category</label>
                            <select id="fbCategory">
                                <option value="bug">🐛 Bug Report</option>
                                <option value="feature">✨ Feature Request</option>
                                <option value="data">📊 Data Issue (wrong item/source)</option>
                                <option value="other">💬 Other</option>
                            </select>
                        </div>
                        <div class="fb-field">
                            <label for="fbMessage">Description</label>
                            <textarea id="fbMessage" rows="4" placeholder="Describe the bug or feature you'd like to see..." required></textarea>
                        </div>
                        <button type="submit" class="fb-submit">Submit Feedback</button>
                        <div id="fbSuccess" class="fb-success hidden">✅ Thanks for your feedback! We'll review it soon.</div>
                    </form>
                </div>

                <div id="feedbackBoard" class="feedback-board">
                    <p class="fb-loading">Loading roadmap...</p>
                </div>
            `,
            onLoad: function() { loadFeedbackBoard(); }
        }
    };

    function showStaticPage(page) {
        const data = STATIC_PAGES[page];
        if (!data) return;

        // Reset main app state
        state.selectedClass = null;
        state.selectedSpec  = null;
        state.selectedPhase = null;
        state.isPvP         = false;

        // Update header
        headerTitle.textContent = 'TBC Best in Slot';
        headerTitle.style.color = '';
        headerSub.textContent = '';

        // Hide all steps, show static page
        [stepClass, stepSpec, stepPhase, stepBis].forEach(s => s.classList.add('hidden'));
        staticPageContent.innerHTML = data.html;
        stepStaticPage.classList.remove('hidden');

        // Update SEO
        document.title = data.title;
        const metaDesc = document.getElementById('metaDescription');
        if (metaDesc) metaDesc.setAttribute('content', data.description);
        const canonical = document.getElementById('canonicalLink');
        if (canonical) canonical.setAttribute('href', `${BASE_URL}/${page}`);

        // Page-specific init
        if (data.onLoad) data.onLoad();

        // Scroll to top
        window.scrollTo(0, 0);
    }

    // ─── Feedback Board ─────────────────────────────────────────────
    function loadFeedbackBoard() {
        fetch('/feedback.json?v=' + Date.now())
            .then(r => r.json())
            .then(items => {
                const board = document.getElementById('feedbackBoard');
                if (!board) return;

                // Add user-submitted items from localStorage ("Under Review")
                const userItems = JSON.parse(localStorage.getItem('fb_submissions') || '[]');

                const groups = { review: [], done: [], backlog: [], rejected: [] };
                for (const item of items) { (groups[item.status] || groups.backlog).push(item); }
                for (const item of userItems) { groups.review.push(item); }

                const catIcon = { bug: '🐛', feature: '✨', data: '📊', other: '💬' };
                const statusIcon = { review: '🔍', done: '✅', backlog: '📋', rejected: '❌' };
                const statusLabel = { review: 'Under Review (yours)', done: 'Completed', backlog: 'Planned / Backlog', rejected: 'Not Planned' };

                function renderSection(key) {
                    const list = groups[key];
                    if (!list.length) return '';
                    let h = `<div class="fb-section">
                        <h2>${statusIcon[key]} ${statusLabel[key]} <span class="fb-count">(${list.length})</span></h2>
                        <div class="fb-items">`;
                    for (const item of list) {
                        h += `<div class="fb-item fb-item-${key}">
                            <span class="fb-cat">${catIcon[item.category] || '💬'}</span>
                            <div class="fb-item-body">
                                <div class="fb-item-title">${item.title}</div>
                                <div class="fb-item-desc">${item.description || ''}</div>
                                ${item.date ? `<div class="fb-item-date">${item.date}</div>` : ''}
                            </div>
                        </div>`;
                    }
                    h += '</div></div>';
                    return h;
                }

                let html = renderSection('review') + renderSection('done') + renderSection('backlog') + renderSection('rejected');
                if (!html) html = '<p style="color:var(--text-muted)">No feedback items yet. Be the first!</p>';
                board.innerHTML = html;
            })
            .catch(() => {
                const board = document.getElementById('feedbackBoard');
                if (board) board.innerHTML = '<p>Could not load roadmap.</p>';
            });

        // Form submit → Web3Forms API (free, no account needed for user)
        setTimeout(() => {
            const form = document.getElementById('feedbackForm');
            if (!form) return;
            form.addEventListener('submit', e => {
                e.preventDefault();

                // Rate limit: 1 submission per hour per browser
                const lastSent = localStorage.getItem('fb_last_sent');
                if (lastSent && Date.now() - parseInt(lastSent) < 3600000) {
                    alert('You already submitted feedback recently. Please wait a bit before sending more.');
                    return;
                }

                const name = document.getElementById('fbName').value.trim() || 'Anonymous';
                const category = document.getElementById('fbCategory').value;
                const message = document.getElementById('fbMessage').value.trim();
                if (!message) return;

                const btn = form.querySelector('.fb-submit');
                btn.disabled = true;
                btn.textContent = 'Sending...';

                fetch('https://api.web3forms.com/submit', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        access_key: 'f9b4c65d-dae7-4dbc-a4b2-28cc12fc7aed',
                        subject: '[TBC BiS Feedback] ' + category + ': ' + message.slice(0, 60),
                        from_name: name,
                        category: category,
                        message: message,
                        botcheck: ''
                    })
                }).then(r => r.json()).then(data => {
                    btn.disabled = false;
                    btn.textContent = 'Submit Feedback';
                    if (data.success) {
                        localStorage.setItem('fb_last_sent', Date.now().toString());
                        // Save to localStorage so it appears immediately under "Under Review"
                        const subs = JSON.parse(localStorage.getItem('fb_submissions') || '[]');
                        subs.unshift({ title: message.slice(0, 80), description: message, category: category, date: new Date().toISOString().slice(0,10) });
                        localStorage.setItem('fb_submissions', JSON.stringify(subs.slice(0, 20)));
                        document.getElementById('fbSuccess').classList.remove('hidden');
                        form.reset();
                        // Re-render board to show the new item
                        loadFeedbackBoard();
                        setTimeout(() => {
                            const s = document.getElementById('fbSuccess');
                            if (s) s.classList.add('hidden');
                        }, 5000);
                    } else {
                        alert('Could not send feedback. Please try again later.');
                    }
                }).catch(() => {
                    btn.disabled = false;
                    btn.textContent = 'Submit Feedback';
                    alert('Network error. Please try again.');
                });
            });
        }, 100);
    }

    // Footer link clicks — SPA navigation
    document.addEventListener('click', e => {
        const link = e.target.closest('.footer-link[data-page]');
        if (!link) return;
        e.preventDefault();
        const page = link.dataset.page;
        history.pushState({}, '', `/${page}`);
        showStaticPage(page);
    });

    // ─── Browser back/forward (popstate) ────────────────────────────
    // When the user presses the browser's Back/Forward buttons, re-read the URL
    // and restore state accordingly.
    window.addEventListener('popstate', () => {
        // Reset all navigation state before re-applying from URL
        state.selectedClass = null;
        state.selectedSpec  = null;
        state.selectedPhase = null;
        state.isPvP         = false;
        state.pvpKey        = null;
        state.history       = [];
        state.excludedProfessions = new Set();

        headerTitle.textContent = 'TBC Best in Slot';
        headerTitle.style.color = '';
        headerSub.textContent = 'Choose your class';

        // Hide static page if it was showing
        if (stepStaticPage) stepStaticPage.classList.add('hidden');

        const restored = restoreFromUrl();
        if (!restored) {
            showStep(stepClass);
        }
        updateSeoMeta();
    });

    // ─── Initialise hints ────────────────────────────────────────────
    // Hide the static class-pick hint if already dismissed
    if (_dismissed.has('class-pick')) {
        const h = $('hintClass');
        if (h) h.remove();
    }
    bindHintDismiss(document);

    // ─── URL-based initialisation ────────────────────────────────────
    // If the page was loaded with a deep URL (e.g. /warrior/fury/phase-2),
    // restore state from it instead of showing the class-select screen.
    {
        const didRestore = restoreFromUrl();
        if (!didRestore) {
            // Replace the current history entry with the canonical root path
            history.replaceState({}, '', '/');
        }
        updateSeoMeta();
    }
})();
