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
        'pre-bis': 0, 'phase-1': 1, 'phase-2': 2,
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

        // Static pages: /about, /privacy
        if (parts[0] === 'about' || parts[0] === 'privacy') {
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

    const BASE_URL = 'https://tbc-bis-guide.web.app';

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
            metaDesc  = 'Complete TBC Classic Best in Slot gear guide for every class and spec — Pre-BiS through Sunwell. Includes enchants, gems, and phase-by-phase progression.';
            path      = '/';
        } else if (!state.selectedSpec) {
            pageTitle = `${state.selectedClass} BiS Guide — TBC Classic`;
            metaDesc  = `Best in Slot gear lists for every ${state.selectedClass} spec in TBC Classic — from Pre-BiS dungeons to Sunwell Plateau.`;
            path      = `/${toSlug(state.selectedClass)}`;
        } else if (state.isPvP) {
            pageTitle = `${state.selectedSpec} ${state.selectedClass} PvP BiS — TBC Classic`;
            metaDesc  = `Live arena snapshot of the best gear for ${state.selectedSpec} ${state.selectedClass} PvP in TBC Classic, based on what the highest-rated arena players are wearing right now.`;
            path      = `/${toSlug(state.selectedClass)}/${toSlug(state.selectedSpec)}/pvp`;
        } else if (state.selectedPhase == null) {
            pageTitle = `${state.selectedSpec} ${state.selectedClass} BiS Guide — TBC Classic`;
            metaDesc  = `Best in Slot gear for ${state.selectedSpec} ${state.selectedClass} in TBC Classic. Choose a phase to see the full gear list.`;
            path      = `/${toSlug(state.selectedClass)}/${toSlug(state.selectedSpec)}`;
        } else {
            const phInfo  = PHASE_NAMES[state.selectedPhase] || { label: `Phase ${state.selectedPhase}` };
            const phSlug  = PHASE_TO_SLUG[state.selectedPhase] || `phase-${state.selectedPhase}`;
            const specDesc = generateSpecDescription(state.selectedClass, state.selectedSpec, state.selectedPhase);
            pageTitle = `${state.selectedSpec} ${state.selectedClass} ${phInfo.label} BiS — TBC Classic`;
            metaDesc  = specDesc || `Best in Slot gear for ${state.selectedSpec} ${state.selectedClass} in TBC Classic ${phInfo.label}. Full gear list with enchants, gems, and item sources.`;
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
        'Warrior-Fury': {
            0: "Pre-raid Fury Warriors dual-wield Dragonmaw main-hand with Blinkstrike off-hand. Chestguard of Exile, Fel Leather Gloves and Boots form the armor base alongside Ragesteel Shoulders. Badge of the Swarmguard is the premier trinket, with Bloodlust Brooch as an alternative.",
            1: "Phase 1 Fury BiS features Dragonspine Trophy as the defining trinket. Dragonmaw stays in the main hand with Gladiator's Slicer or Cleaver off-hand. Warbringer Battle-Helm leads the T4 pieces. Terrorweave Tunic replaces the chest slot, and Scaled Greaves of the Marksman fill the legs.",
            2: "Phase 2 Fury Warriors upgrade to Dragonstrike (Blacksmithing BoP) main-hand and Talon of Azshara off-hand. Destroyer Battle-Helm, Shoulderblades, Breastplate and Gauntlets form the T5 core. Belt of One-Hundred Deaths and Warboots of Obliteration are key pieces. Dragonspine Trophy and Tsunami Talisman define the trinket setup.",
            3: "Black Temple Fury Warriors aim for Warglaives of Azzinoth in both hands. Onslaught Shoulderblades and Breastplate anchor the T6 set. Cursed Vision of Sargeras fills the head slot. Dragonspine Trophy and Madness of the Betrayer are the top trinkets. Grips of Silent Justice and Dreadboots of the Legion complete the set.",
            4: "Phase 4 keeps Warglaives in the main hand with Vengeful Gladiator's Cleaver off-hand. The armor setup remains Onslaught T6 with Cursed Vision of Sargeras. Dragonspine Trophy stays as the top trinket alongside Madness of the Betrayer. Choker of Endless Nightmares and Stormrage Signet Ring anchor the jewellery.",
            5: "Sunwell Fury BiS keeps Warglaive of Azzinoth main-hand with Brutal Gladiator's Slicer off-hand. Coif of Alleria replaces the head; Bladed Chaos Tunic and Pauldrons of Berserking are key Sunwell pieces. Onslaught Bracers, Belt and Treads fill the set. Blackened Naaru Sliver and Shard of Contempt are the premier trinkets."
        },
        'Warrior-Arms': {
            0: "Pre-raid Arms Warriors wield Lionheart Champion (Blacksmithing BoP) as the premier two-hander. Mask of the Deceiver, Ragesteel Shoulders and Chestguard of Exile form the armor base. Badge of the Swarmguard and Bloodlust Brooch are key trinkets. Fel Leather pieces fill hands and feet.",
            1: "Phase 1 Arms BiS features Lionheart Champion with Dragonspine Trophy as the standout trinket. Warbringer Battle-Helm, Ripfiend Shoulderplates and Terrorweave Tunic are key armor pieces. Blinkstrike is an alternative weapon; Gauntlets of Martial Perfection and Scaled Greaves of the Marksman fill the set.",
            2: "Phase 2 Arms Warriors upgrade to Twinblade of the Phoenix or pursue Talon of Azshara MH with Merciless Gladiator's Quickblade OH for dual-wield. Destroyer Battle-Helm and Breastplate anchor the T5 core. Belt of One-Hundred Deaths and Bracers of Eradication are key off-pieces. Dragonspine Trophy and Tsunami Talisman define the trinkets.",
            3: "Black Temple Arms BiS centres on Warglaives of Azzinoth or Cataclysm's Edge as the two-hander. Onslaught Shoulderblades and Breastplate anchor the set. Cursed Vision of Sargeras fills the head. Dragonspine Trophy and Madness of the Betrayer are top trinkets. Grips of Silent Justice and Dreadboots of the Legion complete the set.",
            4: "Phase 4 Arms Warriors wield Cataclysm's Edge as the two-hander. Cursed Vision of Sargeras remains the head; Onslaught T6 carries over. Dragonspine Trophy and Berserker's Call define the trinket setup. Shadowmoon Destroyer's Drape fills the back.",
            5: "Sunwell Arms BiS peaks with Apolyon, the Soul-Render as the two-hander. Coif of Alleria and Pauldrons of Berserking are Sunwell upgrades. Bladed Chaos Tunic and Felfury Legplates round out the armor. Blackened Naaru Sliver and Shard of Contempt are the premier trinkets. Hard Khorium Choker (JC BoP) anchors the neck."
        },
        'Warrior-Protection': {
            0: "Pre-raid Protection Warriors reach the defense cap with Faceguard of Determination, Timewarden's Leggings and crafted plate. Dragonmaw provides threat; Azure-Shield of Coldarra fills the shield slot. Goblin Rocket Launcher is the top trinket. Breastplate of the Bold and Gauntlets of the Bold form the core.",
            1: "Phase 1 Prot BiS centres on Warbringer T4 from Karazhan/Gruul. Dragonmaw remains the main-hand; King's Defender is the top shield. Goblin Rocket Launcher continues as the premier trinket. Wrynn Dynasty Greaves fill the legs, and Drape of the Dark Reavers fills the back slot.",
            2: "Phase 2 upgrades include Destroyer Greathelm, Shoulderguards, Chestguard and Legguards from SSC/TK. Dragonstrike (BS BoP) is the top threat weapon; Fang of Vashj fills the shield slot. Royal Gauntlets of Silvermoon and Thalassian Wildercloak are key off-pieces.",
            3: "Black Temple Prot Warriors equip Faceplate of the Impenetrable and Vengeful Gladiator's Plate Chestpiece. The Brutalizer is the top threat weapon alongside Bulwark of Azzinoth as the shield (off-hand option). Onslaught Shoulderblades and Greaves fill T6 slots. Darkmoon Card: Vengeance is the defining trinket.",
            4: "Phase 4 refines with Vengeful Gladiator's Plate Shoulders and Legguards joining the set. The Brutalizer and Bulwark of Azzinoth remain. Bracers of the Ancient Phalanx and Brooch of Deftness are key upgrades. Darkmoon Card: Vengeance continues as the top trinket.",
            5: "Sunwell Prot BiS features Crown of Dath'Remar and Brutal Gladiator's Plate Shoulders and Chestpiece. Dragonscale-Encrusted Longblade is the top threat weapon; Sword Breaker's Bulwark is the best shield. Onslaught Wristguards and Waistguard fill the set. Commendation of Kael'thas is the defining trinket. Collar of the Pit Lord anchors the neck."
        },
        'Rogue-Dps': {
            0: "Pre-raid Rogues wield Dragonmaw main-hand with Latro's Shifting Sword off-hand. Wastewalker set pieces from heroic dungeons form the armor core. Mark of the Champion is the premier trinket alongside Bloodlust Brooch. Fel Leather Gloves and Boots round out the gear.",
            1: "Phase 1 Rogue BiS revolves around Dragonspine Trophy as the top trinket. Dragonmaw stays main-hand with Gladiator's Slicer off-hand. Netherblade Facemask and Chestpiece anchor the T4 core. Wastewalker Shoulderpads and Gloves fill remaining slots. Ring of a Thousand Marks is a key ring.",
            2: "Phase 2 Rogues upgrade to Talon of Azshara in both main-hand and off-hand. Deathmantle T5 Helm, Shoulderpads, Handguards and Legguards form the set core, paired with Bloodsea Brigand's Vest for the chest. Belt of One-Hundred Deaths fills the waist. Dragonspine Trophy and Tsunami Talisman are the top trinkets.",
            3: "Black Temple Rogues aim for Warglaives of Azzinoth — one in each hand. Slayer's T6 set from BT anchors the armor with Cursed Vision of Sargeras as the head. Dragonspine Trophy and Madness of the Betrayer are the top trinkets. Shadowmoon Destroyer's Drape fills the back.",
            4: "Phase 4 retains Warglaives main-hand with Vengeful Gladiator's Slicer off-hand. Slayer's T6 set continues with Cursed Vision of Sargeras. Dragonspine Trophy and Berserker's Call define the trinket setup. Stormrage Signet Ring and Signet of Primal Wrath fill the rings.",
            5: "Sunwell Rogue BiS keeps Warglaive of Azzinoth main-hand with Muramasa off-hand. Duplicitous Guise replaces the head; Bladed Chaos Tunic fills the chest. Slayer's Bracers, Belt and Boots from Sunwell upgrade the set. Blackened Naaru Sliver and Shard of Contempt are the premier trinkets."
        },
        'Druid-Balance': {
            0: "Pre-raid Balance Druids build around crafted Spellstrike Pants and Spellfire Robe for hit and damage. Atiesh, Greatstaff of the Guardian or Stormcaller main-hand with Talisman of Kalecgos off-hand handle the weapon setup. Icon of the Silver Crescent and Quagmirran's Eye are the key trinkets.",
            1: "Phase 1 Moonkin BiS centres on Collar of the Aldor head and Pauldrons of the Aldor shoulders. Spellfire Robe and Belt carry over. Talon of the Tempest is the top main-hand. The Lightning Capacitor is the defining trinket. Boots of Foretelling and Legwraps of the Aldor fill key slots.",
            2: "Phase 2 Balance Druids upgrade to Tirisfal T5 from SSC/TK — Cowl, Mantle, Robes and Leggings of Tirisfal. The Nexus Key is the best weapon. Mindstorm Wristbands and Cord of Screaming Terrors are strong off-pieces. Serpent-Coil Braid and The Lightning Capacitor define the trinket setup.",
            3: "Black Temple Moonkin gear transitions to Tempest T6 mixed with Tirisfal pieces. Zhar'doom, Greatstaff of the Devourer is the pinnacle staff. Cowl of the Illidari High Lord fills the head. The Skull of Gul'dan and Ashtongue Talisman of Acumen are the top trinkets. Leggings of Channeled Elements and Slippers of the Seacaller are BiS.",
            4: "Phase 4 refines with Hex Shrunken Head and Skull of Gul'dan as top trinkets. Zhar'doom remains the best staff. Brooch of Nature's Mercy upgrades the neck. Ring of Ancient Knowledge and Mana Attuned Band anchor the rings. The T6 Tempest set continues as the armor core.",
            5: "Sunwell Balance Druids peak with Grand Magister's Staff of Torrents or Sunflare plus Heart of the Pit. Dark Conjuror's Collar replaces the head; Tattered Cape of Antonidas fills the back. Robes of Ghostly Hatred and Leggings of Calamity are Sunwell upgrades. Shifting Naaru Sliver and The Skull of Gul'dan are the top trinkets."
        },
        'Druid-Bear': {
            0: "Pre-raid Feral Bear tanks stack stamina and armor with Wastewalker Helm, Shoulderpads and Leggings from heroics. Primalstrike Vest and Belt (Leatherworking BoP) provide strong stats. Mooncleaver or Sonic Spear is the weapon. Bloodlust Brooch and Badge of the Swarmguard are key trinkets.",
            1: "Phase 1 Bear BiS uses Cyclone T4 pieces with Wastewalker carry-overs. Mooncleaver or Staff of Beasts from Karazhan fills the weapon. Dragonspine Trophy is the defining trinket. Skulker's Greaves fill the legs, and Edgewalker Longboots the feet.",
            2: "Phase 2 Bear gear upgrades to Rift Stalker T5 from SSC/TK. Belt of One-Hundred Deaths and Belt of Deep Shadow are waist options. Thalassian Wildercloak fills the back. Dragonspine Trophy remains the premier trinket.",
            3: "Black Temple Bear Druids acquire Cursed Vision of Sargeras for the head. Gronnstalker's T6 pieces fill most slots. Shadowmaster's Boots anchor the feet. Dragonspine Trophy and Madness of the Betrayer are the top trinkets. Stormrage Signet Ring provides a key ring.",
            4: "Phase 4 Bear BiS refines with Dory's Embrace for the back and Signet of Primal Wrath for the ring. Dragonspine Trophy and Berserker's Call define the trinket setup. Gronnstalker's T6 set remains the core alongside Cursed Vision of Sargeras.",
            5: "Sunwell Bear BiS features Duplicitous Guise head and Demontooth Shoulderpads. Bladed Chaos Tunic and Leggings of the Immortal Night are peak Sunwell leather. Stanchion of Primal Instinct is the top weapon. Blackened Naaru Sliver and Shard of Contempt are the premier trinkets."
        },
        'Druid-Cat': {
            0: "Pre-raid Feral Cat Druids wear Wastewalker set (Helm, Shoulderpads, Tunic, Leggings) from heroics. Primalstrike Vest (LW BoP) is a strong chest alternative. Mooncleaver or Sonic Spear fills the weapon. Bloodlust Brooch and Badge of the Swarmguard are key trinkets. Vengeance Wrap fills the back.",
            1: "Phase 1 Cat BiS uses Cyclone T4 pieces with Skulker's Greaves and Edgewalker Longboots. Dragonspine Trophy is the defining trinket. Mooncleaver remains strong. Liar's Tongue Gloves and Wastewalker Gloves compete for the hands. Drape of the Dark Reavers fills the back.",
            2: "Phase 2 Cat Druids upgrade to Rift Stalker T5 from SSC/TK. Twinblade of the Phoenix or Talon of the Phoenix + Claw of the Phoenix fill the weapons. Belt of One-Hundred Deaths and Belt of Deep Shadow are key pieces. Dragonspine Trophy and Tsunami Talisman are the top trinkets.",
            3: "Black Temple Cat BiS features Cursed Vision of Sargeras head, Gronnstalker's T6 set pieces and Shadowmaster's Boots. Staff of the Forest Lord or Vengeful Gladiator's Staff fill the weapon. Dragonspine Trophy and Madness of the Betrayer define the trinket setup. Stormrage Signet Ring anchors the rings.",
            4: "Phase 4 adds Signet of Primal Wrath and Dory's Embrace. Berserker's Call joins Dragonspine Trophy as a top trinket. Bow-stitched Leggings from Zul'Aman provide a leg upgrade. The Gronnstalker/Cursed Vision core remains.",
            5: "Sunwell Cat BiS peaks with Duplicitous Guise head, Demontooth Shoulderpads and Bladed Chaos Tunic. Stanchion of Primal Instinct is the top staff. Leggings of the Immortal Night and Gloves of Immortal Dusk are key Sunwell pieces. Blackened Naaru Sliver and Shard of Contempt are the premier trinkets."
        },
        'Druid-Restoration': {
            0: "Pre-raid Resto Druids use Primal Mooncloth set (Shoulders, Robe, Belt) from Tailoring BoP. Whitemend Hood and Pants fill head and legs. Windhawk pieces are strong alternatives. Hand of Eternity or Gladiator's Salvation fill the main-hand with Tears of Heaven or Windcaller's Orb off-hand. Essence of the Martyr is the top trinket.",
            1: "Phase 1 Resto Druid BiS centres on Karazhan upgrades like Stainless Cloak of the Pure Hearted. Malorne T4 pieces provide armor alternatives. Light's Justice is the premier main-hand mace. Essence of the Martyr and Oshu'gun Relic are the top trinkets. Gilded Trousers of Benediction fill the legs.",
            2: "Phase 2 upgrades include Nordrassil T5 from SSC/TK. Lightfathom Scepter is the top main-hand. Sunshower Light Cloak fills the back. Essence of the Martyr remains the defining trinket. Grove-Bands of Remulos provide strong wrists. Ethereum Life-Staff is the top staff option.",
            3: "Black Temple Resto Druids equip Thunderheart T6 pieces alongside Crystal Spire of Karabor as the top main-hand. Memento of Tyrande joins Essence of the Martyr as a top trinket. Kilt of Immortal Nature fills the legs. Botanist's Gloves of Growth and Belt of Divine Guidance are key off-set pieces.",
            4: "Phase 4 upgrades to full Thunderheart T6 set. Crystal Spire of Karabor remains the weapon with Scepter of Purification off-hand. Brooch of Nature's Mercy upgrades the neck. Leggings of Eternity and Boots of the Divine Light fill legs and feet. Essence of the Martyr and Memento of Tyrande define the trinkets.",
            5: "Sunwell Resto Druid BiS features Cowl of Light's Purity, Spaulders of Reclamation and Sunglow Vest as Sunwell upgrades. Hammer of Sanctification is the top main-hand with Book of Highborne Hymns off-hand. Breeches of Natural Splendor fill the legs. Essence of the Martyr and Glimmering Naaru Sliver are key trinkets."
        },
        'Paladin-Holy': {
            0: "Pre-raid Holy Paladins build around Windhawk pieces (Hauberk, Bracers, Belt) alongside Hallowed Pauldrons and Pontifex Kilt. Gladiator's Salvation or Hand of Eternity fills the main-hand; Light-Bearer's Faith Shield fills the off-hand. Essence of the Martyr is the top trinket.",
            1: "Phase 1 Holy Paladin BiS centres on Justicar T4 set pieces from Karazhan/Gruul. Light's Justice is the premier main-hand mace; Light-Bearer's Faith Shield remains the shield. Essence of the Martyr continues as the top trinket. Legplates of the Innocent and Boots of Valiance fill legs and feet.",
            2: "Phase 2 upgrades to full Crystalforge T5 from SSC/TK. Lightfathom Scepter is the top main-hand; Talisman of the Sun King fills the off-hand. Girdle of Fallen Stars is the waist upgrade. Essence of the Martyr remains the defining trinket. Lord Sanguinar's Claim fills the neck.",
            3: "Black Temple Holy Paladins equip Lightbringer T6 Greathelm, Pauldrons, Chestpiece and Leggings. Crystal Spire of Karabor is the top main-hand; Felstone Bulwark is the best shield. Essence of the Martyr and Memento of Tyrande are top trinkets. Blessed Adamantite Bracers fill the wrists.",
            4: "Phase 4 adds Shroud of the Highborne for the back. Crystal Spire of Karabor remains the weapon. Memento of Tyrande and Essence of the Martyr continue as the top trinkets. Lightbringer T6 set carries over with Libram of Souls Redeemed as the relic upgrade.",
            5: "Sunwell Holy Paladin BiS features Helm of Burning Righteousness, Spaulders of the Thalassian Savior and Garments of Serene Shores. Hammer of Sanctification is the top main-hand; Aegis of Angelic Fortune is the best shield. Sunblessed Gauntlets (BS BoP) fill the hands. Glimmering Naaru Sliver is the defining trinket."
        },
        'Paladin-Protection': {
            0: "Pre-raid Prot Paladins stack spellpower and defense with Faceguard of Determination, Breastplate of the Righteous and Timewarden's Leggings. Gladiator's Gavel fills the main-hand; Crest of the Sha'tar is the top shield. Icon of the Silver Crescent is the key trinket for threat.",
            1: "Phase 1 Prot Pala BiS centres on Justicar T4 from Karazhan/Gruul. Gladiator's Gavel remains the main-hand; Aldori Legacy Defender is the best shield. Figurine of the Colossus and Moroes' Lucky Pocket Watch are key trinkets. Libram of Repentance fills the relic.",
            2: "Phase 2 upgrades include Crystalforge Faceguard and Legguards from SSC/TK. Merciless Gladiator's Gavel or Fang of the Leviathan provide the main-hand upgrade. Aldori Legacy Defender remains the shield. Royal Gauntlets of Silvermoon and Belt of the Guardian fill key slots.",
            3: "Black Temple Prot Paladins equip Faceplate of the Impenetrable head, Lightbringer T6 Shoulderguards, Chestguard, Handguards and Legguards. Tempest of Chaos is the top threat weapon; Bulwark of Azzinoth is the peak shield. Icon of the Silver Crescent and Pendant of Titans boost spell power for threat.",
            4: "Phase 4 continues with Tempest of Chaos and Bulwark of Azzinoth. Darkmoon Card: Vengeance becomes a top trinket. Ring of Sundered Souls and Libram of Repentance anchor the set. Lightbringer T6 remains the core armor.",
            5: "Sunwell Prot Paladin BiS features Helm of Uther's Resolve and Spaulders of the Thalassian Defender. Heroic Judicator's Chestguard and Judicator's Legguards fill the set. Brutal Gladiator's Gavel is the top weapon; Sword Breaker's Bulwark is the best shield. Commendation of Kael'thas is the defining trinket. Collar of the Pit Lord fills the neck."
        },
        'Paladin-Retribution': {
            0: "Pre-raid Ret Paladins wield Lionheart Champion (Blacksmithing BoP) as the premier two-hander. Mask of the Deceiver fills the head; Bulwark of Kings is the chest. Scrolls of Blinding Light and Bloodlust Brooch carry the trinket setup. Ragesteel Shoulders provide a strong shoulder option.",
            1: "Phase 1 Ret BiS keeps Lionheart Champion with Dragonspine Trophy as the must-have trinket. Justicar Crown and Ripfiend Shoulderplates anchor the head and shoulders. Bulwark of Kings carries over as the chest. Bladespire Warbands and Grips of Deftness fill wrists and hands.",
            2: "Phase 2 Ret Paladins upgrade to Lionheart Executioner (BS BoP). Crystalforge Breastplate from SSC/TK is the key armor piece. Belt of One-Hundred Deaths and Bracers of Eradication fill out the set. Bloodlust Brooch and Dragonspine Trophy define the trinkets. Furious Gizmatic Goggles (Engineering) fill the head.",
            3: "Black Temple Ret BiS centres on Torch of the Damned as the weapon. Cursed Vision of Sargeras fills the head. Lightbringer Breastplate and Greaves anchor the T6 set. Shoulderpads of the Stranger carry over. Bloodlust Brooch and Dragonspine Trophy remain top trinkets. Shadowmaster's Boots fill the feet.",
            4: "Phase 4 adds Cloak of Fiends and Midnight Chestguard. Torch of the Damned continues. Dragonspine Trophy and Berserker's Call define the trinkets. Bow-stitched Leggings from Zul'Aman provide a leg upgrade. Cursed Vision of Sargeras remains the head.",
            5: "Sunwell Ret BiS peaks with Apolyon, the Soul-Render as the weapon. Duplicitous Guise replaces the head; Bladed Chaos Tunic fills the chest. Felfury Legplates and Thalassian Ranger Gauntlets are Sunwell upgrades. Shard of Contempt and Blackened Naaru Sliver are the top trinkets. Hard Khorium Band (JC BoP) fills a ring slot."
        },
        'Hunter-Beast Mastery': {
            0: "Pre-raid BM Hunters wear the Beast Lord set (Helm, Mantle, Cuirass, Handguards, Leggings) from heroic dungeons. Claw of the Watcher main-hand with Void-Talon off-hand or Mooncleaver two-hand fill the melee. Wrathtide Longbow is the top ranged weapon. Bloodlust Brooch is the premier trinket.",
            1: "Phase 1 BM BiS retains Beast Lord set with Dragonspine Trophy as the defining trinket. Gronn-Stitched Girdle and Scaled Greaves of the Marksman upgrade waist and legs. Edgewalker Longboots fill the feet. Sunfury Bow of the Phoenix or Steelhawk Crossbow fill the ranged slot.",
            2: "Phase 2 BM Hunters equip full Rift Stalker T5 from SSC/TK. Twinblade of the Phoenix or Talon/Claw of the Phoenix pair are the top weapons. Serpent Spine Longbow fills the ranged. Belt of Deep Shadow and Cobra-Lash Boots are key pieces. Dragonspine Trophy and Tsunami Talisman are the top trinkets.",
            3: "Black Temple BM BiS centres on Gronnstalker's T6 set with Cursed Vision of Sargeras as the head. Dagger of Bad Mojo fills both weapon slots. Don Alejandro's Money Belt and Shadowmaster's Boots round out the set. Dragonspine Trophy and Madness of the Betrayer are the top trinkets.",
            4: "Phase 4 adds Shadowmoon Destroyer's Drape and Boneweave Girdle. Cursed Vision of Sargeras and Gronnstalker's T6 remain. Dragonspine Trophy and Shard of Contempt define the trinkets. Ancient Amani Longbow provides the ranged upgrade. Signet of Primal Wrath fills a ring slot.",
            5: "Sunwell BM Hunter BiS peaks with Coif of Alleria head and Bladed Chaos Tunic chest. Hand of the Deceiver main-hand with Crux of the Apocalypse off-hand. Gronnstalker's Spaulders, Bracers, Belt and Boots fill the T6 slots. Thori'dal, the Stars' Fury is the ultimate ranged weapon. Blackened Naaru Sliver and Shard of Contempt are the premier trinkets."
        },
        'Hunter-Marksmanship': {
            0: "Pre-raid MM Hunters wear the Beast Lord set from heroic dungeons. Claw of the Watcher main-hand with Claw of the Frost Wyrm off-hand fill the melee slots. Wrathtide Longbow or Valanos' Longbow fill the ranged. Bloodlust Brooch is the premier trinket. Choker of Vile Intent anchors the neck.",
            1: "Phase 1 MM BiS retains Beast Lord set pieces with Dragonspine Trophy as the top trinket. Guile of Khoraazi is a strong MH/OH option. Sunfury Bow of the Phoenix fills the ranged slot. Ring of the Recalcitrant is a key ring. Edgewalker Longboots fill the feet.",
            2: "Phase 2 MM Hunters equip full Rift Stalker T5 from SSC/TK. Twinblade of the Phoenix is the best weapon. Serpent Spine Longbow fills the ranged. Belt of Deep Shadow and Cobra-Lash Boots are key off-pieces. Dragonspine Trophy and Tsunami Talisman define the trinket setup.",
            3: "Black Temple MM BiS centres on Gronnstalker's T6 set with Cursed Vision of Sargeras head. Dagger of Bad Mojo fills both weapon slots. Don Alejandro's Money Belt and Shadowmaster's Boots round out the set. Dragonspine Trophy and Madness of the Betrayer are the top trinkets.",
            4: "Phase 4 adds Shadowmoon Destroyer's Drape, Boneweave Girdle and Signet of Primal Wrath. Dagger of Bad Mojo remains in both hands. Ancient Amani Longbow upgrades the ranged slot. Dragonspine Trophy and Shard of Contempt are the top trinkets.",
            5: "Sunwell MM Hunter BiS peaks with Coif of Alleria, Bladed Chaos Tunic and Leggings of the Immortal Night. Hand of the Deceiver main-hand with Crux of the Apocalypse off-hand. Thori'dal, the Stars' Fury or Golden Bow of Quel'Thalas fill the ranged. Blackened Naaru Sliver and Shard of Contempt are the premier trinkets."
        },
        'Hunter-Survival': {
            0: "Pre-raid Survival Hunters wear Beast Lord set pieces with Wastewalker Leggings. Stellaris and Guile of Khoraazi fill the dual-wield slots; Mooncleaver is the two-hand option. Bloodlust Brooch is the top trinket. Jagged Bark Pendant fills the neck; Felstalker Bracers fill the wrists.",
            1: "Phase 1 Survival BiS focuses on Beast Lord set with Dragonspine Trophy as the defining trinket. Stellaris fills both weapon slots; Guile of Khoraazi is a strong alternative. Scaled Greaves of the Marksman upgrade the legs. Legacy is the top two-hand option.",
            2: "Phase 2 Survival Hunters equip Rift Stalker T5 from SSC/TK. Netherbane main-hand with Claw of the Phoenix off-hand or Twinblade of the Phoenix two-hand fill the weapons. Belt of Deep Shadow and Cobra-Lash Boots are key pieces. Dragonspine Trophy and Tsunami Talisman are the top trinkets.",
            3: "Black Temple Survival BiS includes Gronnstalker's T6 set with Gronnstalker's Helmet (not Cursed Vision). Blade of Infamy fills both weapon slots. Bow-stitched Leggings and Shadowmaster's Boots anchor legs and feet. Dragonspine Trophy and Madness of the Betrayer are top trinkets.",
            4: "Phase 4 adds Dagger of Bad Mojo for both hands and Halberd of Desolation as two-hand option. Gronnstalker's T6 remains the core. Dragonspine Trophy and Shard of Contempt define the trinkets. Signet of Primal Wrath fills a ring slot.",
            5: "Sunwell Survival BiS peaks with Coif of Alleria, Bladed Chaos Tunic and Leggings of the Immortal Night. Hand of the Deceiver main-hand with Crux of the Apocalypse off-hand. Thalassian Ranger Gauntlets fill the hands. Blackened Naaru Sliver and Shard of Contempt are the premier trinkets. Clutch of Demise fills the neck."
        },
        'Mage-Arcane': {
            0: "Pre-raid Arcane Mages build around Spellfire Robe and Belt (Tailoring BoP) plus Spellstrike Pants. Stormcaller fills the main-hand; Talisman of Kalecgos the off-hand. Icon of the Silver Crescent and Quagmirran's Eye are key trinkets. Mana-Binders Cowl fills the head.",
            1: "Phase 1 Arcane BiS centres on Collar of the Aldor head and Pauldrons of the Aldor shoulders. Spellfire Robe, Gloves and Belt carry over. Talon of the Tempest is the top main-hand. The Lightning Capacitor is the defining trinket. Legwraps of the Aldor and Boots of Foretelling fill legs and feet.",
            2: "Phase 2 Arcane Mages upgrade to full Tirisfal T5 from SSC/TK. The Nexus Key is the best weapon. Mindstorm Wristbands and Cord of Screaming Terrors are key off-pieces. Serpent-Coil Braid and The Lightning Capacitor are the premier trinkets. Band of Eternity anchors the rings.",
            3: "Black Temple Arcane BiS retains Tirisfal T5 Cowl, Mantle, Robes, Gloves and Leggings. Zhar'doom, Greatstaff of the Devourer is the top staff. The Skull of Gul'dan is the defining trinket. Cuffs of Devastation, Anetheron's Noose and Slippers of the Seacaller fill off-set slots.",
            4: "Phase 4 continues with Tirisfal set and Zhar'doom. The Skull of Gul'dan and Hex Shrunken Head are the top trinkets. Brooch of Nature's Mercy upgrades the neck. Ring of Ancient Knowledge and Mana Attuned Band anchor the rings.",
            5: "Sunwell Arcane BiS peaks with Sunflare main-hand or Grand Magister's Staff of Torrents. Robes of Ghostly Hatred and Leggings of Calamity are Sunwell upgrades. Tattered Cape of Antonidas fills the back. Shifting Naaru Sliver and The Skull of Gul'dan are the top trinkets. Amulet of Unfettered Magics fills the neck."
        },
        'Mage-Fire': {
            0: "Pre-raid Fire Mages wear Spellfire Robe, Gloves and Belt (Tailoring BoP) with Spellstrike Pants. Eternium Runed Blade fills the main-hand; Flametongue Seal the off-hand. Quagmirran's Eye and Icon of the Silver Crescent are key trinkets. Mana-Etched Crown fills the head.",
            1: "Phase 1 Fire BiS features Collar of the Aldor head and Pauldrons of the Aldor shoulders. Spellfire set carries over. Talon of the Tempest is the top main-hand; Jewel of Infinite Possibilities fills the off-hand. Icon of the Silver Crescent and Quagmirran's Eye are the top trinkets. Ruby Drape of the Mysticant fills the back.",
            2: "Phase 2 Fire Mages equip Destruction Holo-gogs (Engineering), Mantle of the Elven Kings and Vestments of the Sea-Witch. Fang of the Leviathan is the top main-hand; The Nexus Key is the staff option. Sextant of Unstable Currents and The Lightning Capacitor are the premier trinkets. Belt of Blasting fills the waist.",
            3: "Black Temple Fire BiS centres on Tempest T6 — Cowl of the Illidari High Lord, Mantle, Robes, Gloves and Leggings of the Tempest. Zhar'doom, Greatstaff of the Devourer is the pinnacle staff. The Skull of Gul'dan is the defining trinket. Belt of Blasting and Bracers of Nimble Thought fill off-set slots.",
            4: "Phase 4 refines with Hex Shrunken Head joining The Skull of Gul'dan as top trinkets. Zhar'doom remains the staff. Tempest T6 carries over as the armor core. Hellfire-Encased Pendant fills the neck.",
            5: "Sunwell Fire BiS peaks with Sunflare main-hand or Grand Magister's Staff of Torrents. Dark Conjuror's Collar replaces the head; Sunfire Robe fills the chest. Tattered Cape of Antonidas fills the back. Shifting Naaru Sliver and The Skull of Gul'dan are the top trinkets. Leggings of Calamity upgrade the legs."
        },
        'Mage-Frost': {
            0: "Pre-raid Frost Mages build around Frozen Shadoweave set (Shoulders, Robe, Boots) from Tailoring BoP with Spellstrike Pants. Eternium Runed Blade fills the main-hand; Sapphiron's Wing Bone the off-hand. Quagmirran's Eye and Icon of the Silver Crescent are the key trinkets.",
            1: "Phase 1 Frost BiS features Collar of the Aldor head alongside Frozen Shadoweave Shoulders, Robe and Boots. Talon of the Tempest fills the main-hand; Sapphiron's Wing Bone the off-hand. Icon of the Silver Crescent and Quagmirran's Eye are top trinkets. Girdle of Ruination fills the waist.",
            2: "Phase 2 Frost Mages equip Tirisfal T5 from SSC/TK — Cowl, Mantle, Gloves and Leggings of Tirisfal with Vestments of the Sea-Witch chest. Fang of the Leviathan is the main-hand; Fathomstone the off-hand. Serpent-Coil Braid and The Lightning Capacitor are the premier trinkets.",
            3: "Black Temple Frost BiS features Cowl of the Illidari High Lord with Tempest T6 Mantle, Robes, Gloves and Leggings. Zhar'doom, Greatstaff of the Devourer is the pinnacle staff. The Skull of Gul'dan is the defining trinket. Bracers of Nimble Thought and Belt of Blasting fill off-set slots.",
            4: "Phase 4 refines with Waistwrap of Infinity and Brooch of Nature's Mercy. Zhar'doom continues as the staff. The Skull of Gul'dan and Hex Shrunken Head are the top trinkets. Mana Attuned Band fills a ring slot.",
            5: "Sunwell Frost BiS peaks with Sunflare main-hand or Grand Magister's Staff of Torrents. Dark Conjuror's Collar and Tattered Cape of Antonidas replace head and back. Sunfire Robe and Leggings of Calamity are Sunwell upgrades. Shifting Naaru Sliver and The Skull of Gul'dan are the top trinkets."
        },
        'Priest-Holy': {
            0: "Pre-raid Holy Priests use Primal Mooncloth set (Shoulders, Robe, Belt) from Tailoring BoP. Cowl of Naaru Blessings and Whitemend Pants fill head and legs. Hand of Eternity fills the main-hand; Windcaller's Orb the off-hand. Essence of the Martyr is the top trinket. Bindings of the Timewalker fill the wrists.",
            1: "Phase 1 Holy BiS centres on Light-Collar of the Incarnate from Karazhan with Primal Mooncloth Shoulders and Robe carrying over. Light's Justice is the top mace; Windcaller's Orb fills the off-hand. Essence of the Martyr remains the defining trinket. Gilded Trousers of Benediction and Boots of the Incorrupt fill legs and feet.",
            2: "Phase 2 upgrades to Avatar T5 from SSC/TK — Cowl, Mantle, Vestments, Gloves and Breeches. Lightfathom Scepter is the top main-hand; Ethereum Life-Staff is the staff option. Essence of the Martyr remains the top trinket. Belt of the Long Road and Soul-Strider Boots fill waist and feet.",
            3: "Black Temple Holy Priests equip Cowl of Absolution head with Avatar T5 carrying over in several slots. Crystal Spire of Karabor is the top main-hand; Scepter of Purification fills the off-hand. Darkmoon Card: Blue Dragon and Essence of the Martyr are the top trinkets. Swiftheal Wraps (Tailoring BoP) fill the wrists.",
            4: "Phase 4 upgrades to Absolution T6 — Cowl, Mantle, Vestments, Gloves. Achromic Trousers of the Naaru fill the legs. Crystal Spire of Karabor remains. Essence of the Martyr and Memento of Tyrande define the trinkets. Brooch of Nature's Mercy upgrades the neck.",
            5: "Sunwell Holy Priest BiS features Cowl of Light's Purity, Shawl of Wonderment and Robes of Faltered Light. Hammer of Sanctification is the top main-hand. Cuffs of Absolution and Belt of Absolution fill the set. Essence of the Martyr remains the defining trinket. Blessed Band of Karabor anchors the rings."
        },
        'Priest-Shadow': {
            0: "Pre-raid Shadow Priests core around Frozen Shadoweave (Tailoring BoP) Shoulders, Robe and Boots with Spellstrike Hood and Pants. Gavel of Unearthed Secrets fills the main-hand; Orb of the Soul-Eater the off-hand. Icon of the Silver Crescent and Quagmirran's Eye are the key trinkets.",
            1: "Phase 1 Shadow BiS keeps Frozen Shadoweave and Spellstrike pieces. Nathrezim Mindblade is the top main-hand; Orb of the Soul-Eater remains the off-hand. Icon of the Silver Crescent and Quagmirran's Eye are top trinkets. Random-suffix pieces with Shadow Wrath are used in several slots.",
            2: "Phase 2 Shadow Priests equip Destruction Holo-gogs (Engineering), Wings of the Avatar shoulders and Vestments of the Sea-Witch. Merciless Gladiator's Gavel is the top main-hand; The Nexus Key is the staff option. Icon of the Silver Crescent continues. Trousers of the Astromancer fill the legs.",
            3: "Black Temple Shadow BiS centres on Absolution T6 — Hood, Shoulderpads, Shroud and Handguards. Zhar'doom, Greatstaff of the Devourer or The Maelstrom's Fury + Orb of the Soul-Eater fill the weapons. Darkmoon Card: Crusade and The Skull of Gul'dan are the defining trinkets. Bracers of Nimble Thought fill the wrists.",
            4: "Phase 4 adds Hex Shrunken Head and Loop of Cursed Bones. Zhar'doom becomes the best staff. Absolution T6 carries over. Slippers of the Seacaller fill the feet. Ring of Ancient Knowledge and Mana Attuned Band anchor the rings.",
            5: "Sunwell Shadow Priest BiS peaks with Dark Conjuror's Collar head and Sunfire Robe chest. Sunflare main-hand or Zhar'doom staff. Tattered Cape of Antonidas fills the back. Shifting Naaru Sliver and Hex Shrunken Head are the top trinkets. Leggings of Calamity and Ring of Omnipotence are key upgrades."
        },
        'Shaman-Elemental': {
            0: "Pre-raid Elemental Shamans stack spell hit with Netherstrike set (Breastplate, Bracers, Belt) from Leatherworking BoP and Spellstrike Pants. Gladiator's Gavel fills the main-hand; Khadgar's Knapsack the off-hand. Icon of the Silver Crescent is the top trinket. Storm Master's Helmet fills the head.",
            1: "Phase 1 Elemental BiS centres on Cyclone T4 from Karazhan/Gruul. Talon of the Tempest is the top main-hand; Khadgar's Knapsack remains the off-hand. The Lightning Capacitor is the defining trinket. Totem of the Void is the core relic. Netherstrike pieces carry over.",
            2: "Phase 2 Elemental Shamans upgrade to Cataclysm T5 from SSC/TK with Cyclone Faceguard and Shoulderguards retained. The Nexus Key is the top staff. Belt of Blasting fills the waist. Mark of the Champion and The Lightning Capacitor are the premier trinkets. Totem of the Void carries over.",
            3: "Black Temple Elemental BiS centres on Skyshatter T6 Headguard and Legguards with Hauberk of the Furious Elements chest. Zhar'doom, Greatstaff of the Devourer is the top staff. The Skull of Gul'dan is the defining trinket. Skycall Totem upgrades the relic. Mantle of Nimble Thought fills the shoulders.",
            4: "Phase 4 upgrades to full Skyshatter T6 set. Zhar'doom remains the staff. Mark of the Champion continues alongside The Skull of Gul'dan. Totem of Ancestral Guidance is the top relic. Flashfire Girdle fills the waist. Brooch of Nature's Mercy upgrades the neck.",
            5: "Sunwell Elemental BiS peaks with Cowl of Gul'dan and Sunfire Robe. Sunflare main-hand or Zhar'doom staff. Tattered Cape of Antonidas fills the back. Shifting Naaru Sliver and The Skull of Gul'dan are the top trinkets. Chain Links of the Tumultuous Storm fill the legs. Pendant of Sunfire anchors the neck."
        },
        'Shaman-Enhancement': {
            0: "Pre-raid Enhancement Shamans wield Gladiator's Right Ripper main-hand with Gladiator's Cleaver off-hand. Primalstrike Vest and Belt (LW BoP) fill the chest and waist. Wastewalker Helm and Shoulderpads fill head and shoulders. Bloodlust Brooch is the top trinket. Vengeance Wrap fills the back.",
            1: "Phase 1 Enhancement BiS centres on Dragonspine Trophy as the defining trinket. Gladiator's Right Ripper and Cleaver remain the weapons. Cyclone T4 Helm and Shoulderplates provide armor upgrades. Terrorweave Tunic and Ebon Netherscale pieces fill out the set. Liar's Tongue Gloves are the top hand option.",
            2: "Phase 2 Enhancement Shamans upgrade to Cataclysm T5 from SSC/TK. Rod of the Sun King fills both weapon slots. Belt of One-Hundred Deaths and Boots of Utter Darkness (LW BoP) are key pieces. Shoulderpads of the Stranger fill the shoulders. Dragonspine Trophy and Bloodlust Brooch are the top trinkets.",
            3: "Black Temple Enhancement BiS features Cursed Vision of Sargeras head, Nether Shadow Tunic chest and Shoulders of Lightning Reflexes. Claw of Molten Fury main-hand with Rod of the Sun King off-hand fill the weapons. Mark of the Champion and Dragonspine Trophy are top trinkets. Stonebreaker's Totem is the relic.",
            4: "Phase 4 adds Swiftstrike Shoulders (LW BoP) and Midnight Chestguard. Vengeful Gladiator's Cleaver fills both weapon slots. Dragonspine Trophy and Shard of Contempt define the trinkets. Bow-stitched Leggings and Softstep Boots fill legs and feet. Stormrage Signet Ring anchors the rings.",
            5: "Sunwell Enhancement BiS peaks with Duplicitous Guise head and Bladed Chaos Tunic chest. Hand of the Deceiver main-hand with Brutal Gladiator's Cleaver off-hand. Demontooth Shoulderpads and Leggings of the Immortal Night are key pieces. Blackened Naaru Sliver and Shard of Contempt are the premier trinkets."
        },
        'Shaman-Restoration': {
            0: "Pre-raid Resto Shamans wear Primal Mooncloth Shoulders and Robe alongside Windhawk Bracers and Belt. Whitemend Hood fills the head. Hand of Eternity fills the main-hand; Light-Bearer's Faith Shield the off-hand. Essence of the Martyr is the top trinket. Serpentcrest Life-Staff is the staff option.",
            1: "Phase 1 Resto Shaman BiS features Cyclone T4 Shoulderpads with Windhawk Hauberk, Bracers and Belt carrying over. Light's Justice is the top main-hand; Tears of Heaven fills the off-hand. Essence of the Martyr remains the defining trinket. Totem of Healing Rains is the best relic. Gilded Trousers of Benediction fill the legs.",
            2: "Phase 2 upgrades to Cataclysm T5 from SSC/TK — Headguard, Shoulderguards, Chestguard and Leggings. Lightfathom Scepter is the top main-hand; Aegis of the Vindicator fills the off-hand. Essence of the Martyr remains the top trinket. Sunhawk Leggings fill the legs. Girdle of Fallen Stars fills the waist.",
            3: "Black Temple Resto Shamans equip Skyshatter T6 Helmet with Cataclysm T5 pieces carrying over. Crystal Spire of Karabor is the top main-hand; Aegis of the Vindicator remains the off-hand. Tome of Diabolic Remedy and Essence of the Martyr are top trinkets. Totem of Living Water upgrades the relic.",
            4: "Phase 4 upgrades to full Skyshatter T6 set. Crystal Spire of Karabor remains with Bastion of Light off-hand. Memento of Tyrande and Essence of the Martyr define the trinkets. Brooch of Nature's Mercy upgrades the neck. Living Earth Bindings and Treads of the Life Path fill wrists and feet.",
            5: "Sunwell Resto Shaman BiS features Shroud of Chieftain Ner'zhul head and Sun-Drenched Scale Chestguard (LW BoP). Hammer of Sanctification is the top main-hand; Book of Highborne Hymns fills the off-hand. Redeemer's Alchemist Stone and Glimmering Naaru Sliver are key trinkets. Totem of Healing Rains continues as the relic."
        },
        'Warlock-Affliction': {
            0: "Pre-raid Affliction Warlocks build around Frozen Shadoweave (Tailoring BoP) Shoulders, Robe and Boots with Spellstrike Hood and Pants. Blade of Wizardry fills the main-hand; Khadgar's Knapsack the off-hand. Icon of the Silver Crescent is the top trinket. Rockfury Bracers and Girdle of Ruination fill wrists and waist.",
            1: "Phase 1 Affliction BiS centres on Voidheart T4 Crown, Mantle, Robe and Gloves. Atiesh, Greatstaff of the Guardian is the top staff. Quagmirran's Eye and Icon of the Silver Crescent are top trinkets. Spellstrike Pants carry over. Ruby Drape of the Mysticant fills the back.",
            2: "Phase 2 Affliction Warlocks equip Destruction Holo-gogs (Engineering) with Voidheart Mantle and Gloves carrying over. Vestments of the Sea-Witch fills the chest. Merciless Gladiator's Spellblade is the top main-hand; Fathomstone the off-hand. Mark of the Champion is the defining trinket.",
            3: "Black Temple Affliction BiS centres on Malefic T6 — Hood, Mantle, Gloves and Leggings. Vestments of the Sea-Witch carries over as chest. Zhar'doom, Greatstaff of the Devourer is the top staff. The Skull of Gul'dan is the defining trinket. Nethervoid Cloak fills the back.",
            4: "Phase 4 refines with Shroud of the Highborne back and Tempest of Chaos main-hand with Chronicle of Dark Secrets off-hand. The Skull of Gul'dan and Hex Shrunken Head are the top trinkets. Translucent Spellthread Necklace fills the neck. Mana Attuned Band anchors a ring slot.",
            5: "Sunwell Affliction BiS peaks with Dark Conjuror's Collar head and Amice of the Convoker shoulders. Sunfire Robe fills the chest. Sunflare main-hand with Heart of the Pit off-hand, or Grand Magister's Staff of Torrents. Shifting Naaru Sliver and The Skull of Gul'dan are the premier trinkets. Pendant of Sunfire fills the neck."
        },
        'Warlock-Demonology': {
            0: "Pre-raid Demonology Warlocks wear Frozen Shadoweave (Tailoring BoP) Shoulders, Robe and Boots with Spellstrike Hood and Pants. Blade of Wizardry fills the main-hand; Khadgar's Knapsack the off-hand. Icon of the Silver Crescent is the top trinket. Rockfury Bracers and Girdle of Ruination fill wrists and waist.",
            1: "Phase 1 Demo BiS centres on Voidheart T4 Crown, Mantle, Robe and Gloves. Atiesh, Greatstaff of the Guardian is the top staff. Quagmirran's Eye and Icon of the Silver Crescent are top trinkets. Anger-Spark Gloves compete for the hands. Ruby Drape of the Mysticant fills the back.",
            2: "Phase 2 Demonology upgrades with Destruction Holo-gogs (Engineering) and Royal Cloak of the Sunstriders. Vestments of the Sea-Witch fills the chest. Merciless Gladiator's Spellblade is the top main-hand; Khadgar's Knapsack remains the off-hand. Void Star Talisman is the defining trinket.",
            3: "Black Temple Demo BiS centres on Malefic T6 — Hood, Mantle, Gloves and Leggings with Vestments of the Sea-Witch chest. Zhar'doom, Greatstaff of the Devourer is the top staff. The Skull of Gul'dan is the defining trinket. Shroud of the Highborne fills the back.",
            4: "Phase 4 adds Tempest of Chaos main-hand with Chronicle of Dark Secrets off-hand as an alternative to Zhar'doom. The Skull of Gul'dan and Hex Shrunken Head are the top trinkets. Translucent Spellthread Necklace fills the neck. Mana Attuned Band and Ring of Ancient Knowledge anchor the rings.",
            5: "Sunwell Demonology BiS peaks with Dark Conjuror's Collar head and Amice of the Convoker shoulders. Sunfire Robe fills the chest. Sunflare main-hand with Heart of the Pit off-hand, or Grand Magister's Staff of Torrents. Shifting Naaru Sliver and The Skull of Gul'dan are the premier trinkets."
        },
        'Warlock-Destruction': {
            0: "Pre-raid Destruction Warlocks wear Frozen Shadoweave (Tailoring BoP) Shoulders, Robe and Boots with Spellfire Gloves and Belt, and Spellstrike Hood and Pants. Blade of Wizardry fills the main-hand; Flametongue Seal the off-hand. Icon of the Silver Crescent is the top trinket.",
            1: "Phase 1 Destruction BiS centres on Voidheart T4 Crown, Mantle and Robe alongside Spellfire Gloves and Belt. Atiesh, Greatstaff of the Guardian is the top staff. Quagmirran's Eye and Icon of the Silver Crescent are top trinkets. Ruby Drape of the Mysticant fills the back.",
            2: "Phase 2 Destruction upgrades with Destruction Holo-gogs (Engineering). Vestments of the Sea-Witch fills the chest. Merciless Gladiator's Spellblade is the top main-hand; Fathomstone the off-hand. Mark of the Champion is the defining trinket. Belt of Blasting and Boots of Blasting fill waist and feet.",
            3: "Black Temple Destruction BiS centres on Malefic T6 — Hood, Mantle, Gloves and Leggings with Vestments of the Sea-Witch chest. Zhar'doom, Greatstaff of the Devourer is the top staff. The Skull of Gul'dan is the defining trinket. Anetheron's Noose and Slippers of the Seacaller fill off-set slots.",
            4: "Phase 4 adds Tempest of Chaos main-hand with Chronicle of Dark Secrets off-hand as alternative to Zhar'doom. The Skull of Gul'dan and Hex Shrunken Head are the top trinkets. Translucent Spellthread Necklace fills the neck. Mana Attuned Band anchors a ring slot.",
            5: "Sunwell Destruction BiS peaks with Dark Conjuror's Collar head and Amice of the Convoker shoulders. Sunfire Robe fills the chest. Sunflare main-hand with Heart of the Pit off-hand, or Grand Magister's Staff of Torrents. Shifting Naaru Sliver and The Skull of Gul'dan are the premier trinkets."
        }
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

    /**
     * Render the SEO description block below the GS summary.
     * Only shows in PvE BiS view with a known class/spec/phase.
     */
    function renderSeoDescription() {
        const el = $('seoDescription');
        if (!el) return;

        if (state.isPvP || state.selectedPhase == null || !state.selectedClass || !state.selectedSpec) {
            el.classList.add('hidden');
            el.innerHTML = '';
            return;
        }

        const text = generateSpecDescription(state.selectedClass, state.selectedSpec, state.selectedPhase);
        if (!text) {
            el.classList.add('hidden');
            el.innerHTML = '';
            return;
        }

        const phInfo = PHASE_NAMES[state.selectedPhase] || { label: `Phase ${state.selectedPhase}` };
        el.innerHTML = `<div class="seo-desc-inner">
            <span class="seo-desc-icon">📖</span>
            <p class="seo-desc-text">${text}</p>
        </div>`;
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
    function itemIcon(itemId, size, cssClass) {
        size = size || 'medium';    // tiny|small|medium|large
        cssClass = cssClass || '';
        // For wowsims negative IDs (random enchant suffix items), use the base Wowhead item ID
        const whId = toWhId(itemId);
        const iconName = (typeof ICONS !== 'undefined' && ICONS[whId]) || 'inv_misc_questionmark';
        const img = `<img src="${WH_ICON_CDN}/${size}/${iconName}.jpg" alt="" class="${cssClass}" loading="lazy" onerror="this.src='${WH_ICON_CDN}/${size}/inv_misc_questionmark.jpg'">`;
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
        Rogue:    { color: '#FFF569', specs: ['Dps'] },
        Priest:   { color: '#FFFFFF', specs: ['Holy', 'Shadow'] },
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
        Rogue:    { pveSpec: 'Dps',           label: 'Subtlety PvP' },
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
        'Rogue|Subtlety':       'Dps',
        'Rogue|Combat':         'Dps',
        'Priest|Discipline':    'Holy',
        'Druid|Feral Combat':   'Cat',
        // All others match directly (Arms→Arms, Frost→Frost, etc.)
    };

    const SPEC_ROLES = {
        Arms: 'Melee DPS', Fury: 'Melee DPS', Protection: 'Tank',
        Holy: 'Healer', Retribution: 'Melee DPS',
        'Beast Mastery': 'Ranged DPS', Marksmanship: 'Ranged DPS', Survival: 'Ranged DPS',
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
        'Ring 1', 'Ring 2', 'Trinket 1', 'Trinket 2',
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
        'Rogue-Dps':            'dw',
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
        'Shaman-Restoration':   'both',   // MH+Shield or Staff
        'Druid-Restoration':    'both',   // Staff or MH+OH
        'Hunter-Beast Mastery':  'both',   // DW or 2H
        'Hunter-Marksmanship':  'both',
        'Hunter-Survival':      'both',
    };

    // Specs där user kan toggla mellan DW och 2H
    const WEAPON_TOGGLE_SPECS = new Set([
        'Warrior-Fury', 'Priest-Shadow',
        'Mage-Fire', 'Mage-Frost', 'Mage-Arcane',
        'Warlock-Destruction', 'Warlock-Affliction', 'Warlock-Demonology',
        'Druid-Balance', 'Shaman-Elemental',
        'Priest-Holy', 'Shaman-Restoration', 'Druid-Restoration',
        'Hunter-Beast Mastery', 'Hunter-Marksmanship', 'Hunter-Survival',
    ]);

    // weaponMode: per selectionKey() → 'dw' | '2h'
    // Automatically derived from the BiS item in the current phase/spec.
    // If the #1 BIS item is a Two Hand → '2h'; otherwise → 'dw'.
    // User can override per spec+phase; override is persisted in localStorage.
    const WEAPON_MODE_DEFAULT = {
        'Paladin-Retribution': '2h',
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
        if (WEAPON_MODE_DEFAULT[specKey]) return WEAPON_MODE_DEFAULT[specKey];
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
        return DATA.specs.find(s => s.className === cls && s.specName === spec);
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

    // Returns the profession name if this item requires a profession to craft/use, else null.
    // Uses DATA.itemSources directly — any item with sourceType 'Profession' is filtered.
    function itemProfession(itemId) {
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

        // Display name: "Ring 1" → "Ring", "Trinket 2" → "Trinket" etc.
        const slotDisplayName = slot.replace(/ [12]$/, '');

        // ── Active item: user selection or BiS (index 0) ──
        const bis = getActiveItem(slot, si);
        const isOverridden = String(bis.itemId) !== String(si[0].itemId);
        const alts = si.filter(i => String(i.itemId) !== String(bis.itemId));

        const isPvPItem = bis.rank?.toLowerCase().includes('pvp');
        const badgeCls = isPvPItem ? 'bis' : (bis.rank.toLowerCase().startsWith('bis') ? 'bis' : 'alt');
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
        const bisIconHtml = `<div class="slot-icon-wrap">${itemIcon(bis.itemId, 'medium', bisQuality)}</div>${gemOverlayHtml}`;

        // PvP popularity meta
        const bisPvpHtml = pvpMetaHtml(bis);

        // WCL popularity meta
        const bisWclHtml = wclMetaHtml(bis);

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
                const ac = ap ? 'bis' : (alt.rank.toLowerCase().startsWith('bis') ? 'bis' : 'alt');
                const as = ap ? ' style="background:#c41e3a"' : '';
                const altSrc = getItemSource(alt.itemId);
                const altSrcText = altSrc ? `${srcEmoji(altSrc.sourceType)} ${altSrc.source || altSrc.sourceType}` : '';
                const altQuality = pvpQualityClass(alt);
                const altIconHtml = itemIcon(alt.itemId, 'small', 'alt-icon ' + altQuality);
                const altPvpHtml = pvpMetaHtml(alt);
                const altWclHtml = wclMetaHtml(alt);
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
    function buildWclItemsList(wclSpecData) {
        const items = [];
        for (const [wclSlot, slotItems] of Object.entries(wclSpecData.slots)) {
            const appSlot = WCL_SLOT_MAP[wclSlot] || wclSlot;
            for (let i = 0; i < slotItems.length; i++) {
                const wi = slotItems[i];
                const tier = wclTier(wi.popularity);
                const rank = i === 0 ? 'BIS' : 'Alt';
                items.push({
                    itemId: String(wi.id),
                    slot: appSlot,
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

    // ─── Get WCL data for current spec + phase ──────────────────────
    function getWclSpecData() {
        if (typeof WCL_DATA === 'undefined' || !WCL_DATA.phases) return null;
        if (state.isPvP) return null;
        const phase = state.selectedPhase;
        if (!phase) return null; // P0 (Pre-BiS) has no WCL data
        const wclKey = `${state.selectedClass}|${state.selectedSpec}`;
        const phaseData = WCL_DATA.phases[phase];
        if (!phaseData) return null;
        return phaseData[wclKey] || null;
    }

    function buildPvpItemsList(pvpSpecData) {
        // With very few players, rating gate is just noise — suppress it
        const suppressRatingGate = (pvpSpecData.playerCount || 0) < 10;

        const items = [];
        for (const [pvpSlot, slotItems] of Object.entries(pvpSpecData.slots)) {
            const appSlot = PVP_SLOT_MAP[pvpSlot] || pvpSlot;
            for (let i = 0; i < slotItems.length; i++) {
                const pi = slotItems[i];
                const tierMeta = PVP_TIER_META[pi.tier] || {};
                const popLabel = `${pi.popularity}%`;
                const rank = i === 0 ? 'PvP BIS' : 'PvP Alt';
                items.push({
                    itemId: String(pi.id),
                    slot: appSlot,
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

        let html = '<div class="prof-filter-label">🔨 Professions &amp; PvP</div>';
        html += hintHtml('prof-filter', '🔧',
            `Some BiS items require a specific <strong>profession</strong> to equip (e.g. Tailoring BoP robes), ` +
            `a <strong>PvP arena rating</strong> to purchase (e.g. Merciless/Vengeful/Brutal Gladiator weapons &amp; shoulders), ` +
            `or drop from <strong>outdoor world bosses</strong> (Doom Lord Kazzak, Doomwalker) which have a weekly respawn and may be camped or controlled by the opposite faction. ` +
            `Tap a button to <strong>toggle it off</strong> — the list will update to show the next-best alternative for that slot.`
        );
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
            const rankOrder = { 'BIS': 0, 'Pre-BIS': 1, 'Alt': 2, 'PvP BIS': 3, 'PvP Alt': 4 };
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
                const il = GearScore.estimateItemLevel(si[0].itemId, gsPhase);
                bisItems.push({ itemLevel: il, rarity: 4, slot });
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
            'Legs', 'Feet', 'Ring 1', 'Ring 2', 'Trinket 1', 'Trinket 2',
            'Main Hand', 'Off Hand', 'Two Hand', 'Ranged/Relic'
        ];
        const PD_LABELS = {
            Head:'Head', Neck:'Neck', Shoulder:'Shld', Back:'Back', Chest:'Chest', Wrist:'Wrist',
            Hands:'Hands', Waist:'Waist', Legs:'Legs', Feet:'Feet',
            'Ring 1':'Ring1', 'Ring 2':'Ring2', 'Trinket 1':'Trkt1', 'Trinket 2':'Trkt2',
            'Main Hand':'MH', 'Off Hand':'OH', 'Two Hand':'2H', 'Ranged/Relic':'Rng'
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
            const hasEnchant = !!enchantLookup[slot];
            const pdTitle = (bis.name || slot).replace(/"/g, '&quot;');

            // Weapon mode: dim inactive weapon slots (toggle specs only)
            const isWeaponDimmed = showWeaponToggle && (
                (weaponMode === '2h' && isMHOrOH) ||
                (weaponMode === 'dw' && is2H)
            );

            pdHtml += `<div class="pd-slot${isOverridden ? ' pd-slot-overridden' : ''}${isWeaponDimmed ? ' pd-slot-dimmed' : ''}" data-pd-slot="${slot}" title="${pdTitle}">
                ${itemIcon(bis.itemId, 'medium', 'pd-slot-icon ' + qualityClass(bis.itemId))}
                <span class="pd-slot-label">${PD_LABELS[slot] || slot}</span>
                ${hasEnchant ? '<span class="pd-enchant-dot"></span>' : ''}
                ${isOverridden ? '<span class="pd-custom-dot"></span>' : ''}
                ${isWeaponDimmed ? '<span class="pd-dimmed-x">✕</span>' : ''}
            </div>`;
        }
        paperdoll.innerHTML = pdHtml;

        // Paperdoll click → scroll to slot
        paperdoll.querySelectorAll('.pd-slot').forEach(pd => {
            pd.addEventListener('click', () => {
                const target = slotList.querySelector(`.slot-group[data-slot="${pd.dataset.pdSlot}"]`);
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    target.classList.add('open');
                    target.style.boxShadow = '0 0 0 2px var(--accent)';
                    setTimeout(() => target.style.boxShadow = '', 1500);
                }
            });
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

        // ── SEO contextual description ──
        renderSeoDescription();

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
                html += `<div class="wcl-info-banner">
                    <div class="wcl-banner-title">📊 <strong>WarcraftLogs Meta — Top Parsers</strong></div>
                    <div class="wcl-banner-meta">
                        What the top ${wclSpecData.totalPlayers} ${state.selectedSpec} ${state.selectedClass} parsers are wearing in Phase ${state.selectedPhase}.
                        ${dateStr ? '<br>📅 Data snapshot: ' + dateStr : ''}
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
        const ARMOR_SLOTS   = ['Head', 'Neck', 'Shoulder', 'Back', 'Chest', 'Wrist', 'Hands', 'Waist', 'Legs', 'Feet'];
        const JEWELRY_SLOTS = ['Ring 1', 'Ring 2', 'Trinket 1', 'Trinket 2'];
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
        'Priest-Shadow', 'Priest-Holy',
        'Rogue-Dps',
        'Paladin-Retribution', 'Paladin-Protection', 'Paladin-Holy',
        'Shaman-Enhancement', 'Shaman-Elemental', 'Shaman-Restoration',
        'Druid-Cat', 'Druid-Bear', 'Druid-Balance', 'Druid-Restoration',
        'Mage-Fire', 'Mage-Frost', 'Mage-Arcane',
        'Warlock-Destruction', 'Warlock-Affliction', 'Warlock-Demonology',
        'Hunter-Beast Mastery', 'Hunter-Marksmanship', 'Hunter-Survival',
    ]);

    // Specs där DPS-simulering är aktiv
    const SIM_DPS_SPECS = new Set(['Warrior-Fury', 'Warrior-Arms', 'Rogue-Dps', 'Priest-Shadow', 'Shaman-Enhancement', 'Shaman-Elemental', 'Paladin-Retribution', 'Druid-Cat', 'Druid-Balance', 'Warlock-Affliction', 'Warlock-Destruction', 'Warlock-Demonology', 'Mage-Fire', 'Mage-Frost', 'Mage-Arcane', 'Hunter-Beast Mastery', 'Hunter-Marksmanship', 'Hunter-Survival']);

    const SIM_DISCLAIMER = {
        'Warrior-Fury':  'Simulation uses standard Fury Warrior rotation (Bloodthirst → Whirlwind → Execute priority). On-use trinkets activated on cooldown. 3 000 iterations, 300s fight, Orc vs. boss-level target.',
        'Warrior-Arms':  'Simulation uses standard Arms Warrior rotation (Mortal Strike → Overpower priority). On-use trinkets activated on cooldown. 3 000 iterations, 300s fight, Orc vs. boss-level target.',
        'Rogue-Dps':     'Simulation uses Combat Swords rotation (Sinister Strike → Slice and Dice / Rupture / Eviscerate). Expose Armor maintained, Blade Flurry + Adrenaline Rush on cooldown. 3 000 iterations, 300s fight, Human vs. boss-level target.',
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

        let html = `
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
    }

    // ─── Gem Modal ───────────────────────────────────────────────────
    function openGemModal(itemId, gemName) {
        const source = getGemSource(itemId);
        const iconName = (typeof ICONS !== 'undefined' && ICONS[itemId]) || 'inv_misc_gem_01';

        modalTitle.innerHTML = `
            <span class="icon-link"><img src="${WH_ICON_CDN}/large/${iconName}.jpg" alt="" class="modal-item-icon" onerror="this.src='${WH_ICON_CDN}/large/inv_misc_questionmark.jpg'"></span>
            <span class="q-epic">${gemName || 'Gem #'+itemId}</span>`;

        let html = '';
        if (source) {
            html += `<div class="modal-section"><div class="modal-section-title">How to Get</div>
                <div class="modal-row"><span class="modal-row-icon">${srcIcon(source.sourceType)}</span>
                    <div><div class="modal-row-label">${source.sourceType}</div><div class="modal-row-value">${source.source || 'Unknown'}</div></div></div>`;
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
        if (canonical) canonical.setAttribute('href', `https://tbc-bis-guide.web.app/${page}`);

        // Scroll to top
        window.scrollTo(0, 0);
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
