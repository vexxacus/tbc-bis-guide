/* ═══════════════════════════════════════════════════════════════════════
   sim.js — Wowsims WASM bridge for the TBC BiS app
   Handles: stat computation + DPS simulation for supported specs
   ═══════════════════════════════════════════════════════════════════════ */

// Slot name (BIS app) → wowsims slot key
const SLOT_MAP = {
    'Head':          'Head',
    'Neck':          'Neck',
    'Shoulder':      'Shoulder',
    'Back':          'Back',
    'Chest':         'Chest',
    'Wrist':         'Wrist',
    'Hands':         'Hands',
    'Waist':         'Waist',
    'Legs':          'Legs',
    'Feet':          'Feet',
    'Ring 1':        'Finger1',
    'Ring 2':        'Finger2',
    'Trinket 1':     'Trinket1',
    'Trinket 2':     'Trinket2',
    'Main Hand':     'MainHand',
    'Off Hand':      'OffHand',
    'Two Hand':      'MainHand',   // 2H goes in MH slot for wowsims
    'Weapon':        'MainHand',   // some data uses "Weapon" for caster MH items
    'Ranged/Relic':  'Ranged',
};

// Spell ID (from data.json enchants) → wowsims enchant item ID
// ONLY include enchants that wowsims actually knows — unknown IDs crash the sim.
const SPELL_TO_ENCHANT_ID = {
    // ── Head ──────────────────────────────────────────────────────────────────
    // Glyph of the Defender (+16 def, +17 dodge) — Keepers of Time exalted
    35477: 29186,
    35443: 29186,
    29186: 29186,
    // Glyph of Power (+22 SP, +14 spell hit) — The Sha'tar exalted
    35455: 29191,
    35447: 29191,   // Classic variant spellId for Glyph of Power
    29191: 29191,
    // Glyph of Ferocity (+34 AP, +16 hit) — Cenarion Expedition exalted
    35452: 29192,
    29192: 29192,
    // Presence of Might (+10 def, +15 stam, +10 dodge, +10 block val) — ZG quest
    24149: 19782,
    19782: 19782,

    // ── Shoulder ──────────────────────────────────────────────────────────────
    // Greater Inscription of the Knight (+15 def, +10 dodge) — Scryer exalted
    35433: 28911,
    28911: 28911,
    // Greater Inscription of Warding (+10 def, +15 dodge) — Aldor exalted
    29480: 28889,
    28889: 28889,
    // Greater Inscription of Vengeance (+30 AP, +10 crit) — Aldor exalted
    29483: 28888,
    28888: 28888,
    35407: 28888,   // Classic variant spellId for Greater Inscription of Vengeance
    // Greater Inscription of Discipline (+18 SP, +10 crit) — Aldor exalted
    35437: 28886,
    28886: 28886,
    // Greater Inscription of the Blade (+15 agi, +20 hit) — Scryer exalted
    28910: 28910,
    // Greater Inscription of the Orb (+12 SP, +15 spell crit) — Scryer exalted
    29467: 28909,
    35406: 28909,   // Classic variant spellId for Greater Inscription of the Orb
    28909: 28909,
    // Might of the Scourge (+26 AP, +14 crit) — Naxx shoulder
    29475: 23548,
    23548: 23548,
    // Inscription of the Knight (Lesser) — fallback
    // 29467: 28911,  // duplicate key removed

    // ── Back ──────────────────────────────────────────────────────────────────
    // Enchant Cloak - Dodge (+12 dodge) — tank cloak
    35316: 33148,
    33148: 33148,
    // Enchant Cloak - Greater Agility (+12 agi)
    34004: 34004,
    // Enchant Cloak - Subtlety (-2% threat)
    25084: 33150,
    33150: 33150,
    // Enchant Cloak - Steelweave (+12 def) — Phase 5
    35279: 35756,
    35756: 35756,

    // ── Chest ─────────────────────────────────────────────────────────────────
    // Enchant Chest - Exceptional Stats (+6 all stats)
    27960: 24003,
    24003: 24003,
    // Enchant Chest - Exceptional Health (+150 hp)
    27957: 27957,
    // Enchant Chest - Defense (+15 def) — Phase 5
    33992: 35500,
    35500: 35500,

    // ── Wrist ─────────────────────────────────────────────────────────────────
    // Enchant Bracer - Major Defense (+12 def)
    22530: 22530,
    // Enchant Bracer - Fortitude (+12 stam)
    22533: 22533,
    // Enchant Bracer - Brawn (+12 str)
    27899: 27899,
    // Enchant Bracer - Spellpower
    27917: 22534,
    22534: 22534,

    // ── Hands ─────────────────────────────────────────────────────────────────
    // Enchant Gloves - Major Strength (+15 str)
    33995: 33995,
    // Enchant Gloves - Spell Strike (+15 spell hit)
    33997: 28271,
    28271: 28271,
    // Enchant Gloves - Major Agility / Superior Agility (+15 agi)
    34082: 33152,
    33152: 33152,
    25080: 33152,   // Superior Agility — same effect, different spellId

    // ── Legs ──────────────────────────────────────────────────────────────────
    // Nethercobra Leg Armor (+50 AP, +12 crit) — DPS
    35490: 29535,
    35488: 29535,   // Classic variant spellId
    29535: 29535,
    // Nethercleft Leg Armor (+40 stam, +12 agi) — tank/hybrid
    35495: 29536,
    29536: 29536,
    // Clefthide Leg Armor (+30 stam, +10 agi) — lesser version
    35492: 29534,
    29534: 29534,
    // Runic Spellthread (+35 SP, +20 stam) — caster
    31368: 24274,
    31372: 24274,   // Classic variant spellId for Runic Spellthread
    24274: 24274,

    // ── Feet ──────────────────────────────────────────────────────────────────
    // Enchant Boots - Dexterity (+12 agi)
    34007: 22544,
    22544: 22544,
    // Enchant Boots - Cat's Swiftness (+6 agi + run speed)
    34008: 28279,
    28279: 28279,
    // Enchant Boots - Fortitude (+12 stam)
    22543: 22543,
    // Enchant Boots - Boar's Speed (+9 stam + run speed)
    35298: 35297,
    35297: 35297,

    // ── Weapon ────────────────────────────────────────────────────────────────
    // Mongoose
    27984: 22559,
    22559: 22559,
    // Enchant 2H Weapon - Major Agility (+35 agi)
    27977: 22556,
    22556: 22556,
    // Executioner (Phase 4)
    42974: 33307,
    33307: 33307,
    // Soulfrost — caster shadow/frost
    27975: 22561,
    22561: 22561,
    // Sunfire — caster fire/arcane
    27981: 22560,
    22560: 22560,
    // Major Intellect — +30 int weapon
    27982: 22555,
    22555: 22555,

    // ── Ring ──────────────────────────────────────────────────────────────────
    // Ring - Stats (+4 all stats)
    27927: 22538,
    22538: 22538,
    // Ring - Striking (+2 weapon damage) — great for feral druids
    27920: 22535,
    22535: 22535,
    // Ring - Spellpower (+12 SP) — enchanter ring enchant
    27924: 22536,
    22536: 22536,

    // ── Shield ────────────────────────────────────────────────────────────────
    // Shield - Intellect (+12 int)
    27945: 22539,
    22539: 22539,
};

