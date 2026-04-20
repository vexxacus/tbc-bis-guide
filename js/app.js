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
    }

    /** Load persisted selections from localStorage */
    function loadSelectedItems() {
        try {
            const raw = localStorage.getItem('tbc-bis-selected-items');
            if (raw) state.selectedItems = JSON.parse(raw);
        } catch (_) { state.selectedItems = {}; }
    }
    loadSelectedItems();

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
        const specEntry = SPEC_SLUG_MAP[`${clsSlug}-${specSlug}`];
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
            state.pvpKey        = `${specEntry.cls}|${specEntry.spec}`;
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
    }

    // ─── Spec/phase contextual descriptions ──────────────────────────

    /**
     * Static descriptions per spec×phase covering stat priorities, key items, and raid context.
     * Used both for the in-page description block and for meta tags.
     */
    const SPEC_PHASE_DESCRIPTIONS = {
        'Warrior-Fury': {
            0: "Pre-raid Fury Warriors build around Dragonmaw and Latro's Shifting sword for dual-wield, pushing hit rating to cap and raw Attack Power from crafted Ragesteel gear and dungeon drops. Trinkets like Bloodlust Brooch and Abacus of Violent Odds carry your burst until Karazhan.",
            1: "Phase 1 Fury BiS revolves around Dragonspine Trophy for the haste proc and fast weapons like Gladiator's Slicer and Hope Ender from Karazhan and the Arena vendor. Warbringer T4 pieces provide strong Strength itemisation, with Badge of the Swarmguard remaining a solid trinket.",
            2: "Phase 2 Fury Warriors prioritise Dragonstrike and Talon of Azshara from SSC/TK for fast dual-wield damage. Destroyer Breastplate and Belt of One-Hundred Deaths are key gear targets. Dragonspine Trophy, Tsunami Talisman, and Solarian's Sapphire define the trinket setup.",
            3: "In Phase 3 (Black Temple & Hyjal) Fury Warriors upgrade to Warglaives of Azzinoth or Vengeful Gladiator's weapons. Onslaught Breastplate plus Belt of One-Hundred Deaths form the core of the set, with Dragonspine Trophy and Madness of the Betrayer as the top trinkets.",
            4: "Phase 4 adds Cursed Vision of Sargeras and the Onslaught Battle-Helm. Warglaives remain the best weapons. Dragonspine Trophy, Berserker's Call, and Madness of the Betrayer trinkets combine to maximise sustained Attack Power and haste.",
            5: "Sunwell Fury BiS centres on Warglaives of Azzinoth paired with Onslaught and crafted Sunwell pieces. Shard of Contempt and Dragonspine Trophy are the top trinkets. Hard Khorium Choker and Band of Ruinous Delight round out the jewellery."
        },
        'Warrior-Arms': {
            0: "Pre-raid Arms Warriors wield Lionheart Champion (Blacksmithing BoP) or Dragonmaw as top two-hand options. Vengeance Wrap and crafted Ragesteel pieces establish the stat base, with Bloodlust Brooch and Abacus of Violent Odds as key trinkets.",
            1: "Phase 1 Arms BiS features Lionheart Champion or Blinkstrike as top weapons alongside Dragonspine Trophy as the standout trinket. Warbringer T4 set pieces provide strong Strength, and Terrorweave Tunic slots in as a non-set chest option.",
            2: "Phase 2 Arms Warriors upgrade to Twinblade of the Phoenix or Lionheart Executioner. Destroyer Breastplate and Belt of One-Hundred Deaths are central pieces. Dragonspine Trophy and Tsunami Talisman dominate the trinket slots.",
            3: "Black Temple Arms Warriors pursue Cataclysm's Edge or Soul Cleaver as two-handed upgrades. Onslaught Breastplate and Belt of One-Hundred Deaths remain staples. Dragonspine Trophy and Madness of the Betrayer define the Phase 3 trinket setup.",
            4: "Phase 4 adds Onslaught Battle-Helm and Cursed Vision of Sargeras. Cataclysm's Edge or Twinblade of the Phoenix remain the weapon choices. Dragonspine Trophy, Berserker's Call, and Madness of the Betrayer keep the Attack Power ceiling high.",
            5: "Sunwell Arms BiS peaks with Apolyon, the Soul-Render or Cataclysm's Edge as weapons. Warglaives of Azzinoth in main/off-hand become an option. Shard of Contempt and Dragonspine Trophy are the premier trinkets."
        },
        'Warrior-Protection': {
            0: "Pre-raid Protection Warriors focus on defense cap (490) with pieces like Faceguard of Determination and crafted Felsteel. Dragonmaw provides threat while Azure-Shield of Coldarra and Crest of the Sha'tar fill the off-hand shield slot.",
            1: "Phase 1 Prot BiS centres on the Warbringer T4 set from Karazhan/Gruul/Mag. King's Defender and Dragonmaw are top one-handers; Aldori Legacy Defender is the best-in-slot shield. Moroes' Lucky Pocket Watch is a key threat-and-avoidance trinket.",
            2: "Phase 2 upgrades include Destroyer Shoulderguards, Destroyer Chestguard, and Destroyer Legguards from SSC/TK. Mallet of the Tides is a strong threat weapon; Aldori Legacy Defender remains the shield. Royal Cloak of Arathi Kings fills the back slot.",
            3: "Black Temple Prot Warriors acquire Vengeful Gladiator's Plate set pieces and The Brutalizer or Blade of Savagery for threat. Bulwark of Azzinoth is the iconic Phase 3 shield. Pendant of Titans improves threat through spell damage.",
            4: "Phase 4 adds Dory's Embrace and Brooch of Deftness. The weapon and shield setup remains The Brutalizer plus Bulwark of Azzinoth. Bracers of the Ancient Phalanx provide a strong wrist upgrade.",
            5: "Sunwell Prot BiS features Brutal Gladiator's Plate shoulders and chest, Onslaught Wristguards and Waistguard, and Dragonscale-Encrusted Longblade as a threat weapon. Sword Breaker's Bulwark is the top shield. Collar of the Pit Lord bolsters the neck slot."
        },
        'Rogue-Dps': {
            0: "Pre-raid Rogues wield Dragonmaw in the main hand and pair it with Latro's Shifting Sword or Searing Sunblade. Wastewalker set pieces from Slave Pens and Shattered Halls form the armor core. Mark of the Champion, Bloodlust Brooch, and Abacus of Violent Odds are the key trinkets.",
            1: "Phase 1 Rogue BiS centres on Dragonspine Trophy as the premier trinket. Dragonmaw or Gladiator's Slicer in main hand plus Latro's Shifting Sword or Gladiator's Quickblade in off-hand. Netherblade T4 pieces from Karazhan anchor the set.",
            2: "Phase 2 Rogues upgrade to Talon of Azshara in the main hand and Merciless Gladiator's Quickblade off-hand. Deathmantle T5 set from SSC/TK is the core armor. Dragonspine Trophy and Warp-Spring Coil are the top trinkets.",
            3: "Black Temple Rogues aim for Warglaives of Azzinoth — one in each hand — as the pinnacle weapons. Slayer's T6 set from BT anchors the armor. Dragonspine Trophy and Warp-Spring Coil remain top trinkets, joined by Cursed Vision of Sargeras for the head.",
            4: "Phase 4 adds Signet of Primal Wrath and Nyn'jah's Tabi Boots. Warglaives remain the weapon setup. Berserker's Call joins Dragonspine Trophy as a top trinket. Slayer's set continues to dominate.",
            5: "Sunwell Rogue BiS peaks with Warglaives of Azzinoth paired with Crux of the Apocalypse or Fang of Kalecgos. Slayer's Bracers, Belt, and Boots from Sunwell replace earlier T6 pieces. Blackened Naaru Sliver and Dragonspine Trophy are the premier trinkets."
        },
        'Druid-Balance': {
            0: "Pre-raid Balance Druids build around crafted Spellstrike Pants and Hood for hit rating. Staff of Infinite Mysteries or Talon of the Tempest plus Sapphiron's Wing Bone are strong weapon options. Icon of the Silver Crescent and Quagmirran's Eye are the key dungeon trinkets.",
            1: "Phase 1 Moonkin BiS centres on Karazhan cloth and Icon of the Silver Crescent plus Quagmirran's Eye as trinkets. Talon of the Tempest and Nathrezim Mindblade compete for the main-hand slot. Eye of the Night and Violet Signet of the Archmage are strong ring choices.",
            2: "Phase 2 Balance Druids upgrade to T5 Nordrassil Regalia from SSC/TK for the Starfire mana efficiency set bonus. Belt of Blasting and Mindstorm Wristbands are high-value off-set pieces. Fang of the Leviathan or The Nexus Key carries the weapon slot.",
            3: "Black Temple Moonkin gear focuses on T6 Thunderheart set pieces with high spell damage. Zhar'doom, Greatstaff of the Devourer is the pinnacle two-hander. Leggings of Channeled Elements and Slippers of the Seacaller are the best legs and boots from BT.",
            4: "Phase 4 adds Translucent Spellthread Necklace and Hex Shrunken Head trinket. Zhar'doom remains the best staff. Fetish of the Primal Gods and Chronicle of Dark Secrets compete for the off-hand slot alongside any staff upgrades.",
            5: "Sunwell Balance Druids equip Grand Magister's Staff of Torrents or Sunflare plus Heart of the Pit. Dark Conjuror's Collar and Amice of the Convoker replace earlier head and shoulder pieces. Shifting Naaru Sliver and The Skull of Gul'dan are the top trinkets."
        },
        'Druid-Bear': {
            0: "Pre-raid Bear Druids stack stamina and armor from leather dungeon gear to become uncrittable. The Wastewalker set from heroic Slave Pens and Shattered Halls forms the backbone, supplemented by Faceguard of Determination for the head slot.",
            1: "Phase 1 Bear tanks use Karazhan leather to push stamina. Terestian's Stranglestaff from Karazhan is the best weapon for threat. Moroes' Lucky Pocket Watch is an excellent avoidance trinket. Violet Signet of the Grand Restorer improves healing received.",
            2: "Phase 2 Bear gear from SSC/TK focuses on Destroyer Shoulderguards-equivalent leather and stamina stacking. Mallet of the Tides provides strong threat. Aldori Legacy Defender can serve as a threat-enhancing off-hand option.",
            3: "Black Temple Bear Druids acquire Cursed Vision of Sargeras for the head and Onslaught Breastplate-equivalent leather. Belt of One-Hundred Deaths and Bindings of Lightning Reflexes fill peripheral slots. Shadowmaster's Boots round out the feet slot.",
            4: "Phase 4 Bear BiS adds Onslaught Battle-Helm and Signet of Primal Wrath. Dragonspine Trophy and Berserker's Call are strong trinkets for physical threat generation. Insidious Bands provide strong wrist stats.",
            5: "Sunwell Bear BiS uses Bladed Chaos Tunic and Carapace of Sun and Shadow for the chest. Leggings of the Immortal Night and Gloves of Immortal Dusk are peak leather pieces. Blackened Naaru Sliver and Shard of Contempt are the top trinkets."
        },
        'Druid-Cat': {
            0: "Pre-raid Feral Cat Druids wear the Wastewalker set from heroics and wield Dragonmaw for Attack Power. Primalstrike Vest (Leatherworking BoP) is a strong chest alternative. Mark of the Champion, Bloodlust Brooch, and Abacus of Violent Odds drive burst damage.",
            1: "Phase 1 Cat BiS centres on Karazhan leather with Attack Power and critical strike. Dragonspine Trophy is the defining trinket. Liar's Tongue Gloves and Grips of Deftness compete for the hands slot. Bladespire Warbands provide a strong wrist piece.",
            2: "Phase 2 Cat Druids upgrade to Shoulderpads of the Stranger, Bloodsea Brigand's Vest, and Belt of One-Hundred Deaths from SSC/TK. Talon of Azshara steps up as the main weapon. Dragonspine Trophy and Warp-Spring Coil are the top trinkets.",
            3: "Black Temple Cat BiS includes Cursed Vision of Sargeras, Onslaught Breastplate-equivalent leather, and Belt of One-Hundred Deaths. Warglaive of Azzinoth or Vengeful Gladiator's weapons top the weapon list. Dragonspine Trophy and Madness of the Betrayer define the trinket setup.",
            4: "Phase 4 adds Signet of Primal Wrath and Nyn'jah's Tabi Boots. Berserker's Call joins Dragonspine Trophy in the trinket slots. Bow-stitched Leggings provide an excellent leg option from Zul'Aman.",
            5: "Sunwell Cat BiS peaks with Bladed Chaos Tunic, Carapace of Sun and Shadow, and Leggings of the Immortal Night. Warglaive of Azzinoth or Crux of the Apocalypse are top weapons. Blackened Naaru Sliver and Shard of Contempt are the premier trinkets."
        },
        'Druid-Restoration': {
            0: "Pre-raid Resto Druids use Primal Mooncloth set (Tailoring BoP) for shoulders and robe, paired with Lifegiving Cloak and Serpentcrest Life-Staff. Essence of the Martyr and Scarab Brooch are the key healing trinkets to pursue from heroics.",
            1: "Phase 1 Resto Druid BiS centres on Karazhan cloth pieces like Light-Collar of the Incarnate and Gilded Trousers of Benediction. Primal Mooncloth set pieces carry over. Essence of the Martyr and Eye of Gruul are strong trinkets. Light's Justice is the premier main-hand mace.",
            2: "Phase 2 upgrades include Cowl of the Avatar, Vestments of the Avatar, and Breeches of the Avatar from SSC/TK. Lightfathom Scepter is the top mace; Ethereum Life-Staff is the top staff. Essence of the Martyr and Direbrew Hops fill the trinket slots.",
            3: "Black Temple Resto Druids equip Cowl of Absolution, Vestments of Absolution, and Swiftheal Wraps (Tailoring BoP). Crystal Spire of Karabor is the pinnacle main-hand mace. Memento of Tyrande joins Essence of the Martyr as a top trinket.",
            4: "Phase 4 adds Achromic Trousers of the Naaru and Brooch of Nature's Mercy. Crystal Spire of Karabor and Scepter of Purification compete for the weapon. Memento of Tyrande, Direbrew Hops, and Essence of the Martyr keep the trinket setup strong.",
            5: "Sunwell Resto Druid BiS features Robe of Eternal Light, Cuffs of Absolution, and Belt of Absolution. Hammer of Sanctification is the top main-hand. Ring of Flowing Life and Blessed Band of Karabor anchor the ring slots. Essence of the Martyr and Darkmoon Card: Blue Dragon are key trinkets."
        },
        'Paladin-Holy': {
            0: "Pre-raid Holy Paladins build around Primal Mooncloth pieces (if Tailoring), Windhawk Hauberk, and dungeon plate healing gear. Hand of Eternity or Shockwave Truncheon provide the main-hand; Light-Bearer's Faith Shield fills the off-hand. Essence of the Martyr and Lower City Prayerbook are key trinkets.",
            1: "Phase 1 Holy Paladin BiS centres on Justicar T4 set pieces from Karazhan/Gruul/Mag. Light's Justice is the premier main-hand mace; Aegis of the Vindicator is the top shield. Essence of the Martyr and Pendant of the Violet Eye are the key trinkets.",
            2: "Phase 2 upgrades include Crystalforge T5 pieces from SSC/TK, Lightfathom Scepter, and Ring of Flowing Light (JC BoP). Ribbon of Sacrifice is a strong Phase 2 trinket; Essence of the Martyr remains a staple.",
            3: "Black Temple Holy Paladins equip Lightbringer T6 Greathelm, Pauldrons, Chestpiece, and Leggings. Crystal Spire of Karabor is the top main-hand; Felstone Bulwark and Bastion of Light compete for the shield. Memento of Tyrande and Essence of the Martyr are top trinkets.",
            4: "Phase 4 adds Girdle of Stromgarde's Hope and Libram of the Lightbringer. Crystal Spire of Karabor and Scepter of Purification remain the top weapons. Memento of Tyrande, Direbrew Hops, and Essence of the Martyr define the trinket setup.",
            5: "Sunwell Holy Paladin BiS features Helm of Burning Righteousness, Garments of Serene Shores, and Sunblessed Gauntlets (BS BoP). Hammer of Sanctification is the top main-hand; Aegis of Angelic Fortune is the best shield. Glimmering Naaru Sliver and Redeemer's Alchemist Stone are the key trinkets."
        },
        'Paladin-Protection': {
            0: "Pre-raid Prot Paladins stack defense from Faceguard of Determination, Timewarden's Leggings, and dungeon plate. Gladiator's Gavel or Blade of the Archmage provide main-hand threat; Crest of the Sha'tar is the top shield. Figurine of the Colossus and Icon of the Silver Crescent fill the trinket slots.",
            1: "Phase 1 Prot Pala BiS centres on Justicar T4 and Bloodmaw Magus-Blade for spell damage threat. Aldori Legacy Defender is the best shield. Moroes' Lucky Pocket Watch, Figurine of the Colossus, and Eye of Magtheridon are key trinkets for avoidance and threat.",
            2: "Phase 2 upgrades include Crystalforge Faceguard, Royal Gauntlets of Silvermoon, and Girdle of the Invulnerable from SSC/TK. Merciless Gladiator's Gavel or Fang of the Leviathan provide strong main-hand options. Aldori Legacy Defender remains the best shield.",
            3: "Black Temple Prot Paladins acquire Vengeful Gladiator's Plate pieces, Tempest of Chaos for main-hand threat, and Bulwark of Azzinoth as the peak shield. Pendant of Titans improves spell power for Consecration threat. Shadowmoon Insignia is a strong tanking trinket.",
            4: "Phase 4 adds Brooch of Deftness and Dory's Embrace. The weapon remains Tempest of Chaos or Vengeful Gladiator's Gavel. Bulwark of Azzinoth continues as the best shield. Shadowmoon Insignia remains the top tanking trinket.",
            5: "Sunwell Prot Paladin BiS features Brutal Gladiator's Plate shoulders and chest, Onslaught Wristguards and Waistguard. Tempest of Chaos or Brutal Gladiator's Gavel provide main-hand threat. Sword Breaker's Bulwark is the top Phase 5 shield. Hex Shrunken Head and Shadowmoon Insignia fill the trinket slots."
        },
        'Paladin-Retribution': {
            0: "Pre-raid Ret Paladins wield Gladiator's Greatsword (Arena) or the crafted Lionheart Champion-equivalent. Mask of the Deceiver fills the head slot; Scrolls of Blinding Light, Bloodlust Brooch, and Abacus of Violent Odds carry the trinket setup. Shapeshifter's Signet and A'dal's Command are strong rings.",
            1: "Phase 1 Ret BiS centres on Ethereum Nexus-Reaver as the top two-handed weapon. Dragonspine Trophy is the must-have trinket. Justicar Crown and T4 Breastplate from Karazhan/Gruul anchor the set. Choker of Vile Intent remains a strong neck option.",
            2: "Phase 2 Ret Paladins upgrade to Lionheart Executioner or Twinblade of the Phoenix. Crystalforge Breastplate from SSC/TK is a key armor piece. Dragonspine Trophy and Bloodlust Brooch are the top trinkets. Belt of One-Hundred Deaths and Bracers of Eradication fill out the set.",
            3: "Black Temple Ret BiS peaks with Torch of the Damned as the weapon. Cloak of Darkness (LW BoP), Midnight Chestguard, and Bow-stitched Leggings form the leather-heavy non-plate BiS. Dragonspine Trophy and Bloodlust Brooch remain top trinkets.",
            4: "Phase 4 adds Cloak of Fiends, Berserker's Call, and Choker of Endless Nightmares. Torch of the Damned remains the weapon. Dragonspine Trophy and Berserker's Call define the trinket setup. Band of Devastation provides a strong ring upgrade.",
            5: "Sunwell Ret BiS peaks with Apolyon, the Soul-Render or Shivering Felspine as weapons. Duplicitous Guise replaces the head slot. Shard of Contempt and Blackened Naaru Sliver are the top trinkets. Hard Khorium Choker (JC BoP) anchors the neck slot."
        },
        'Hunter-Beast Mastery': {
            0: "Pre-raid BM Hunters aim for Marksman's Bow or Veteran's Musket as the ranged weapon while wearing mail drops from Ramparts and Blood Furnace. Bloodlust Brooch, Mark of the Champion, and Abacus of Violent Odds fuel burst damage. Shapeshifter's Signet and Shaffar's Band of Brutality fill the rings.",
            1: "Phase 1 BM BiS features Sunfury Bow of the Phoenix as the premier ranged weapon from Karazhan. Cyclone T4 pieces from Karazhan/Gruul form the armor core. Dragonspine Trophy and Bloodlust Brooch are the key trinkets. Adornment of Stolen Souls or Emberspur Talisman fills the neck slot.",
            2: "Phase 2 BM Hunters upgrade to Gronnstalker T5 from SSC/TK. Serpent Spine Longbow or Barrel-Blade Longrifle are strong ranged upgrades. Dragonspine Trophy stays top trinket; The Lightning Capacitor offers a unique burst alternative.",
            3: "Black Temple BM BiS centres on Gronnstalker T6 pieces and top-tier ranged weapons. Sunfury Bow of the Phoenix may still appear but higher-ilvl options from BT vendors become available. Belt of One-Hundred Deaths anchors the waist slot.",
            4: "Phase 4 adds Ancient Amani Longbow from Zul'Aman alongside Shard of Contempt for the trinket slot. Cursed Vision of Sargeras remains a top head piece for Hunters. Stormrage Signet Ring and Signet of Primal Wrath fill the rings.",
            5: "Sunwell BM Hunter BiS peaks with Thori'dal, the Stars' Fury or Golden Bow of Quel'Thalas as the ranged weapon. Bladed Chaos Tunic and Leggings of the Immortal Night replace earlier tier pieces. Blackened Naaru Sliver and Shard of Contempt are the premier trinkets."
        },
        'Hunter-Marksmanship': {
            0: "Pre-raid MM Hunters prioritise Marksman's Bow or Veteran's Musket while wearing Wastewalker set pieces from heroics. Bloodlust Brooch, Mark of the Champion, and Abacus of Violent Odds provide the trinket base. Choker of Vile Intent and Braided Eternium Chain fill the neck slot.",
            1: "Phase 1 MM BiS centres on Sunfury Bow of the Phoenix or Barrel-Blade Longrifle as the ranged weapon. Netherblade T4 or Cyclone pieces from Karazhan anchor the set. Dragonspine Trophy and Bloodlust Brooch are the top trinkets. Ring of a Thousand Marks is a key ring.",
            2: "Phase 2 MM Hunters equip Gronnstalker T5 from SSC/TK and upgrade to Arcanite Steam-Pistol or Serpent Spine Longbow. Dragonspine Trophy and Warp-Spring Coil define the trinket setup. Belt of One-Hundred Deaths fills the waist slot.",
            3: "Black Temple MM BiS adds Cursed Vision of Sargeras for the head, Slayer's T6 set pieces, and Arcanite Steam-Pistol remaining in the ranged slot. Dragonspine Trophy and Warp-Spring Coil stay top trinkets alongside Choker of Endless Nightmares at the neck.",
            4: "Phase 4 upgrades include Ancient Amani Longbow and Signet of Primal Wrath. Shard of Contempt is a key new trinket. Berserker's Call joins the trinket rotation. Nyn'jah's Tabi Boots provide a foot upgrade.",
            5: "Sunwell MM Hunter BiS peaks with Thori'dal, the Stars' Fury or Golden Bow of Quel'Thalas. Bladed Chaos Tunic, Carapace of Sun and Shadow, and Leggings of the Immortal Night are peak armor pieces. Blackened Naaru Sliver and Shard of Contempt are the top trinkets."
        },
        'Hunter-Survival': {
            0: "Pre-raid Survival Hunters wear Wastewalker set pieces and carry Marksman's Bow or Veteran's Musket. Bloodlust Brooch, Mark of the Champion, and Abacus of Violent Odds are the core trinkets. Choker of Vile Intent and Braided Eternium Chain fill the neck.",
            1: "Phase 1 Survival BiS focuses on Agility-heavy Cyclone T4 pieces. Sunfury Bow of the Phoenix or Barrel-Blade Longrifle are the ranged weapons. Dragonspine Trophy is the best trinket. Liar's Tongue Gloves and Cobrascale Gloves provide strong Agility from hands.",
            2: "Phase 2 Survival Hunters equip Cataclysm T5 from SSC/TK for Agility stacking. Belt of One-Hundred Deaths and True-Aim Stalker Bands fill the waist and wrist slots. Dragonspine Trophy and Bloodlust Brooch remain the top trinket pair. Boots of Utter Darkness (LW BoP) are a key boot option.",
            3: "Black Temple Survival BiS includes Cursed Vision of Sargeras, Midnight Chestguard, and Bow-stitched Leggings. Belt of One-Hundred Deaths and Shadowmaster's Boots anchor the waist and feet. Dragonspine Trophy and Bloodlust Brooch remain top trinkets.",
            4: "Phase 4 adds Signet of Primal Wrath and Nyn'jah's Tabi Boots. Shard of Contempt joins the trinket setup. Band of the Ranger-General and Stormrage Signet Ring are strong ring choices. Ancient Amani Longbow provides a ranged upgrade.",
            5: "Sunwell Survival BiS peaks with Thori'dal, the Stars' Fury or Golden Bow of Quel'Thalas. Bladed Chaos Tunic and Carapace of Sun and Shadow are peak chest pieces. Blackened Naaru Sliver and Shard of Contempt are the premier trinkets."
        },
        'Mage-Arcane': {
            0: "Pre-raid Arcane Mages build around the crafted Spellstrike Hood and Spellstrike Pants for spell hit. Icon of the Silver Crescent and Quagmirran's Eye are the key dungeon trinkets. Talon of the Tempest or Nathrezim Mindblade plus Sapphiron's Wing Bone handle the weapon setup.",
            1: "Phase 1 Arcane BiS centres on Karazhan cloth like Cowl of Naaru Blessings and Mantle of the Avatar-equivalent pieces. Quagmirran's Eye and Icon of the Silver Crescent remain top trinkets. Talon of the Tempest and Nathrezim Mindblade compete for the main hand; Sapphiron's Wing Bone fills the off-hand.",
            2: "Phase 2 Arcane Mages upgrade to Cowl of Tirisfal and T5 Tirisfal set pieces from SSC/TK. Fang of the Leviathan is the best main-hand; Fathomstone fills the off-hand. Quagmirran's Eye and Serpent-Coil Braid are the top trinkets.",
            3: "Black Temple Arcane BiS centres on Cowl and Mantle of the Illidari High Lord plus Robes of the Tempest. The Skull of Gul'dan and Ashtongue Talisman of Insight are the top trinkets. Merciless Gladiator's Spellblade remains competitive for the main hand; Chronicle of Dark Secrets fills the off-hand.",
            4: "Phase 4 adds Mana Attuned Band, Loop of Cursed Bones, and Hex Shrunken Head trinket. Zhar'doom, Greatstaff of the Devourer becomes available as a staff option. Fetish of the Primal Gods competes for the off-hand slot.",
            5: "Sunwell Arcane BiS peaks with Grand Magister's Staff of Torrents or Sunflare plus Heart of the Pit. Dark Conjuror's Collar replaces the head; Tattered Cape of Antonidas fills the back. Shifting Naaru Sliver and The Skull of Gul'dan are the top trinkets."
        },
        'Mage-Fire': {
            0: "Pre-raid Fire Mages wear crafted Spellstrike Hood and Pants for hit rating. Icon of the Silver Crescent and Quagmirran's Eye are the key dungeon trinkets. Talon of the Tempest or Nathrezim Mindblade main-hand, with Sapphiron's Wing Bone in the off-hand.",
            1: "Phase 1 Fire BiS uses Karazhan cloth and the Spellfire BoP Tailoring set (Hood, Robe, Belt) if you have Tailoring. Quagmirran's Eye and Icon of the Silver Crescent are top trinkets. Talon of the Tempest and Sapphiron's Wing Bone fill the weapons.",
            2: "Phase 2 Fire Mages equip Cowl of Tirisfal and T5 Tirisfal set pieces. Fang of the Leviathan is the top main-hand; Fathomstone the off-hand. Serpent-Coil Braid and Quagmirran's Eye remain the premier trinkets. Band of Eternity and Ring of Endless Coils anchor the rings.",
            3: "Black Temple Fire BiS adds Cowl of the Illidari High Lord and Robes of the Tempest. The Skull of Gul'dan and Ashtongue Talisman of Insight are the defining trinkets. Merciless Gladiator's Spellblade remains viable; Chronicle of Dark Secrets fills the off-hand.",
            4: "Phase 4 adds Hex Shrunken Head and Loop of Cursed Bones. Zhar'doom, Greatstaff of the Devourer is available as a staff option. Fetish of the Primal Gods competes for the off-hand alongside Chronicle of Dark Secrets.",
            5: "Sunwell Fire BiS peaks with Sunflare plus Heart of the Pit or Grand Magister's Staff of Torrents. Dark Conjuror's Collar and Tattered Cape of Antonidas fill head and back. Shifting Naaru Sliver and The Skull of Gul'dan are the top trinkets."
        },
        'Mage-Frost': {
            0: "Pre-raid Frost Mages build around crafted Spellstrike Hood and Pants for hit rating. Icon of the Silver Crescent and Quagmirran's Eye are the key dungeon trinkets. Talon of the Tempest or Nathrezim Mindblade main-hand, Sapphiron's Wing Bone off-hand.",
            1: "Phase 1 Frost BiS uses Karazhan cloth alongside Quagmirran's Eye and Icon of the Silver Crescent as trinkets. Talon of the Tempest and Nathrezim Mindblade compete for main-hand; Sapphiron's Wing Bone fills the off-hand. Violet Signet of the Archmage and Band of Crimson Fury are solid rings.",
            2: "Phase 2 Frost Mages equip Cowl of Tirisfal and T5 Tirisfal set pieces from SSC/TK. Fang of the Leviathan is the top main-hand; Fathomstone fills the off-hand. Quagmirran's Eye and Serpent-Coil Braid remain premier trinkets.",
            3: "Black Temple Frost BiS features Cowl of the Illidari High Lord, Robes of the Tempest, and Zhar'doom, Greatstaff of the Devourer. The Skull of Gul'dan and Ashtongue Talisman of Insight are the top trinkets. Slippers of the Seacaller are best-in-slot boots.",
            4: "Phase 4 adds Hex Shrunken Head and Mana Attuned Band. Zhar'doom continues as the staff of choice; Fetish of the Primal Gods competes for off-hand. Carved Witch Doctor's Stick fills the ranged/wand slot.",
            5: "Sunwell Frost BiS peaks with Grand Magister's Staff of Torrents or Sunflare plus Heart of the Pit. Dark Conjuror's Collar and Tattered Cape of Antonidas replace head and back pieces. Shifting Naaru Sliver and The Skull of Gul'dan are the top trinkets."
        },
        'Priest-Holy': {
            0: "Pre-raid Holy Priests use Primal Mooncloth set (Tailoring BoP), Bands of the Benevolent, and dungeon healing cloth. Hand of Eternity or Shockwave Truncheon fills the main-hand; Windcaller's Orb is the off-hand. Essence of the Martyr and Scarab Brooch are the key trinkets.",
            1: "Phase 1 Holy BiS centres on Karazhan cloth like Light-Collar of the Incarnate and Gilded Trousers of Benediction. Primal Mooncloth carries over. Light's Justice is the top mace; Windcaller's Orb or Tears of Heaven fill the off-hand. Essence of the Martyr and Eye of Gruul are key trinkets.",
            2: "Phase 2 upgrades include Cowl of the Avatar, Vestments of the Avatar, and Gloves of the Avatar from SSC/TK. Lightfathom Scepter is the top main-hand; Ethereum Life-Staff is the staff option. Essence of the Martyr, Direbrew Hops, and Eye of Gruul fill the trinket slots.",
            3: "Black Temple Holy Priests equip Cowl and Vestments of Absolution, Swiftheal Wraps (Tailoring BoP), and Crystal Spire of Karabor. Memento of Tyrande and Essence of the Martyr are the top trinkets. Nadina's Pendant of Purity fills the neck.",
            4: "Phase 4 adds Brooch of Nature's Mercy and Achromic Trousers of the Naaru. Crystal Spire of Karabor and Scepter of Purification compete for the weapon. Direbrew Hops and Memento of Tyrande keep the trinket setup strong.",
            5: "Sunwell Holy Priest BiS features Robe of Eternal Light, Cuffs of Absolution, and Handguards of the Dawn. Hammer of Sanctification is the top main-hand. Ring of Flowing Life and Blessed Band of Karabor anchor the rings. Essence of the Martyr, Redeemer's Alchemist Stone, and Memento of Tyrande fill trinket slots."
        },
        'Priest-Shadow': {
            0: "Pre-raid Shadow Priests core the set around Frozen Shadoweave (Tailoring BoP) for shoulders, robe, and boots, plus crafted Spellstrike Hood. Icon of the Silver Crescent and Quagmirran's Eye are the key dungeon trinkets. Orb of the Soul-Eater fills the off-hand.",
            1: "Phase 1 Shadow BiS keeps Frozen Shadoweave shoulders and robe while adding Karazhan cloth like Handwraps of Flowing Thought and Leggings of the Seventh Circle. Nathrezim Mindblade and Talon of the Tempest compete for main-hand. Quagmirran's Eye, Icon of the Silver Crescent, and Eye of Magtheridon fill trinket slots.",
            2: "Phase 2 Shadow Priests upgrade to T5 Avatar set pieces from SSC/TK and swap to Merciless Gladiator's Gavel or Nathrezim Mindblade. The Nexus Key becomes the top staff option. Quagmirran's Eye, Icon of the Silver Crescent, and Eye of Magtheridon remain the top trinkets.",
            3: "Black Temple Shadow BiS centres on T6 Absolution Cowl, Shoulderpads, and Shroud of Absolution. Bracers of Nimble Thought (Tailoring BoP) fill the wrist slot. The Skull of Gul'dan and Darkmoon Card: Crusade are the defining trinkets. Zhar'doom, Greatstaff of the Devourer is the top staff.",
            4: "Phase 4 adds Hex Shrunken Head and Loop of Cursed Bones. Zhar'doom continues as the staff; Fetish of the Primal Gods competes for off-hand. Carved Witch Doctor's Stick is the top wand.",
            5: "Sunwell Shadow Priest BiS peaks with Zhar'doom, Greatstaff of the Devourer or Sunflare plus Heart of the Pit. Dark Conjuror's Collar and Amice of the Convoker replace head and shoulder pieces. Shifting Naaru Sliver and Hex Shrunken Head are the top trinkets."
        },
        'Shaman-Elemental': {
            0: "Pre-raid Elemental Shamans stack spell hit with Spellstrike Pants and crafted Netherstrike or Windhawk mail. Gladiator's Gavel fills the main-hand; Khadgar's Knapsack or Mazthoril Honor Shield serve as off-hands. Totem of the Void is the core relic. Icon of the Silver Crescent and Quagmirran's Eye are key trinkets.",
            1: "Phase 1 Elemental BiS centres on Cyclone T4 mail from Karazhan/Gruul, Totem of the Void, and Talon of the Tempest or Nathrezim Mindblade for main-hand. The Lightning Capacitor and Icon of the Silver Crescent are top trinkets. Adornment of Stolen Souls provides a strong neck upgrade.",
            2: "Phase 2 Elemental Shamans equip Cyclone/Cataclysm T5 from SSC/TK. The Nexus Key becomes available as a staff; Gladiator's Gavel remains a competitive main-hand. The Lightning Capacitor and Icon of the Silver Crescent define the trinket setup. Totem of the Void carries into this phase.",
            3: "Black Temple Elemental BiS centres on Skyshatter T6 pieces and Zhar'doom, Greatstaff of the Devourer. The Skull of Gul'dan and The Lightning Capacitor are the top trinkets. Slippers of the Seacaller and Leggings of Channeled Elements are best-in-slot feet and legs.",
            4: "Phase 4 adds Hex Shrunken Head and Skycall Totem. Zhar'doom remains the top staff; Hammer of Judgement and Antonidas's Aegis compete for the weapon slot. Brooch of Nature's Mercy provides a strong neck upgrade.",
            5: "Sunwell Elemental BiS peaks with Sunflare plus Heart of the Pit or Zhar'doom, Greatstaff of the Devourer. Cowl of Gul'dan and Skyshatter Mantle fill head and shoulder slots. Shifting Naaru Sliver and The Skull of Gul'dan are the top trinkets. Totem of Ancestral Guidance and Skycall Totem compete for the relic."
        },
        'Shaman-Enhancement': {
            0: "Pre-raid Enhancement Shamans wield Gladiator's Right Ripper or Dragonmaw in the main hand and Reflex Blades or The Bladefist in the off-hand. Primalstrike Vest and Ebon Netherscale Breastplate (LW BoP) fill the chest. Bloodlust Brooch, Mark of the Champion, and Abacus of Violent Odds are the key trinkets.",
            1: "Phase 1 Enhancement BiS centres on Dragonspine Trophy as the defining trinket. Gladiator's Right Ripper, Gladiator's Cleaver, and The Decapitator compete for the main-hand. Cyclone T4 and Ebon Netherscale pieces fill out the armor. Liar's Tongue Gloves and Cobrascale Gloves are top hand options.",
            2: "Phase 2 Enhancement Shamans upgrade to Rod of the Sun King, Dragonstrike, or Wicked Edge of the Planes. Cataclysm T5 provides armor upgrades. Belt of One-Hundred Deaths anchors the waist. Dragonspine Trophy and Bloodlust Brooch remain the top trinkets. Boots of Utter Darkness (LW BoP) are a key boot option.",
            3: "Black Temple Enhancement BiS centres on Vengeful Gladiator's Cleaver or Syphon of the Nathrezim as weapons. Cursed Vision of Sargeras fills the head slot; Midnight Chestguard is the chest. Dragonspine Trophy, Madness of the Betrayer, and Bloodlust Brooch are top trinkets. Swiftstrike Shoulders (LW BoP) fill the shoulder slot.",
            4: "Phase 4 adds Signet of Primal Wrath, Berserker's Call, and Nyn'jah's Tabi Boots. Shard of Contempt is a key new trinket. Dragonspine Trophy and Madness of the Betrayer remain strong. Band of the Ranger-General provides a top ring option.",
            5: "Sunwell Enhancement BiS peaks with Hand of the Deceiver main-hand and Mounting Vengeance off-hand. Bladed Chaos Tunic and Carapace of Sun and Shadow fill the chest. Skyshatter T6 shoulders and wristguards round out the set. Blackened Naaru Sliver and Shard of Contempt are the top trinkets."
        },
        'Shaman-Restoration': {
            0: "Pre-raid Resto Shamans wear Primal Mooncloth and Whitemend cloth alongside Windhawk mail pieces. Hand of Eternity or Gladiator's Salvation fills the main-hand; Tears of Heaven or Light-Bearer's Faith Shield fill the off-hand. Essence of the Martyr and Lower City Prayerbook are the key healing trinkets.",
            1: "Phase 1 Resto Shaman BiS centres on Karazhan healing mail like Fathom-Helm of the Deeps and Cyclone Headdress. Light's Justice is the top main-hand mace; Aegis of the Vindicator fills the off-hand. Essence of the Martyr and Ribbon of Sacrifice are the top trinkets. Totem of Healing Rains is the best-in-slot relic.",
            2: "Phase 2 upgrades include Cataclysm T5 healing mail from SSC/TK, Lightfathom Scepter, and Band of Eternity. Essence of the Martyr, Direbrew Hops, and Scarab of the Infinite Cycle fill trinket slots. Aegis of the Vindicator remains the top off-hand shield.",
            3: "Black Temple Resto Shaman BiS centres on Skyshatter T6 pieces, Living Earth Bindings (LW BoP), and Crystal Spire of Karabor. Memento of Tyrande and Essence of the Martyr are the top trinkets. Nadina's Pendant of Purity fills the neck slot. Totem of Healing Rains remains the best relic.",
            4: "Phase 4 adds Brooch of Nature's Mercy, Two-toed Sandals, and Treads of the Life Path. Crystal Spire of Karabor and Bastion of Light compete for the weapon slot. Memento of Tyrande, Direbrew Hops, and Essence of the Martyr define the trinket setup.",
            5: "Sunwell Resto Shaman BiS features Sun-Drenched Scale Chestguard (LW BoP) and Leather Gauntlets of the Sun as non-mail BiS pieces. Hammer of Sanctification is the top main-hand. Glimmering Naaru Sliver and Redeemer's Alchemist Stone are key trinkets. Totem of Healing Rains continues as the best relic."
        },
        'Warlock-Affliction': {
            0: "Pre-raid Affliction Warlocks core around Frozen Shadoweave (Tailoring BoP) robe and boots plus crafted Spellstrike Hood and Pants. Blade of Wizardry fills the main-hand; Khadgar's Knapsack or Lamp of Peaceful Radiance fill the off-hand. Icon of the Silver Crescent and Quagmirran's Eye are the key dungeon trinkets.",
            1: "Phase 1 Affliction BiS centres on Voidheart T4 pieces from Karazhan/Gruul. Talon of the Tempest is the top main-hand; Khadgar's Knapsack fills the off-hand. Quagmirran's Eye and Icon of the Silver Crescent remain top trinkets. Violet Signet of the Archmage and Band of Crimson Fury fill the rings.",
            2: "Phase 2 Affliction Warlocks upgrade to T5 Corruptor Regalia from SSC/TK and swap to Merciless Gladiator's Spellblade or Fang of the Leviathan. Fathomstone and Orb of the Soul-Eater fill the off-hand. The Nexus Key is the top staff option. Mark of the Champion, Quagmirran's Eye, and Icon of the Silver Crescent define the trinket setup.",
            3: "Black Temple Affliction BiS centres on T6 Malefic set pieces and Zhar'doom, Greatstaff of the Devourer. The Skull of Gul'dan is the top trinket. Leggings of Channeled Elements and Slippers of the Seacaller are best-in-slot legs and feet.",
            4: "Phase 4 adds Hex Shrunken Head and Translucent Spellthread Necklace. Zhar'doom remains the top staff; Chronicle of Dark Secrets competes for the off-hand. Carved Witch Doctor's Stick is the top wand.",
            5: "Sunwell Affliction BiS peaks with Grand Magister's Staff of Torrents or Sunflare plus Heart of the Pit. Dark Conjuror's Collar and Amice of the Convoker replace head and shoulder pieces. Shifting Naaru Sliver and The Skull of Gul'dan are the premier trinkets."
        },
        'Warlock-Demonology': {
            0: "Pre-raid Demonology Warlocks wear Frozen Shadoweave (Tailoring BoP) robe and boots plus crafted Spellstrike Hood. Blade of Wizardry fills the main-hand; Khadgar's Knapsack or Lamp of Peaceful Radiance serve as off-hands. Icon of the Silver Crescent, Quagmirran's Eye, and The Black Book (Demonology-specific trinket) fill the trinket slots.",
            1: "Phase 1 Demo BiS centres on Voidheart T4 pieces from Karazhan/Gruul. Talon of the Tempest or Nathrezim Mindblade fill the main-hand; Khadgar's Knapsack or Orb of the Soul-Eater fill the off-hand. Quagmirran's Eye, Icon of the Silver Crescent, and Scryer's Bloodgem are the top trinkets.",
            2: "Phase 2 Demonology upgrades to T5 Corruptor Regalia from SSC/TK and swaps to Merciless Gladiator's Spellblade or Fang of the Leviathan for main-hand. Fathomstone or Orb of the Soul-Eater fill the off-hand. The Nexus Key is the top staff option. Void Star Talisman joins Icon of the Silver Crescent as a key trinket.",
            3: "Black Temple Demo BiS centres on T6 Malefic set pieces and Zhar'doom, Greatstaff of the Devourer. The Skull of Gul'dan is the defining trinket. Leggings of Channeled Elements and Slippers of the Seacaller are best-in-slot legs and feet. Chronicle of Dark Secrets fills the off-hand.",
            4: "Phase 4 adds Hex Shrunken Head and Translucent Spellthread Necklace. Zhar'doom continues as the top staff; Chronicle of Dark Secrets remains in the off-hand. Carved Witch Doctor's Stick is the best wand. Mana Attuned Band and Ring of Ancient Knowledge anchor the rings.",
            5: "Sunwell Demonology BiS peaks with Grand Magister's Staff of Torrents or Sunflare plus Heart of the Pit. Dark Conjuror's Collar and Amice of the Convoker fill head and shoulder slots. Shifting Naaru Sliver and The Skull of Gul'dan are the premier trinkets."
        },
        'Warlock-Destruction': {
            0: "Pre-raid Destruction Warlocks build around Spellfire (Tailoring BoP) robe, belt, and gloves plus crafted Spellstrike Hood and Pants. Blade of Wizardry fills the main-hand; Khadgar's Knapsack or Lamp of Peaceful Radiance the off-hand. Icon of the Silver Crescent and Quagmirran's Eye are the key trinkets.",
            1: "Phase 1 Destruction BiS centres on Voidheart T4 pieces alongside the Spellfire BoP set (robe, belt, gloves). Talon of the Tempest fills the main-hand; Flametongue Seal or Khadgar's Knapsack fill the off-hand. Quagmirran's Eye and Icon of the Silver Crescent remain top trinkets.",
            2: "Phase 2 Destruction upgrades to T5 Corruptor Regalia from SSC/TK and swaps to Merciless Gladiator's Spellblade or Fang of the Leviathan. Fathomstone or Flametongue Seal fill the off-hand. The Nexus Key is the top staff option. Mark of the Champion and Quagmirran's Eye define the trinket setup.",
            3: "Black Temple Destruction BiS centres on T6 Malefic set pieces and Zhar'doom, Greatstaff of the Devourer. The Skull of Gul'dan is the defining trinket. Leggings of Channeled Elements and Slippers of the Seacaller fill legs and feet. Chronicle of Dark Secrets serves as the off-hand.",
            4: "Phase 4 adds Hex Shrunken Head and Translucent Spellthread Necklace. Zhar'doom remains the top staff; Chronicle of Dark Secrets fills the off-hand. Carved Witch Doctor's Stick is the best wand. Mana Attuned Band and Ring of Ancient Knowledge anchor the rings.",
            5: "Sunwell Destruction BiS peaks with Grand Magister's Staff of Torrents or Sunflare plus Heart of the Pit. Dark Conjuror's Collar and Amice of the Convoker fill head and shoulder slots. Shifting Naaru Sliver and The Skull of Gul'dan are the premier trinkets."
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
    function buildPvpSpecs() {
        if (typeof PVP_DATA === 'undefined' || !PVP_DATA.specs) return {};
        const map = {};
        for (const [key, data] of Object.entries(PVP_DATA.specs)) {
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
    };

    // Specs där user kan toggla mellan DW och 2H
    const WEAPON_TOGGLE_SPECS = new Set(['Warrior-Fury', 'Priest-Shadow']);

    // weaponMode: per selectionKey() → 'dw' | '2h' (default varies by spec)
    // Default: 'dw' for most, '2h' for Shadow Priest (staff is common)
    const WEAPON_MODE_DEFAULT = {
        'Priest-Shadow': '2h',
    };
    const weaponModeState = {};
    function getWeaponMode() {
        const key = selectionKey();
        if (key in weaponModeState) return weaponModeState[key];
        const specKey = `${state.selectedClass}-${state.selectedSpec}`;
        return WEAPON_MODE_DEFAULT[specKey] || 'dw';
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
        [stepClass, stepSpec, stepPhase, stepBis].forEach(s => s.classList.add('hidden'));
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

    // ─── Step 1: Class ───────────────────────────────────────────────
    document.querySelectorAll('.class-card').forEach(card => {
        card.addEventListener('click', () => {
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
            `Choose a <strong>PvE spec</strong> to see curated Best in Slot lists for each content phase. ` +
            `These are classic, evergreen recommendations based on theorycrafting and community consensus.`
        );

        // PvE specs
        for (const spec of meta.specs) {
            html += `
                <button class="spec-card" data-spec="${spec}" data-pvp="false">
                    <div class="spec-emoji">${specIcon(cls, spec)}</div>
                    <div class="spec-info">
                        <div class="spec-name" style="color:${meta.color}">${spec}</div>
                        <div class="spec-role">${SPEC_ROLES[spec] || 'DPS'} · PvE</div>
                    </div>
                    <div class="spec-arrow">▸</div>
                </button>`;
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
                    <button class="spec-card is-pvp" data-spec="${pvp.spec}" data-pvp="true" data-pvp-key="${pvp.key}">
                        <div class="spec-emoji">${pvpSpecIconForSpec(cls, pvp.spec)}</div>
                        <div class="spec-info">
                            <div class="spec-name" style="color:#c41e3a">${pvp.spec} PvP</div>
                            <div class="spec-role">${playerLabel}${ratingLabel ? ' · ' + ratingLabel : ''}</div>
                        </div>
                        <span class="spec-pvp-badge">PVP</span>
                        <div class="spec-arrow">▸</div>
                    </button>`;
            }
        } else {
            // Fallback: show single PvP entry from fallback map
            const fb = PVP_SPEC_MAP_FALLBACK[cls];
            if (fb) {
                html += `
                    <button class="spec-card is-pvp" data-spec="${fb.pveSpec}" data-pvp="true">
                        <div class="spec-emoji">${pvpSpecIcon(cls)}</div>
                        <div class="spec-info">
                            <div class="spec-name" style="color:#c41e3a">${fb.label}</div>
                            <div class="spec-role">Arena & Battlegrounds</div>
                        </div>
                        <span class="spec-pvp-badge">PVP</span>
                        <div class="spec-arrow">▸</div>
                    </button>`;
            }
        }

        specGrid.innerHTML = html;
        bindHintDismiss(specGrid);

        specGrid.querySelectorAll('.spec-card').forEach(card => {
            card.addEventListener('click', () => {
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
            return `<button class="phase-btn" data-phase="${p}">
                <span class="phase-num">${info.num}</span>
                <span class="phase-label">${info.label}</span>
            </button>`;
        }).join('');

        phaseTabs.innerHTML = phaseHtml;
        bindHintDismiss(phaseTabs);

        phaseTabs.querySelectorAll('.phase-btn').forEach(btn => {
            btn.addEventListener('click', () => {
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
            return `<button class="ps-tab${isActive ? ' active' : ''}" data-phase="${p}">
                <span class="ps-num">${info.num}</span>
                <span class="ps-label">${info.label}</span>
            </button>`;
        }).join('');

        phaseSwitcher.classList.remove('hidden');

        phaseSwitcher.querySelectorAll('.ps-tab').forEach(tab => {
            tab.addEventListener('click', () => {
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

        let html = `<div class="slot-group${isOverridden ? ' slot-overridden' : ''}" data-slot="${slot}">
            <div class="slot-header" data-item-id="${bis.itemId}">
                <div class="slot-icon">${bisIconHtml}</div>
                <div class="slot-content">
                    <div class="slot-name">${slotDisplayName}${isOverridden ? ' <span class="slot-custom-tag">Custom</span>' : ''}</div>
                    <div class="slot-bis-item">
                        <div class="slot-bis-name ${bisQuality}">${whItem(bis.itemId, bis.name || 'Item #'+bis.itemId, bisQuality)}</div>
                    </div>
                    ${enchantHtml}
                    ${srcText ? `<div class="slot-source">${srcText}</div>` : ''}
                    ${bisPvpHtml}
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

        return `<div class="pvp-meta-row">${parts.join('')}</div>`;
    }

    // ─── Build PvP items list from scraped data ────────────────────
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
                });
                return;
            }
            if (chip.id === 'worldBossToggle') {
                chip.addEventListener('click', () => {
                    state.hideWorldBoss = !state.hideWorldBoss;
                    localStorage.setItem('tbc-bis-hide-world-boss', state.hideWorldBoss ? '1' : '0');
                    renderBisList();
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
            });
        });
    }

    // ─── Step 4: BiS List ────────────────────────────────────────────
    function renderBisList() {
        // Render inline phase tabs
        renderPhaseSwitcher();

        const pveSpec = getPveSpecForCurrentState();
        const specData = findSpec(state.selectedClass, pveSpec);
        const phaseData = (specData && state.selectedPhase != null)
            ? specData.phases[state.selectedPhase]
            : null;

        let items = phaseData ? [...phaseData.items] : [];

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
        const _ringBuf = [], _trinketBuf = [];
        const slotGroups = {};
        for (const item of items) {
            let slot = item.slot;
            if (slot === 'Shoulders') slot = 'Shoulder';

            // Buffer Ring and Trinket for later split into 1/2
            if (slot === 'Ring')    { if (!_ringBuf.find(i => i.itemId === item.itemId))    _ringBuf.push(item);    continue; }
            if (slot === 'Trinket') { if (!_trinketBuf.find(i => i.itemId === item.itemId)) _trinketBuf.push(item); continue; }

            // "Main Hand~Off Hand" means weapon usable in either hand
            if (slot === 'Main Hand~Off Hand') {
                // Add to both MH and OH
                for (const s of ['Main Hand', 'Off Hand']) {
                    if (!slotGroups[s]) slotGroups[s] = [];
                    if (!slotGroups[s].find(i => i.itemId === item.itemId)) {
                        slotGroups[s].push({ ...item, slot: s });
                    }
                }
                continue;
            }

            if (!slotGroups[slot]) slotGroups[slot] = [];
            if (!slotGroups[slot].find(i => i.itemId === item.itemId)) {
                slotGroups[slot].push(item);
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
            // For slot 2: skip any item that is Unique AND same as primary1
            // (you can't wear two of the same Unique ring/trinket)
            const hasUnique = typeof ITEM_UNIQUE !== 'undefined';
            const primary2 = allSorted.slice(1).find(i => {
                if (!hasUnique) return true;
                if (ITEM_UNIQUE.has(parseInt(i.itemId)) && i.itemId === primary1?.itemId) return false;
                return true;
            });
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
        const regularGems = gems.filter(g => !g.isMeta);

        // Fallback: if no meta gem in current phase, search other phases
        if (!metaGem && specData && state.selectedPhase != null) {
            const phases = Object.keys(specData.phases).map(Number).sort();
            // Search nearest lower phase first, then higher phases
            const lower = phases.filter(p => p < state.selectedPhase).reverse();
            const higher = phases.filter(p => p > state.selectedPhase);
            for (const p of [...lower, ...higher]) {
                const pg = specData.phases[p]?.gems || [];
                const found = pg.find(g => g.isMeta);
                if (found) { metaGem = found; break; }
            }
        }

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
        const showWeaponToggle = WEAPON_TOGGLE_SPECS.has(specKey) && hasOneHanders && has2H && !pvpSpecData;
        const weaponMode = showWeaponToggle ? getWeaponMode() : null;
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
            const bis = getActiveItem(slot, si);
            const isOverridden = String(bis.itemId) !== String(si[0].itemId);
            const hasEnchant = !!enchantLookup[slot];
            const pdTitle = (bis.name || slot).replace(/"/g, '&quot;');

            // Weapon mode: dim inactive weapon slots
            const isMHOrOH = slot === 'Main Hand' || slot === 'Off Hand';
            const is2H     = slot === 'Two Hand';
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
            // PvE hint
            html += hintHtml('pve-bis', '📖',
                `These are <strong>curated BiS recommendations</strong> based on theorycrafting and community guides. ` +
                `Tap any item to see alternatives, source info, and a Wowhead link. ` +
                `Items with <strong>gem sockets</strong> show recommended gems below the icon.`
            );
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
            const toggleHtml = showWeaponToggle ? `
                <div class="weapon-toggle">
                    <button class="weapon-toggle-btn${weaponMode === 'dw' ? ' active' : ''}" data-weapon-mode="dw">⚔️ Dual-Wield</button>
                    <button class="weapon-toggle-btn${weaponMode === '2h' ? ' active' : ''}" data-weapon-mode="2h">🗡️ Two-Handed</button>
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
            html += `<div class="slot-group-inactive-wrap">`;
            html += renderSlotGroup('Two Hand', slotGroups, enchantLookup, !!pvpSpecData);
            html += `</div>`;
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
        scheduleSimStats(slotGroups, enchantLookup, gems);
    }

    // ─── Sim Stats Panel ─────────────────────────────────────────────
    // Specs som har sim-stöd (matchas mot specKey = "Class-Spec")
    const SIM_SUPPORTED_SPECS = new Set([
        'Warrior-Fury', 'Warrior-Arms', 'Warrior-Protection',
        'Priest-Shadow',
        'Rogue-Dps',
        'Paladin-Retribution', 'Paladin-Protection',
        'Shaman-Enhancement',
        'Druid-Cat', 'Druid-Bear',
    ]);

    // Specs där DPS-simulering är aktiv (Shadow Priest har bara stats, ingen sim-knapp)
    const SIM_DPS_SPECS = new Set(['Warrior-Fury', 'Warrior-Arms']);

    const SIM_DISCLAIMER = {
        'Warrior-Fury':  'Simulation uses standard Fury Warrior rotation (Bloodthirst → Whirlwind → Execute priority). On-use trinkets activated on cooldown. 3 000 iterations, 300s fight, Orc vs. boss-level target.',
        'Warrior-Arms':  'Simulation uses standard Arms Warrior rotation (Mortal Strike → Overpower priority). On-use trinkets activated on cooldown. 3 000 iterations, 300s fight, Orc vs. boss-level target.',
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

        _lastSlotGroups    = slotGroups;
        _lastEnchantLookup = enchantLookup;
        _lastGems          = gems;

        clearTimeout(_simStatsDebounce);
        _simStatsDebounce = setTimeout(async () => {
            const reqId = ++_simStatsReqId;
            simStats.innerHTML = '<div class="sim-stat-loading">Computing stats…</div>';

            // Capture slotGroups + weaponMode at this moment
            const wMode = typeof getWeaponMode === 'function' ? getWeaponMode() : null;
            const stats = await computeStatsForBis(slotGroups, getActiveItem, wMode, enchantLookup, gems, specKey);
            if (reqId !== _simStatsReqId) return; // stale

            if (!stats) {
                if (!_simReady) {
                    // WASM not loaded yet — retry once when ready
                    simStats.innerHTML = '<div class="sim-stat-loading">Stats unavailable — WASM loading…</div>';
                    onSimReady(() => scheduleSimStats(slotGroups, enchantLookup, gems));
                } else {
                    // WASM ready but this gear caused a crash — don't retry
                    simStats.innerHTML = '<div class="sim-stat-loading">Stats unavailable for this phase</div>';
                }
                return;
            }
            renderSimStats(stats, specKey);
        }, 300);
    }

    function renderSimStats(stats, specKey) {
        const isCaster = specKey === 'Priest-Shadow';
        const isTank   = specKey === 'Druid-Bear' || specKey === 'Warrior-Protection' || specKey === 'Paladin-Protection';
        const labels = isCaster ? SIM_STAT_LABELS_CASTER
                     : isTank   ? SIM_STAT_LABELS_TANK
                     :            SIM_STAT_LABELS_MELEE;
        const order  = isCaster ? SIM_STAT_ORDER_CASTER
                     : isTank   ? SIM_STAT_ORDER_TANK
                     :            SIM_STAT_ORDER_MELEE;
        const rows = order.map(idx => {
            const def = labels[idx];
            if (!def) return '';
            // Sentinel 999 = Total Avoidance (computed from dodge + parry + block ratings)
            let val;
            if (idx === 999) {
                const dodgePct = (stats[32] || 0) / DODGE_RATING_PER_PCT;
                const parryPct = (stats[33] || 0) / PARRY_RATING_PER_PCT;
                const blockPct = (stats[30] || 0) / BLOCK_RATING_PER_PCT;
                val = dodgePct + parryPct + blockPct;
            } else {
                val = stats[idx] || 0;
            }
            return `<div class="sim-stat-row">
                <span class="sim-stat-label">${def.label}</span>
                <span class="sim-stat-value">${def.fmt(val)}</span>
            </div>`;
        }).join('');

        // For Shadow Priest: visa hur mycket shadow power som kommer från random enchants
        let enchantNoteHtml = '';
        if (isCaster && _lastSlotGroups) {
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

            const wMode = typeof getWeaponMode === 'function' ? getWeaponMode() : null;
            const specKey = `${state.selectedClass}-${state.selectedSpec}`;
            const simFn = specKey === 'Warrior-Arms'   ? simulateArmsWarrior
                        : specKey === 'Priest-Shadow'   ? simulateShadowPriest
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
