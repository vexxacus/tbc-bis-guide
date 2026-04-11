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
    // Shoulder — Greater Inscription of Vengeance (Aldor exalted)
    29483: 28888,
    // Back — Enchant Cloak - Greater Agility
    34004: 34004,
    // Chest — Enchant Chest - Exceptional Stats
    27960: 24003,
    // Wrist — Enchant Bracer - Brawn (Strength)
    27899: 27899,
    // Hands — Enchant Gloves - Major Strength
    33995: 33995,
    // Legs — Nethercobra Leg Armor
    35490: 29535,
    29535: 29535,
    // Feet — Enchant Boots - Dexterity
    34007: 28279,
    28279: 28279,
    // Weapon — Mongoose
    27984: 22559,
    22559: 22559,
    // Weapon — Executioner (42974 is spell ID; wowsims enchant item ID is 33307)
    42974: 33307,
    33307: 33307,
    // Weapon — Major Agility
    27977: 27977,
    // Ring — Enchant Ring - Stats (requires enchanting profession)
    27927: 27927,
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
 */
const SIM_STAT_LABELS = {
     0: { label: 'Strength',     fmt: v => Math.round(v) },
     1: { label: 'Agility',      fmt: v => Math.round(v) },
     2: { label: 'Stamina',      fmt: v => Math.round(v) },
    18: { label: 'Attack Power', fmt: v => Math.round(v) },
    19: { label: 'Hit',          fmt: v => `${Math.round(v)} (${(v / 15.76).toFixed(2)}%)` },
    20: { label: 'Crit',         fmt: v => `${Math.round(v)} (${(v / 22.08).toFixed(2)}%)` },
    21: { label: 'Haste',        fmt: v => `${Math.round(v)} (${(v / 15.76).toFixed(2)}%)` },
    22: { label: 'Armor Pen',    fmt: v => Math.round(v) },
    23: { label: 'Expertise',    fmt: v => `${Math.round(v)} (${Math.floor(v / 3.9375)} skill)` },
    35: { label: 'Health',       fmt: v => Math.round(v) },
};
const SIM_STAT_ORDER = [35, 0, 1, 2, 18, 19, 20, 21, 22, 23];

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
 */
async function computeStatsForBis(slotGroups, getActiveItemFn, weaponMode, enchantLookup, gems) {
    if (!_simReady) return null;
    const gearSlots = buildGearSlotsFromBis(slotGroups, getActiveItemFn, weaponMode, enchantLookup, gems);
    if (!gearSlots.length) return null;
    try {
        return await _simBridge.computeStats(gearSlots);
    } catch (e) {
        console.warn('[sim] computeStats error:', e.message);
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