/**
 * Build a gearSlots array (format expected by WowSimBridge) from the
 * current BIS selection state.
 * Also passes enchants (from phaseData) and gems (matched to sockets).
 *
 * @param {Object} slotGroups   — { "Head": [{itemId, ...}, ...], ... }
 * @param {Function} getActiveItemFn — function(slot, items) → item
 * @param {string} weaponMode   — 'dw' | '2h' | null
 * @param {Object} enchantLookup — { slotName: { spellId } } from renderBisList
 * @param {Array}  gems         — phase gem list [{ itemId, isMeta, ... }]
 * @returns {Array} gearSlots   — [{ slot, id, enchant, gems }, ...]
 */
function buildGearSlotsFromBis(slotGroups, getActiveItemFn, weaponMode, enchantLookup, gems) {
    const gearSlots = [];
    const usedWsSlots = new Set();  // Track which sim slots are already filled
    const regularGems = (gems || []).filter(g => !g.isMeta).map(g => parseInt(g.itemId));
    const metaGem     = (gems || []).find(g => g.isMeta);
    const metaGemId   = metaGem ? parseInt(metaGem.itemId) : 0;

    // Collect Two Hand item IDs to filter them out of Off Hand
    const twoHandIds = new Set();
    if (slotGroups['Two Hand']) {
        for (const i of slotGroups['Two Hand']) twoHandIds.add(String(i.itemId));
    }

    for (const [bisSlot, items] of Object.entries(slotGroups)) {
        if (!items || !items.length) continue;

        // Skip inactive weapon slots based on weapon mode
        if (weaponMode === '2h' && (bisSlot === 'Main Hand' || bisSlot === 'Off Hand')) continue;
        if (weaponMode === 'dw' && bisSlot === 'Two Hand') continue;
        // In DW mode, skip "Weapon" if we already have "Main Hand" (avoid double MainHand)
        if (weaponMode === 'dw' && bisSlot === 'Weapon') continue;

        const wsSlot = SLOT_MAP[bisSlot];
        if (!wsSlot) continue;

        // Prevent duplicate sim slots (e.g. "Weapon" + "Main Hand" both → MainHand)
        if (usedWsSlots.has(wsSlot)) continue;

        const item = getActiveItemFn(bisSlot, items);
        if (!item || !item.itemId) continue;

        const id = parseInt(item.itemId);
        if (!id) continue;

        // In DW mode, skip Off Hand items that are actually 2H weapons
        if (weaponMode === 'dw' && bisSlot === 'Off Hand' && twoHandIds.has(String(item.itemId))) {
            // Try next non-2H item in the slot
            const altItem = items.find(i => i.itemId && !twoHandIds.has(String(i.itemId)));
            if (!altItem) continue;  // No valid off-hand available
            const altId = parseInt(altItem.itemId);
            if (!altId) continue;
            usedWsSlots.add(wsSlot);
            const slotDisplayName2 = bisSlot.replace(/ [12]$/, '');
            const enchantEntry2 = enchantLookup
                ? (enchantLookup[bisSlot] || enchantLookup[slotDisplayName2] || enchantLookup['Main Hand~Off Hand'])
                : null;
            const enchantId2 = enchantEntry2 ? (SPELL_TO_ENCHANT_ID[enchantEntry2.spellId] || 0) : 0;
            let itemGems2 = [];
            const sockets2 = (typeof ITEM_SOCKETS !== 'undefined' && ITEM_SOCKETS[String(altId)]) || null;
            if (sockets2 && sockets2.length) {
                for (const socketColor of sockets2) {
                    if (socketColor === 'm') { if (metaGemId) itemGems2.push(metaGemId); }
                    else { if (regularGems.length) itemGems2.push(regularGems[0]); }
                }
            }
            gearSlots.push({ slot: wsSlot, id: altId, enchant: enchantId2, gems: itemGems2 });
            continue;
        }

        usedWsSlots.add(wsSlot);

        // Enchant: look up by slot, normalise "Main Hand~Off Hand" → "Main Hand"
        const slotDisplayName = bisSlot.replace(/ [12]$/, '');
        const enchantEntry = enchantLookup
            ? (enchantLookup[bisSlot] || enchantLookup[slotDisplayName] || enchantLookup['Main Hand~Off Hand'])
            : null;
        const enchantId = enchantEntry ? (SPELL_TO_ENCHANT_ID[enchantEntry.spellId] || 0) : 0;

        // Gems: use ITEM_SOCKETS if available to match socket colors
        let itemGems = [];
        const sockets = (typeof ITEM_SOCKETS !== 'undefined' && ITEM_SOCKETS[String(id)]) || null;
        if (sockets && sockets.length) {
            for (const socketColor of sockets) {
                if (socketColor === 'm') {
                    if (metaGemId) itemGems.push(metaGemId);
                } else {
                    // Use first regular gem (simplified — socket bonus matching not critical for sim)
                    if (regularGems.length) itemGems.push(regularGems[0]);
                }
            }
        } else if (regularGems.length) {
            // No socket data — assume 2 gems for most armor pieces
            const isJewelryOrWeapon = ['Trinket1','Trinket2','Finger1','Finger2','MainHand','OffHand','Ranged'].includes(wsSlot);
            if (!isJewelryOrWeapon) itemGems = [regularGems[0], regularGems[0]];
        }

        gearSlots.push({ slot: wsSlot, id, enchant: enchantId, gems: itemGems });
    }

    return gearSlots;
}

