// Item restrictions for TBC Classic
// UNIQUE: item cannot be equipped in both MH and OH simultaneously
// MAIN_HAND_ONLY: item can only be equipped in the main hand slot
//
// Sources: Wowhead item tooltips
// Add item IDs here when needed — used by app.js to prevent invalid dual-wield suggestions.

const ITEM_UNIQUE = new Set([
    // Weapons — Unique (cannot dual-wield two of the same)
    28438,  // Dragonmaw
    28439,  // Dragonstrike
    32837,  // Warglaive of Azzinoth (MH)
    32838,  // Warglaive of Azzinoth (OH) — pair is fine, but two MH not possible
    32471,  // Shard of Azzinoth
    30082,  // Talon of Azshara
    32944,  // Talon of the Phoenix
    32946,  // Claw of Molten Fury
    33495,  // Rage
    // Rings — Unique (cannot wear two of the same ring)
    // Most rings in TBC are Unique-Equipped — list the ones we recommend twice
    30738,  // Ring of Reciprocity
    28757,  // Ring of a Thousand Marks
    28730,  // Mithril Band of the Unscarred
    30834,  // Shapeshifter's Signet
    29379,  // Ring of Arathi Warlords
    31920,  // Shaffar's Band of Brutality
    29997,  // Band of the Ranger-General
    32497,  // Stormrage Signet Ring
    32335,  // Unstoppable Aggressor's Ring
    34189,  // Band of Ruinous Delight
    34361,  // Hard Khorium Band
    // Trinkets — Unique
    28830,  // Dragonspine Trophy
    21670,  // Badge of the Swarmguard
    29383,  // Bloodlust Brooch
    28288,  // Abacus of Violent Odds
    28034,  // Hourglass of the Unraveller
    30627,  // Tsunami Talisman
    32505,  // Madness of the Betrayer
    34427,  // Blackened Naaru Sliver
    34472,  // Shard of Contempt
    33831,  // Berserker's Call
]);

// Items that can ONLY be equipped in the Main Hand (not Off Hand)
// These should never appear as OH recommendations for any spec
const ITEM_MAIN_HAND_ONLY = new Set([
    28438,  // Dragonmaw (axe — MH only in game)
    28439,  // Dragonstrike (axe — MH only)
    28767,  // The Decapitator
    29348,  // The Bladefist
    30103,  // Fang of Vashj
    32471,  // Shard of Azzinoth
    32837,  // Warglaive of Azzinoth (MH version)
    32944,  // Talon of the Phoenix
    32946,  // Claw of Molten Fury
    33495,  // Rage
    34331,  // Hand of the Deceiver
    28432,  // Black Planar Edge
    28433,  // Wicked Edge of the Planes
    28657,  // Fool's Bane (Main Hand only)
    29962,  // Heartrazor
    32236,  // Rising Tide
    32262,  // Syphon of the Nathrezim
]);
