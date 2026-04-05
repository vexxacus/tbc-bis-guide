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
        excludedProfessions: new Set()  // professions to hide from BiS list
    };

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

    function whItem(id, text, cls) {
        return `<a href="https://www.wowhead.com/${WH}/item=${id}" data-wowhead="item=${id}&domain=${WH}" data-wh-item="${id}" class="${cls||''}">${text}</a>`;
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
        const iconName = (typeof ICONS !== 'undefined' && ICONS[itemId]) || 'inv_misc_questionmark';
        const img = `<img src="${WH_ICON_CDN}/${size}/${iconName}.jpg" alt="" class="${cssClass}" loading="lazy" onerror="this.src='${WH_ICON_CDN}/${size}/inv_misc_questionmark.jpg'">`;
        // Intercept click → open modal, keep data-wowhead for hover tooltip
        return `<a href="https://www.wowhead.com/${WH}/item=${itemId}" data-wowhead="item=${itemId}&domain=${WH}" data-wh-item="${itemId}" class="icon-link">${img}</a>`;
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
        'Warrior-Fury':         'dw',
        'Warrior-Protection':   'dw',
        'Rogue-Dps':            'dw',
        'Shaman-Enhancement':   'dw',
        'Paladin-Holy':         'dw',
        'Paladin-Protection':   'dw',
        'Druid-Bear':           '2h',
        'Druid-Cat':            '2h',
        'Paladin-Retribution':  '2h',
        'Warrior-Arms':         'both',
    };

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

    // BoP profession items — REQUIRE the profession to equip.
    // BoE crafted items (Vengeance Wrap, Spellstrike, Bracers of Havok, etc.)
    // are NOT included because anyone can wear them.
    const BOP_PROFESSION_IDS = new Set([
        // ─ Tailoring BoP specialty sets ─
        21846,21847,21848,          // Spellfire Belt / Gloves / Robe
        21869,21870,21871,          // Frozen Shadoweave Shoulders / Boots / Robe
        21873,21874,21875,          // Primal Mooncloth Belt / Shoulders / Robe
        // Tailoring BoP (BT/Sunwell patterns)
        32584,32585,                // Swiftheal Wraps / Mantle
        32586,32587,                // Bracers of Nimble Thought / Mantle of Nimble Thought
        34364,34365,                // Sunfire Robe / Robe of Eternal Light
        34367,                      // Hands of Eternal Light

        // ─ Leatherworking BoP specialty sets ─
        29515,29516,29517,          // Ebon Netherscale Breastplate / Belt / Bracers
        29519,29520,29521,          // Netherstrike Breastplate / Belt / Bracers
        29522,29523,29524,          // Windhawk Hauberk / Bracers / Belt
        29525,29526,29527,          // Primalstrike Vest / Belt / Bracers
        // LW BoP (BT/Sunwell patterns)
        32574,32575,                // Bindings / Shoulders of Lightning Reflexes
        32577,                      // Living Earth Bindings
        32581,32582,                // Swiftstrike Shoulders / Bracers of Renewed Life
        34369,34370,                // Carapace of Sun and Shadow / Gloves of Immortal Dusk
        34371,34372,                // Leather Chestguard / Gauntlets of the Sun
        34375,                      // Sun-Drenched Scale Chestguard
        30039,30040,30041,          // Boots of Utter Darkness / Belt of Deep Shadow / Boots of Natural Grace
        33122,                      // Cloak of Darkness

        // ─ Blacksmithing BoP weapons ─
        28429,28430,                // Lionheart Champion / Executioner
        28433,                      // Wicked Edge of the Planes
        28435,28436,                // Mooncleaver / Bloodmoon
        28438,28439,                // Dragonmaw / Dragonstrike
        // BS BoP (BT/Sunwell patterns)
        32570,                      // Swiftsteel Shoulders
        34377,                      // Hard Khorium Battleplate
        34380,                      // Sunblessed Gauntlets

        // ─ Engineering BoP goggles ─
        32461,32474,32475,32479,32480,32494,

        // ─ Jewelcrafting BoP necks & rings ─
        24114,24116,24121,          // Braided Eternium Chain / Eye of the Night / Chain of Twilight Owl
        34358,34359,34360,          // Hard Khorium Choker / Pendant of Sunfire / Amulet of Flowing Life
        34361,34362,34363,          // Hard Khorium Band / Loop of Forged Power / Ring of Flowing Life

        // ─ Alchemy BoP trinkets ─
        13503,35750,                // Alchemist's Stone / Redeemer's Alchemist Stone
    ]);

    // Returns the profession name if this item is BoP and REQUIRES that profession, else null
    function itemProfession(itemId) {
        if (!BOP_PROFESSION_IDS.has(Number(itemId))) return null;
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
        } else if (prev === 'spec') {
            // If we came from PvP (skipped phase), reset PvP state
            state.selectedSpec = null; state.isPvP = false; state.pvpKey = null;
            state.selectedPhase = null;
            headerTitle.textContent = state.selectedClass;
            headerTitle.style.color = CLASS_META[state.selectedClass].color;
            headerSub.textContent = 'Choose your spec';
            showStep(stepSpec);
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
                } else {
                    headerSub.textContent = 'Choose phase';
                    renderPhaseGrid();
                    state.history.push('spec');
                    showStep(stepPhase);
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
    function renderSlotGroup(slot, slotGroups, enchantLookup) {
        const si = slotGroups[slot];
        if (!si || !si.length) return '';

        // Display name: "Ring 1" → "Ring", "Trinket 2" → "Trinket" etc.
        const slotDisplayName = slot.replace(/ [12]$/, '');

        const bis = si[0], alts = si.slice(1);
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

        let html = `<div class="slot-group" data-slot="${slot}">
            <div class="slot-header" data-item-id="${bis.itemId}">
                <div class="slot-icon">${bisIconHtml}</div>
                <div class="slot-content">
                    <div class="slot-name">${slotDisplayName}</div>
                    <div class="slot-bis-item">
                        <div class="slot-bis-name ${bisQuality}">${whItem(bis.itemId, bis.name || 'Item #'+bis.itemId, bisQuality)}</div>
                    </div>
                    ${enchantHtml}
                    ${srcText ? `<div class="slot-source">${srcText}</div>` : ''}
                    ${bisPvpHtml}
                    ${clonedNote}
                </div>
                <div class="slot-meta">
                    <span class="slot-badge ${badgeCls}"${badgeStyle}>${bis.rank}</span>
                    ${alts.length ? `<span class="slot-alt-count">+${alts.length}</span>` : ''}
                    ${alts.length ? '<span class="slot-expand">▾</span>' : ''}
                </div>
            </div>`;

        if (alts.length) {
            html += '<div class="slot-alts">';
            alts.forEach((alt, i) => {
                const ap = alt.rank?.toLowerCase().includes('pvp');
                const ac = ap ? 'bis' : (alt.rank.toLowerCase().startsWith('bis') ? 'bis' : 'alt');
                const as = ap ? ' style="background:#c41e3a"' : '';
                const altSrc = getItemSource(alt.itemId);
                const altSrcText = altSrc ? `${srcEmoji(altSrc.sourceType)} ${altSrc.source || altSrc.sourceType}` : '';
                const altQuality = pvpQualityClass(alt);
                const altIconHtml = itemIcon(alt.itemId, 'small', 'alt-icon ' + altQuality);
                const altPvpHtml = pvpMetaHtml(alt);
                html += `<div class="alt-item" data-item-id="${alt.itemId}">
                    ${altIconHtml}
                    <div class="slot-content">
                        <span class="alt-name ${altQuality}">${whItem(alt.itemId, alt.name || 'Item #'+alt.itemId, altQuality)}</span>
                        ${altSrcText ? `<div class="slot-source">${altSrcText}</div>` : ''}
                        ${altPvpHtml}
                        ${getNote(alt.itemId)}
                    </div>
                    <span class="slot-badge ${ac}"${as}>${alt.rank}</span>
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

    function renderProfessionFilter(professions) {
        if (!professions.length || state.isPvP) {
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

        let html = '<div class="prof-filter-label">🔨 Professions</div>';
        html += hintHtml('prof-filter', '🔧',
            `Some BiS items require a specific <strong>profession</strong> to equip (e.g. Tailoring BoP robes). ` +
            `Tap a profession to <strong>toggle it off</strong> — the list will update to show the next-best alternative for that slot.`
        );
        html += '<div class="prof-filter-chips">';
        for (const prof of professions) {
            const active = !state.excludedProfessions.has(prof);
            const icon = PROFESSION_ICONS[prof] || 'inv_misc_questionmark';
            html += `<button class="prof-chip${active ? ' active' : ''}" data-prof="${prof}">
                <img src="${WH_ICON_CDN}/small/${icon}.jpg" alt="${prof}" class="prof-chip-icon">
                <span>${prof}</span>
            </button>`;
        }
        html += '</div>';
        professionFilter.innerHTML = html;
        professionFilter.classList.remove('hidden');
        bindHintDismiss(professionFilter);

        professionFilter.querySelectorAll('.prof-chip').forEach(chip => {
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
        function splitDualSlot(buf, slotName1, slotName2) {
            if (!buf.length) return;
            // Sort: BIS first (by original order which is already ranked)
            const bisItems = buf.filter(i => i.rank?.toLowerCase().startsWith('bis') || i.rank?.toLowerCase().includes('pvp'));
            const altItems = buf.filter(i => !bisItems.includes(i));
            const allSorted = [...bisItems, ...altItems];

            // Slot 1: first item is BIS, rest are alts
            // Slot 2: second BIS item (or first alt) is primary, rest are alts
            const primary1 = allSorted[0];
            const primary2 = allSorted[1];
            const altsFor1 = allSorted.slice(1); // everything else is alt for slot 1
            const altsFor2 = allSorted.filter((_, i) => i !== 1); // remove primary2, keep others as alts

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
            // Clone MH items as OH recommendations
            slotGroups['Off Hand'] = slotGroups['Main Hand'].map(i => ({
                ...i, slot: 'Off Hand', _clonedFromMH: true
            }));
        }

        // ── Profession filter: discover which professions appear in BIS items ──
        // Only show toggles for professions that have a BIS item (rank #1 in slot),
        // not for professions that only appear among alternatives.
        const professionSet = new Set();
        if (!pvpSpecData) {
            for (const [slot, items] of Object.entries(slotGroups)) {
                if (!items.length) continue;
                const bisItem = items[0];
                const prof = itemProfession(bisItem.itemId);
                if (prof) professionSet.add(prof);
            }
        }
        renderProfessionFilter([...professionSet].sort());

        // ── Apply profession filter: remove excluded profession items ──
        if (state.excludedProfessions.size && !pvpSpecData) {
            for (const [slot, items] of Object.entries(slotGroups)) {
                slotGroups[slot] = items.filter(i => !isItemExcluded(i.itemId));
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
            const bis = si[0];
            const hasEnchant = !!enchantLookup[slot];
            pdHtml += `<div class="pd-slot" data-pd-slot="${slot}" title="${bis.name || slot}">
                ${itemIcon(bis.itemId, 'medium', 'pd-slot-icon ' + qualityClass(bis.itemId))}
                <span class="pd-slot-label">${PD_LABELS[slot] || slot}</span>
                ${hasEnchant ? '<span class="pd-enchant-dot"></span>' : ''}
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

        // ── Determine which weapon sections to show ──
        // Use WEAPON_STYLE config if available, else auto-detect from slot data
        const weapStyle = WEAPON_STYLE[specKey] || 'auto';
        let showDW, show2H;
        if (weapStyle === 'dw')   { showDW = hasOneHanders; show2H = false; }
        else if (weapStyle === '2h') { showDW = false; show2H = has2H; }
        else if (weapStyle === 'both') { showDW = hasOneHanders; show2H = has2H; }
        else {
            // auto: show both if data has both; if only one type, show only that
            showDW = hasOneHanders;
            show2H = has2H;
        }

        // Helper: render a category header
        function categoryHeader(icon, title, extraClass) {
            return `<div class="weapon-section-header ${extraClass || ''}">
                <span class="weapon-section-icon">${icon}</span>
                <span class="weapon-section-title">${title}</span>
            </div>`;
        }

        // ── Armor ──
        html += categoryHeader('🛡️', 'Armor', 'first-category');
        for (const slot of ARMOR_SLOTS) {
            html += renderSlotGroup(slot, slotGroups, enchantLookup);
        }

        // ── Jewelry (Ring 1, Ring 2, Trinket 1, Trinket 2) ──
        html += categoryHeader('💎', 'Jewelry');
        for (const slot of JEWELRY_SLOTS) {
            html += renderSlotGroup(slot, slotGroups, enchantLookup);
        }

        // ── Weapons ──
        if (showDW) {
            const oneHandTitle = isDualWield ? 'Dual-Wield' : 'Main Hand / Off Hand';
            html += categoryHeader('⚔️', oneHandTitle);
            if (hasMH) html += renderSlotGroup('Main Hand', slotGroups, enchantLookup);
            if (hasOH) html += renderSlotGroup('Off Hand', slotGroups, enchantLookup);
        }

        if (show2H) {
            html += categoryHeader('🗡️', 'Two-Handed');
            html += renderSlotGroup('Two Hand', slotGroups, enchantLookup);
        }

        if (slotGroups['Ranged/Relic']?.length) {
            html += categoryHeader('🏹', 'Ranged / Relic');
            html += renderSlotGroup('Ranged/Relic', slotGroups, enchantLookup);
        }

        slotList.innerHTML = html;
        bindHintDismiss(slotList);

        // Events — expand/collapse slot-header (but open modal if icon/name clicked)
        slotList.querySelectorAll('.slot-header').forEach(hdr => {
            hdr.addEventListener('click', e => {
                const whEl = e.target.closest('[data-wh-item]');
                if (whEl) return; // handled by delegation below
                const grp = hdr.closest('.slot-group');
                if (grp.querySelector('.slot-alts')) grp.classList.toggle('open');
            });
        });

        // Open modal on alt-item click
        slotList.querySelectorAll('.alt-item').forEach(el => {
            el.addEventListener('click', e => {
                const whEl = e.target.closest('[data-wh-item]');
                if (whEl) return; // handled by delegation below
                openItemModal(el.dataset.itemId, el.closest('.slot-group').dataset.slot);
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
    }

    // Compact source emoji
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
        // Build effective gems including inherited meta gem
        const modalGems = [...(phaseData?.gems || [])];
        if (!modalGems.find(g => g.isMeta) && specData && state.selectedPhase != null) {
            const phases = Object.keys(specData.phases).map(Number).sort();
            const lower = phases.filter(p => p < state.selectedPhase).reverse();
            const higher = phases.filter(p => p > state.selectedPhase);
            for (const p of [...lower, ...higher]) {
                const pg = specData.phases[p]?.gems || [];
                const found = pg.find(g => g.isMeta);
                if (found) { modalGems.unshift(found); break; }
            }
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
        html += `<a href="https://www.wowhead.com/${WH}/item=${itemId}" target="_blank" rel="noopener" class="modal-wowhead-btn">
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

        html += `<a href="https://www.wowhead.com/${WH}/item=${itemId}" target="_blank" rel="noopener" class="modal-wowhead-btn">
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

    // ─── Initialise hints ────────────────────────────────────────────
    // Hide the static class-pick hint if already dismissed
    if (_dismissed.has('class-pick')) {
        const h = $('hintClass');
        if (h) h.remove();
    }
    bindHintDismiss(document);
})();