/**
 * Stat index → display info (from wowsims common.proto Stat enum)
 * Melee specs (Warrior etc.)
 */
// Rating conversion constants from wowsims sim/core/constants.go & ui/core/constants/mechanics.ts
const MELEE_HIT_RATING_PER_PCT     = 15.77;
const MELEE_CRIT_RATING_PER_PCT    = 22.08;
const MELEE_HASTE_RATING_PER_PCT   = 15.77;
const SPELL_HIT_RATING_PER_PCT     = 12.62;
const SPELL_CRIT_RATING_PER_PCT    = 22.08;
const SPELL_HASTE_RATING_PER_PCT   = 15.77;
const EXPERTISE_PER_QUARTER_PCT    = 3.94;     // 3.94 rating = 0.25% dodge/parry reduction
const DEFENSE_RATING_PER_DEFENSE   = 2.3654;   // rating -> defense skill
const BLOCK_RATING_PER_PCT         = 7.8846;
const DODGE_RATING_PER_PCT         = 18.9231;
const PARRY_RATING_PER_PCT         = 23.6538;
// Crit immunity requires 490 defense skill (350 base + 140 extra × 0.04%/skill = 5.6% reduction)
const DEFENSE_SKILL_FOR_CRIT_CAP   = 490;
const DEFENSE_BASE_SKILL            = 350;      // character level 70 × 5

