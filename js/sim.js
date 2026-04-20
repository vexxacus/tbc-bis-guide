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
    'Ranged/Relic':  'Ranged',
};

// Spell ID (from data.json enchants) → wowsims enchant item ID
// ONLY include enchants that wowsims actually knows — unknown IDs crash the sim.
const SPELL_TO_ENCHANT_ID = {
    // Head — Glyph of Ferocity (Cenarion Expedition exalted)
    35452: 29192,
    // Head — Glyph of Power (Sha'tar exalted) — caster (wowsims ID: 29191)
    35455: 29191,
    29191: 29191,
    // Shoulder — Greater Inscription of Vengeance (Aldor exalted)
    29483: 28888,
    // Shoulder — Greater Inscription of the Orb (Scryer exalted) — caster
    29467: 28911,
    28911: 28911,
    // Back — Enchant Cloak - Greater Agility
    34004: 34004,
    // Back — Enchant Cloak - Subtlety / spell shadow power (no wowsims ID, skip)
    // Chest — Enchant Chest - Exceptional Stats
    27960: 24003,
    // Wrist — Enchant Bracer - Brawn (Strength)
    27899: 27899,
    // Wrist — Enchant Bracer - Spellpower (wowsims ID: 22534, not the spell ID 27917)
    27917: 22534,
    // Hands — Enchant Gloves - Major Strength
    33995: 33995,
    // Hands — Enchant Gloves - Spell Strike (wowsims ID: 28271, not spell ID 33997)
    33997: 28271,
    // Legs — Nethercobra Leg Armor
    35490: 29535,
    29535: 29535,
    // Legs — Runic Spellthread — caster
    31368: 24274,
    24274: 24274,
    // Feet — Enchant Boots - Dexterity
    34007: 28279,
    28279: 28279,
    // Weapon — Mongoose
    27984: 22559,
    22559: 22559,
    // Weapon — Executioner
    42974: 33307,
    33307: 33307,
    // Weapon — Major Agility (1H — not in wowsims all_enchants.go, closest is 22552 Major Striking; skip)
    // 27977: skipped — no matching wowsims enchant
    // Weapon — Soulfrost (shadow/frost power) — caster (wowsims ID: 22561)
    27975: 22561,
    // Weapon — Sunfire (fire/arcane power) — caster (wowsims ID: 22560)
    27981: 22560,
    // Weapon — Superior Wizard Oil — caster
    // (applied at use, not enchant slot in wowsims — skip)
    // Ring — Enchant Ring - Stats (requires enchanting profession) (wowsims ID: 22538)
    27927: 22538,
    // NOTE: Scope enchants (30252 Khorium Scope etc.) are NOT in wowsims — skip them
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
    const regularGems = (gems || []).filter(g => !g.isMeta).map(g => parseInt(g.itemId));
    const metaGem     = (gems || []).find(g => g.isMeta);
    const metaGemId   = metaGem ? parseInt(metaGem.itemId) : 0;

    for (const [bisSlot, items] of Object.entries(slotGroups)) {
        if (!items || !items.length) continue;

        // Skip inactive weapon slots based on weapon mode
        if (weaponMode === '2h' && (bisSlot === 'Main Hand' || bisSlot === 'Off Hand')) continue;
        if (weaponMode === 'dw' && bisSlot === 'Two Hand') continue;

        const wsSlot = SLOT_MAP[bisSlot];
        if (!wsSlot) continue;

        const item = getActiveItemFn(bisSlot, items);
        if (!item || !item.itemId) continue;

        const id = parseInt(item.itemId);
        if (!id) continue;

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
    // Defense: show rating AND skill value; wowsims formula: skill = CHARACTER_LEVEL*5 + rating/DEFENSE_RATING_PER_DEFENSE
    29: { label: 'Defense',      fmt: v => {
        const skill = DEFENSE_BASE_SKILL + v / DEFENSE_RATING_PER_DEFENSE;
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
};
const SIM_STAT_ORDER_TANK = [35, 2, 27, 29, 32, 33, 30, 31, 999, 0, 1, 18];

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
 * @param {string} specKey — e.g. 'Warrior-Fury', 'Priest-Shadow'
 */
async function computeStatsForBis(slotGroups, getActiveItemFn, weaponMode, enchantLookup, gems, specKey) {
    if (!_simReady) return null;
    const gearSlots = buildGearSlotsFromBis(slotGroups, getActiveItemFn, weaponMode, enchantLookup, gems);
    if (!gearSlots.length) return null;
    console.log('[sim] computeStats gearSlots:', JSON.stringify(gearSlots.map(s => s.id)));
    try {
        return await _simBridge.computeStats(gearSlots, specKey);
    } catch (e) {
        console.error('[sim] computeStats error:', e);
        return null;
    }
}

/**
 * Run DPS simulation for Fury Warrior.
 */
async function simulateFuryWarrior(slotGroups, getActiveItemFn, weaponMode, enchantLookup, gems, onProgress, iterations = 3000) {
    const gearSlots = buildGearSlotsFromBis(slotGroups, getActiveItemFn, weaponMode, enchantLookup, gems);
    if (!gearSlots.length) throw new Error('No gear selected');
    return _simBridge.runFuryWarrior(gearSlots, onProgress, iterations);
}

/**
 * Run DPS simulation for Arms Warrior (2H).
 */
async function simulateArmsWarrior(slotGroups, getActiveItemFn, weaponMode, enchantLookup, gems, onProgress, iterations = 3000) {
    // Arms always uses 2H mode
    const gearSlots = buildGearSlotsFromBis(slotGroups, getActiveItemFn, '2h', enchantLookup, gems);
    if (!gearSlots.length) throw new Error('No gear selected');
    return _simBridge.runArmsWarrior(gearSlots, onProgress, iterations);
}

/**
 * Run DPS simulation for Shadow Priest.
 * Shadow Priest can use Staff (2h) or MH+OH — weapon mode follows BiS selection.
 */
async function simulateShadowPriest(slotGroups, getActiveItemFn, weaponMode, enchantLookup, gems, onProgress, iterations = 3000) {
    const gearSlots = buildGearSlotsFromBis(slotGroups, getActiveItemFn, weaponMode, enchantLookup, gems);
    if (!gearSlots.length) throw new Error('No gear selected');
    return _simBridge.runShadowPriest(gearSlots, onProgress, iterations);
}
