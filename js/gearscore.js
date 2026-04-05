/* ═══════════════════════════════════════════════════════════════════════
   GearScore Calculator — TBC Port (from GearScoreLite addon)
   ═══════════════════════════════════════════════════════════════════════ */

const GearScore = (() => {
    // Slot modifiers (how much each slot contributes to GearScore)
    const SLOT_MOD = {
        'Head': 1.0000, 'Neck': 0.5625, 'Shoulder': 0.7500,
        'Back': 0.5625, 'Chest': 1.0000, 'Wrist': 0.5625,
        'Hands': 0.7500, 'Waist': 0.7500, 'Legs': 1.0000,
        'Feet': 0.7500, 'Ring': 0.5625, 'Trinket': 0.5625,
        'Main Hand': 1.0000, 'Off Hand': 1.0000,
        'Two Hand': 2.0000, 'Ranged/Relic': 0.3164,
        'Main Hand~Off Hand': 1.0000
    };

    // Formula coefficients
    const FORMULA = {
        A: { // ItemLevel > 92
            2: { A: 73, B: 1 },   // Uncommon
            3: { A: 81.375, B: 0.8125 }, // Rare
            4: { A: 91.45, B: 0.65 }  // Epic
        },
        B: { // ItemLevel <= 92
            2: { A: 8, B: 2 },
            3: { A: 0.75, B: 1.8 },
            4: { A: 26, B: 1.2 }
        }
    };

    // Color thresholds for GS display
    const QUALITY_COLORS = [
        { max: 1000, color: '#9d9d9d', label: 'Poor' },
        { max: 2000, color: '#ffffff', label: 'Common' },
        { max: 3000, color: '#1eff00', label: 'Uncommon' },
        { max: 4000, color: '#0070dd', label: 'Rare' },
        { max: 5000, color: '#a335ee', label: 'Epic' },
        { max: 6000, color: '#ff8000', label: 'Legendary' }
    ];

    // Known item levels by item ID (curated TBC items)
    // In a real app, you'd fetch these from an API
    const ITEM_LEVELS = {};

    /**
     * Calculate GearScore for a single item
     * @param {number} itemLevel - The item's iLevel
     * @param {number} rarity - 2=uncommon, 3=rare, 4=epic, 5=legendary
     * @param {string} slot - Equipment slot name
     * @returns {number} GearScore contribution
     */
    function calcItemScore(itemLevel, rarity, slot) {
        if (!itemLevel || !rarity || !slot) return 0;

        const slotMod = SLOT_MOD[slot] || 0.75;
        let qualityScale = 1;
        let effectiveRarity = rarity;

        if (rarity === 5) { qualityScale = 1.3; effectiveRarity = 4; }
        else if (rarity <= 1) { qualityScale = 0.005; effectiveRarity = 2; }

        const table = itemLevel > 92 ? FORMULA.A : FORMULA.B;
        const coeffs = table[effectiveRarity];
        if (!coeffs) return 0;

        const scale = 2.97;
        let gs = Math.floor(((itemLevel - coeffs.A) / coeffs.B) * slotMod * scale * qualityScale);
        return Math.max(0, gs);
    }

    /**
     * Estimate total GearScore from a set of items
     * @param {Array} items - Array of {itemLevel, rarity, slot}
     * @returns {{ gearScore: number, avgItemLevel: number }}
     */
    function calcTotalScore(items) {
        let totalGS = 0;
        let totalIL = 0;
        let count = 0;

        for (const item of items) {
            const gs = calcItemScore(item.itemLevel, item.rarity, item.slot);
            totalGS += gs;
            totalIL += (item.itemLevel || 0);
            count++;
        }

        return {
            gearScore: Math.floor(totalGS),
            avgItemLevel: count > 0 ? Math.floor(totalIL / count) : 0
        };
    }

    /**
     * Get display color for a GearScore value
     */
    function getColor(gs) {
        for (const q of QUALITY_COLORS) {
            if (gs <= q.max) return q.color;
        }
        return '#ff8000';
    }

    /**
     * Get quality label for a GearScore value
     */
    function getLabel(gs) {
        for (const q of QUALITY_COLORS) {
            if (gs <= q.max) return q.label;
        }
        return 'Legendary';
    }

    /**
     * Estimate item level from item ID using rough phase mapping
     */
    function estimateItemLevel(itemId, phase) {
        // Known iLevel ranges per TBC phase
        const phaseILevels = {
            0: { epic: 110, rare: 105, uncommon: 100 },  // Pre-BiS (dungeons)
            1: { epic: 125, rare: 115, uncommon: 105 },   // Kara/Gruul/Mag
            2: { epic: 133, rare: 120, uncommon: 110 },   // SSC/TK
            3: { epic: 146, rare: 130, uncommon: 115 },   // BT/Hyjal
            4: { epic: 154, rare: 135, uncommon: 120 },   // ZA/Badge
            5: { epic: 164, rare: 141, uncommon: 128 }    // SWP
        };
        const p = phaseILevels[phase] || phaseILevels[0];
        return p.epic; // Assume epic for BiS items
    }

    return {
        calcItemScore,
        calcTotalScore,
        getColor,
        getLabel,
        estimateItemLevel,
        SLOT_MOD
    };
})();