const SIM_STAT_LABELS_MELEE = {
     0: { label: 'Strength',     fmt: v => Math.round(v) },
     1: { label: 'Agility',      fmt: v => Math.round(v) },
     2: { label: 'Stamina',      fmt: v => Math.round(v) },
    18: { label: 'Attack Power', fmt: v => Math.round(v) },
    19: { label: 'Hit',          fmt: v => `${Math.round(v)} (${(v / MELEE_HIT_RATING_PER_PCT).toFixed(2)}%)` },
    20: { label: 'Crit',         fmt: v => `${Math.round(v)} (${(v / MELEE_CRIT_RATING_PER_PCT).toFixed(2)}%)` },
    21: { label: 'Haste',        fmt: v => `${Math.round(v)} (${(v / MELEE_HASTE_RATING_PER_PCT).toFixed(2)}%)` },
    22: { label: 'Armor Pen',    fmt: v => Math.round(v) },
    23: { label: 'Expertise',    fmt: v => `${Math.round(v)} (${Math.floor(v / EXPERTISE_PER_QUARTER_PCT)} skill)` },
    35: { label: 'Health',       fmt: v => Math.round(v) },
};
const SIM_STAT_ORDER_MELEE = [35, 0, 1, 2, 18, 19, 20, 21, 22, 23];

/**
 * Stat labels for caster specs (Shadow Priest etc.)
 * Stat indices from wowsims sim/core/stats/stats.go (iota order):
 *   Strength=0, Agility=1, Stamina=2, Intellect=3, Spirit=4,
 *   SpellPower=5, HealingPower=6, ArcaneSpellPower=7, FireSpellPower=8,
 *   FrostSpellPower=9, HolySpellPower=10, NatureSpellPower=11, ShadowSpellPower=12,
 *   MP5=13, SpellHit=14, SpellCrit=15, SpellHaste=16, SpellPenetration=17,
 *   AttackPower=18, MeleeHit=19, MeleeCrit=20, MeleeHaste=21, ...
 *   Health=35
 */
const SIM_STAT_LABELS_CASTER = {
    35: { label: 'Health',        fmt: v => Math.round(v) },
     2: { label: 'Stamina',       fmt: v => Math.round(v) },
     3: { label: 'Intellect',     fmt: v => Math.round(v) },
     4: { label: 'Spirit',        fmt: v => Math.round(v) },
     5: { label: 'Spell Power',   fmt: v => Math.round(v) },
    12: { label: 'Shadow Power',  fmt: v => Math.round(v) },
    14: { label: 'Spell Hit',     fmt: v => `${Math.round(v)} (${(v / SPELL_HIT_RATING_PER_PCT).toFixed(2)}%)` },
    15: { label: 'Spell Crit',    fmt: v => `${Math.round(v)} (${(v / SPELL_CRIT_RATING_PER_PCT).toFixed(2)}%)` },
    16: { label: 'Spell Haste',   fmt: v => `${Math.round(v)} (${(v / SPELL_HASTE_RATING_PER_PCT).toFixed(2)}%)` },
    13: { label: 'MP5',           fmt: v => Math.round(v) },
};
const SIM_STAT_ORDER_CASTER = [35, 2, 3, 4, 5, 12, 14, 15, 16, 13];

/**
 * Stat labels for Hunter specs
 * Key stats: Health, Stam, RAP (28), Agility (1), Hit (19), Crit (20), Haste (21), AP (18)
 */
const SIM_STAT_LABELS_HUNTER = {
    35: { label: 'Health',          fmt: v => Math.round(v) },
     2: { label: 'Stamina',         fmt: v => Math.round(v) },
     1: { label: 'Agility',         fmt: v => Math.round(v) },
    28: { label: 'Ranged AP',       fmt: v => Math.round(v) },
    18: { label: 'Attack Power',    fmt: v => Math.round(v) },
    19: { label: 'Melee Hit',       fmt: v => `${Math.round(v)} (${(v / MELEE_HIT_RATING_PER_PCT).toFixed(2)}%)` },
    20: { label: 'Melee Crit',      fmt: v => `${Math.round(v)} (${(v / MELEE_CRIT_RATING_PER_PCT).toFixed(2)}%)` },
    21: { label: 'Melee Haste',     fmt: v => `${Math.round(v)} (${(v / MELEE_HASTE_RATING_PER_PCT).toFixed(2)}%)` },
    22: { label: 'Armor Pen',       fmt: v => Math.round(v) },
};
const SIM_STAT_ORDER_HUNTER = [35, 2, 1, 28, 18, 19, 20, 21, 22];

/**
 * Stat labels for healer specs (Holy Priest, Holy Paladin, Resto Shaman, Resto Druid)
 * Key stats: Health, Stamina, Intellect, Spirit, Spell Power, Healing Power,
 *            Spell Crit, Spell Haste, MP5
 * HealingPower=6
 */
const SIM_STAT_LABELS_HEALER = {
    35: { label: 'Health',        fmt: v => Math.round(v) },
     2: { label: 'Stamina',       fmt: v => Math.round(v) },
     3: { label: 'Intellect',     fmt: v => Math.round(v) },
     4: { label: 'Spirit',        fmt: v => Math.round(v) },
     5: { label: 'Spell Power',   fmt: v => Math.round(v) },
     6: { label: 'Healing Power', fmt: v => Math.round(v) },
    15: { label: 'Spell Crit',    fmt: v => `${Math.round(v)} (${(v / SPELL_CRIT_RATING_PER_PCT).toFixed(2)}%)` },
    16: { label: 'Spell Haste',   fmt: v => `${Math.round(v)} (${(v / SPELL_HASTE_RATING_PER_PCT).toFixed(2)}%)` },
    13: { label: 'MP5',           fmt: v => Math.round(v) },
};
const SIM_STAT_ORDER_HEALER = [35, 2, 3, 4, 5, 6, 15, 16, 13];

/**
 * Stat labels for tank specs (Bear Druid, Prot Warrior)
 * Key stats: Health, Stamina, Armor, Defense, Dodge, Parry, Block + some threat stats
 *
 * Defense (idx 29) = raw defense rating; skill = 350 + rating/2.3654
 * Crit-immunity requires defense skill >= 490 (i.e. 140 extra skill = 5.6% / 0.04% per skill)
 * Dodge/Parry/Block (idx 32/33/30) = raw rating; convert to % using respective constants
 *
 * Index 999 is a sentinel for "Total Avoidance" (computed from dodge + parry + block ratings)
 */
const SIM_STAT_LABELS_TANK = {
    35: { label: 'Health',       fmt: v => Math.round(v) },
     2: { label: 'Stamina',      fmt: v => Math.round(v) },
    27: { label: 'Armor',        fmt: v => Math.round(v) },
    // Defense: show rating AND skill value.
    // Warriors/Paladins: need 490 skill for crit immunity (via defense gear/enchants)
    // Bear Druids: crit immunity is via Survival of the Fittest talent — NOT defense
    //   → badge shown only for warrior/paladin; bear shows plain skill value
    29: { label: 'Defense',      fmt: (v, isBear) => {
        const skill = DEFENSE_BASE_SKILL + v / DEFENSE_RATING_PER_DEFENSE;
        if (isBear) {
            return `${Math.round(v)} (${skill.toFixed(1)} skill)`;
        }
        const critImmune = skill >= DEFENSE_SKILL_FOR_CRIT_CAP;
        const badge = critImmune
            ? `<span class="sim-crit-immune">✔ Crit Immune</span>`
            : `<span class="sim-not-crit-immune">✘ Need ${(DEFENSE_SKILL_FOR_CRIT_CAP - skill).toFixed(1)} more skill</span>`;
        return `${Math.round(v)} (${skill.toFixed(1)} skill) ${badge}`;
    }},
    32: { label: 'Dodge',        fmt: v => `${Math.round(v)} (${(v / DODGE_RATING_PER_PCT).toFixed(2)}%)` },
    33: { label: 'Parry',        fmt: v => `${Math.round(v)} (${(v / PARRY_RATING_PER_PCT).toFixed(2)}%)` },
    30: { label: 'Block',        fmt: v => `${Math.round(v)} (${(v / BLOCK_RATING_PER_PCT).toFixed(2)}%)` },
    31: { label: 'Block Value',  fmt: v => Math.round(v) },
     0: { label: 'Strength',     fmt: v => Math.round(v) },
     1: { label: 'Agility',      fmt: v => Math.round(v) },
    18: { label: 'Attack Power', fmt: v => Math.round(v) },
    // 999 = computed: Total Avoidance (dodge% + parry% + block%) — handled specially in renderSimStats
    999: { label: 'Total Avoidance', fmt: v => `${v.toFixed(2)}%` },
    // 998 = Bear Druid only: static crit-immunity badge via Survival of the Fittest
    998: { label: 'Crit Immunity',   fmt: () => `<span class="sim-crit-immune">✔ Survival of the Fittest</span>` },
};
const SIM_STAT_ORDER_TANK      = [35, 2, 27, 29, 32, 33, 30, 31, 999, 0, 1, 18];
const SIM_STAT_ORDER_TANK_BEAR = [35, 2, 27, 29, 998, 32, 33, 999, 0, 1, 18];
// Bear has no Parry (can't parry in bear form) and no Block — but keep dodge, defense for info

// Backwards-compat aliases used by renderSimStats
const SIM_STAT_LABELS = SIM_STAT_LABELS_MELEE;
const SIM_STAT_ORDER  = SIM_STAT_ORDER_MELEE;

/**
 * Global sim instance (lazily initialized)
 */
let _simBridge = null;
let _simReady  = false;
let _simReadyCallbacks = [];

function getSimBridge() {
    if (_simBridge) return _simBridge;
    _simBridge = new WowSimBridge('/sim_worker.js');
    _simBridge.onReady = () => {
        _simReady = true;
        _simReadyCallbacks.forEach(fn => fn());
        _simReadyCallbacks = [];
    };
    _simBridge.onError = err => console.warn('[sim] WASM error:', err);
    return _simBridge;
}

function onSimReady(fn) {
    if (_simReady) { fn(); return; }
    _simReadyCallbacks.push(fn);
    getSimBridge(); // ensure init
}

/**
 * Compute character stats for current gear selection.
 * Automatically retries after stripping items unknown to wowsims (those that
 * cause a "No item with id: XXXXX" panic in the WASM runtime).
 * @param {string} specKey — e.g. 'Warrior-Fury', 'Priest-Shadow'
 */
// Global caches for items/gems/enchants that wowsims doesn't know about,
// so we don't rediscover them on every call.
const _unknownItemIds    = new Set();
const _unknownGemIds     = new Set();
let   _stripAllEnchants  = false;

async function computeStatsForBis(slotGroups, getActiveItemFn, weaponMode, enchantLookup, gems, specKey) {
    if (!_simReady) return null;
    const gearSlots = buildGearSlotsFromBis(slotGroups, getActiveItemFn, weaponMode, enchantLookup, gems);
    if (!gearSlots.length) return null;

    // Apply previously discovered bad enchants/gems immediately
    if (_stripAllEnchants) for (const s of gearSlots) s.enchant = 0;
    for (const s of gearSlots) s.gems = s.gems.filter(g => !_unknownGemIds.has(g));

    // Retry loop: if wowsims doesn't know an item, remove it and try again.
    let enchantsStripped = _stripAllEnchants;
    let gemsStripped = false;
    for (let attempt = 0; attempt < 30; attempt++) {
        const slots = gearSlots.filter(s => !_unknownItemIds.has(s.id));
        if (!slots.length) return null;
        if (attempt === 0) console.log('[sim] computeStats slots:', slots.length, 'ids:', JSON.stringify(slots.map(s => s.id)));
        try {
            return await _simBridge.computeStats(slots, specKey);
        } catch (e) {
            const msg = e?.message || String(e);
            const matchItem = msg.match(/No item with id:\s*(\d+)/);
            const matchEnchant = msg.match(/No enchant with id:\s*(\d+)/);
            const matchGem = msg.match(/No gem with id:\s*(\d+)/);
            if (matchItem) {
                const badId = parseInt(matchItem[1]);
                console.warn(`[sim] item ${badId} unknown — skipping`);
                _unknownItemIds.add(badId);
            } else if (matchEnchant) {
                console.warn(`[sim] unknown enchant ${matchEnchant[1]} — stripping all enchants`);
                for (const s of gearSlots) s.enchant = 0;
                _stripAllEnchants = true;
                enchantsStripped = true;
            } else if (matchGem) {
                const badGem = parseInt(matchGem[1]);
                console.warn(`[sim] unknown gem ${badGem} — removing`);
                _unknownGemIds.add(badGem);
                for (const s of gearSlots) s.gems = s.gems.filter(g => !_unknownGemIds.has(g));
            } else if (msg.includes('unreachable') || msg.includes('RuntimeError') || msg.includes('panic')) {
                if (!enchantsStripped) {
                    console.warn(`[sim] WASM crash — stripping enchants`);
                    for (const s of gearSlots) s.enchant = 0;
                    _stripAllEnchants = true;
                    enchantsStripped = true;
                } else if (!gemsStripped) {
                    console.warn(`[sim] WASM crash — stripping gems`);
                    for (const s of gearSlots) s.gems = [];
                    gemsStripped = true;
                } else {
                    console.error('[sim] WASM crash — giving up:', msg.substring(0, 200));
                    return null;
                }
            } else {
                console.error('[sim] computeStats error:', msg);
                return null;
            }
        }
    }
    console.error('[sim] computeStats: too many retries, giving up');
    return null;
}

/**
 * Pre-clean gear slots using the global unknown caches.
 */
function _cleanGearSlots(gearSlots) {
    if (_stripAllEnchants) for (const s of gearSlots) s.enchant = 0;
    for (const s of gearSlots) s.gems = s.gems.filter(g => !_unknownGemIds.has(g));
    return gearSlots.filter(s => !_unknownItemIds.has(s.id));
}

/**
 * Retry wrapper for DPS simulations — handles unknown items/enchants/gems.
 */
async function _retrySimDps(runFn, gearSlots) {
    for (let attempt = 0; attempt < 20; attempt++) {
        try {
            return await runFn();
        } catch (e) {
            const msg = e?.message || String(e);
            const matchItem = msg.match(/No item with id:\s*(\d+)/);
            const matchEnchant = msg.match(/No enchant with id:\s*(\d+)/);
            const matchGem = msg.match(/No gem with id:\s*(\d+)/);
            if (matchItem) {
                const badId = parseInt(matchItem[1]);
                console.warn(`[sim-dps] item ${badId} unknown — skipping`);
                _unknownItemIds.add(badId);
                // Remove from gearSlots in-place
                const idx = gearSlots.findIndex(s => s.id === badId);
                if (idx >= 0) gearSlots.splice(idx, 1);
            } else if (matchEnchant) {
                console.warn(`[sim-dps] unknown enchant ${matchEnchant[1]} — stripping`);
                for (const s of gearSlots) s.enchant = 0;
                _stripAllEnchants = true;
            } else if (matchGem) {
                const badGem = parseInt(matchGem[1]);
                console.warn(`[sim-dps] unknown gem ${badGem} — removing`);
                _unknownGemIds.add(badGem);
                for (const s of gearSlots) s.gems = s.gems.filter(g => !_unknownGemIds.has(g));
            } else {
                throw e; // re-throw non-item errors
            }
            if (!gearSlots.length) throw new Error('No gear left after removing unknown items');
        }
    }
    throw new Error('Too many unknown items in DPS sim');
}

/**
 * Run DPS simulation for Fury Warrior.
 */
async function simulateFuryWarrior(slotGroups, getActiveItemFn, weaponMode, enchantLookup, gems, onProgress, iterations = 3000) {
    const gearSlots = _cleanGearSlots(buildGearSlotsFromBis(slotGroups, getActiveItemFn, weaponMode, enchantLookup, gems));
    if (!gearSlots.length) throw new Error('No gear selected');
    return _retrySimDps(() => _simBridge.runFuryWarrior(gearSlots, onProgress, iterations), gearSlots);
}

/**
 * Run DPS simulation for Arms Warrior (2H).
 */
async function simulateArmsWarrior(slotGroups, getActiveItemFn, weaponMode, enchantLookup, gems, onProgress, iterations = 3000) {
    // Arms always uses 2H mode
    const gearSlots = _cleanGearSlots(buildGearSlotsFromBis(slotGroups, getActiveItemFn, '2h', enchantLookup, gems));
    if (!gearSlots.length) throw new Error('No gear selected');
    return _retrySimDps(() => _simBridge.runArmsWarrior(gearSlots, onProgress, iterations), gearSlots);
}

/**
 * Run DPS simulation for Shadow Priest.
 * Shadow Priest can use Staff (2h) or MH+OH — weapon mode follows BiS selection.
 */
async function simulateShadowPriest(slotGroups, getActiveItemFn, weaponMode, enchantLookup, gems, onProgress, iterations = 3000) {
    const gearSlots = _cleanGearSlots(buildGearSlotsFromBis(slotGroups, getActiveItemFn, weaponMode, enchantLookup, gems));
    if (!gearSlots.length) throw new Error('No gear selected');
    return _retrySimDps(() => _simBridge.runShadowPriest(gearSlots, onProgress, iterations), gearSlots);
}

/**
 * Run DPS simulation for Combat Rogue (Swords).
 */
async function simulateRogue(slotGroups, getActiveItemFn, weaponMode, enchantLookup, gems, onProgress, iterations = 3000) {
    const gearSlots = _cleanGearSlots(buildGearSlotsFromBis(slotGroups, getActiveItemFn, weaponMode, enchantLookup, gems));
    if (!gearSlots.length) throw new Error('No gear selected');
    return _retrySimDps(() => _simBridge.runRogue(gearSlots, onProgress, iterations), gearSlots);
}

/**
 * Run DPS simulation for Enhancement Shaman (Orc, DW).
 */
async function simulateEnhShaman(slotGroups, getActiveItemFn, weaponMode, enchantLookup, gems, onProgress, iterations = 3000) {
    const gearSlots = _cleanGearSlots(buildGearSlotsFromBis(slotGroups, getActiveItemFn, weaponMode, enchantLookup, gems));
    if (!gearSlots.length) throw new Error('No gear selected');
    return _retrySimDps(() => _simBridge.runEnhShaman(gearSlots, onProgress, iterations), gearSlots);
}

/**
 * Run DPS simulation for Retribution Paladin (2H).
 */
async function simulateRetPaladin(slotGroups, getActiveItemFn, weaponMode, enchantLookup, gems, onProgress, iterations = 3000) {
    const gearSlots = _cleanGearSlots(buildGearSlotsFromBis(slotGroups, getActiveItemFn, weaponMode, enchantLookup, gems));
    if (!gearSlots.length) throw new Error('No gear selected');
    return _retrySimDps(() => _simBridge.runRetPaladin(gearSlots, onProgress, iterations), gearSlots);
}

/**
 * Run DPS simulation for Feral Druid (Cat).
 * Cat always uses 2H (staff/polearm equipped as 2H weapon).
 */
async function simulateFeralDruid(slotGroups, getActiveItemFn, weaponMode, enchantLookup, gems, onProgress, iterations = 3000) {
    const gearSlots = _cleanGearSlots(buildGearSlotsFromBis(slotGroups, getActiveItemFn, '2h', enchantLookup, gems));
    if (!gearSlots.length) throw new Error('No gear selected');
    return _retrySimDps(() => _simBridge.runFeralCat(gearSlots, onProgress, iterations), gearSlots);
}

/**
 * Run DPS simulation for Balance Druid (Moonkin).
 * Balance can use Staff (2h) or MH+OH — weapon mode follows BiS selection.
 */
async function simulateBalanceDruid(slotGroups, getActiveItemFn, weaponMode, enchantLookup, gems, onProgress, iterations = 3000) {
    const gearSlots = _cleanGearSlots(buildGearSlotsFromBis(slotGroups, getActiveItemFn, weaponMode, enchantLookup, gems));
    if (!gearSlots.length) throw new Error('No gear selected');
    return _retrySimDps(() => _simBridge.runBalanceDruid(gearSlots, onProgress, iterations), gearSlots);
}

/**
 * Run DPS simulation for Elemental Shaman.
 * Ele Shaman can use Staff (2h) or MH+Shield — weapon mode follows BiS selection.
 */
async function simulateEleShaman(slotGroups, getActiveItemFn, weaponMode, enchantLookup, gems, onProgress, iterations = 3000) {
    const gearSlots = _cleanGearSlots(buildGearSlotsFromBis(slotGroups, getActiveItemFn, weaponMode, enchantLookup, gems));
    if (!gearSlots.length) throw new Error('No gear selected');
    return _retrySimDps(() => _simBridge.runEleShaman(gearSlots, onProgress, iterations), gearSlots);
}

/**
 * Run DPS simulation for Affliction Warlock.
 * Affliction uses Succubus sacrifice, SB filler + DoTs.
 */
async function simulateAfflictionWarlock(slotGroups, getActiveItemFn, weaponMode, enchantLookup, gems, onProgress, iterations = 3000) {
    const gearSlots = _cleanGearSlots(buildGearSlotsFromBis(slotGroups, getActiveItemFn, weaponMode, enchantLookup, gems));
    if (!gearSlots.length) throw new Error('No gear selected');
    return _retrySimDps(() => _simBridge.runAfflictionWarlock(gearSlots, onProgress, iterations), gearSlots);
}

async function simulateDestructionWarlock(slotGroups, getActiveItemFn, weaponMode, enchantLookup, gems, onProgress, iterations = 3000) {
    const gearSlots = _cleanGearSlots(buildGearSlotsFromBis(slotGroups, getActiveItemFn, weaponMode, enchantLookup, gems));
    if (!gearSlots.length) throw new Error('No gear selected');
    return _retrySimDps(() => _simBridge.runDestructionWarlock(gearSlots, onProgress, iterations), gearSlots);
}

async function simulateDemonologyWarlock(slotGroups, getActiveItemFn, weaponMode, enchantLookup, gems, onProgress, iterations = 3000) {
    const gearSlots = _cleanGearSlots(buildGearSlotsFromBis(slotGroups, getActiveItemFn, weaponMode, enchantLookup, gems));
    if (!gearSlots.length) throw new Error('No gear selected');
    return _retrySimDps(() => _simBridge.runDemonologyWarlock(gearSlots, onProgress, iterations), gearSlots);
}

async function simulateFireMage(slotGroups, getActiveItemFn, weaponMode, enchantLookup, gems, onProgress, iterations = 3000) {
    const gearSlots = _cleanGearSlots(buildGearSlotsFromBis(slotGroups, getActiveItemFn, weaponMode, enchantLookup, gems));
    if (!gearSlots.length) throw new Error('No gear selected');
    return _retrySimDps(() => _simBridge.runFireMage(gearSlots, onProgress, iterations), gearSlots);
}

async function simulateFrostMage(slotGroups, getActiveItemFn, weaponMode, enchantLookup, gems, onProgress, iterations = 3000) {
    const gearSlots = _cleanGearSlots(buildGearSlotsFromBis(slotGroups, getActiveItemFn, weaponMode, enchantLookup, gems));
    if (!gearSlots.length) throw new Error('No gear selected');
    return _retrySimDps(() => _simBridge.runFrostMage(gearSlots, onProgress, iterations), gearSlots);
}

async function simulateArcaneMage(slotGroups, getActiveItemFn, weaponMode, enchantLookup, gems, onProgress, iterations = 3000) {
    const gearSlots = _cleanGearSlots(buildGearSlotsFromBis(slotGroups, getActiveItemFn, weaponMode, enchantLookup, gems));
    if (!gearSlots.length) throw new Error('No gear selected');
    return _retrySimDps(() => _simBridge.runArcaneMage(gearSlots, onProgress, iterations), gearSlots);
}
