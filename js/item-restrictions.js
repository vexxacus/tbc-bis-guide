// Item restrictions for TBC Classic
// UNIQUE: item cannot be equipped in both MH and OH simultaneously
// MAIN_HAND_ONLY: item can only be equipped in the main hand slot
//
// Sources: Wowhead item tooltips
// Add item IDs here when needed — used by app.js to prevent invalid dual-wield suggestions.

const ITEM_UNIQUE = new Set([
    // Weapons — Unique or Unique-Equipped (confirmed via Wowhead tooltip)
    28429,  // Lionheart Champion
    28430,  // Lionheart Executioner
    28438,  // Dragonmaw
    28439,  // Dragonstrike
    28441,  // Deep Thunder
    28442,  // Stormherald
    28524,  // Emerald Ripper
    28572,  // Blade of the Unrequited
    28658,  // Terestian's Stranglestaff
    28768,  // Malchazeen
    29121,  // Guile of Khoraazi
    29124,  // Vindicator's Brand
    29171,  // Earthwarden
    29359,  // Feral Staff of Lashing
    29962,  // Heartrazor
    29996,  // Rod of the Sun King
    30021,  // Wildfury Greatstaff
    30082,  // Talon of Azshara
    30103,  // Fang of Vashj
    30865,  // Tracker's Blade
    30901,  // Boundless Agony
    32236,  // Rising Tide
    32471,  // Shard of Azzinoth
    32837,  // Warglaive of Azzinoth (MH)
    32838,  // Warglaive of Azzinoth (OH)
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
// Auto-generated from Wowhead tooltip data (inventoryType = "Main Hand")
const ITEM_MAIN_HAND_ONLY = new Set([
    21673,  // Silithid Claw
    23056,  // Hammer of the Twisting Nether
    23554,  // Eternium Runed Blade
    23556,  // Hand of Eternity
    24453,  // Zangartooth Shortblade
    27512,  // The Willbreaker
    27538,  // Lightsworn Hammer
    27543,  // Starlight Dagger
    27741,  // Bleeding Hollow Warhammer
    27846,  // Claw of the Watcher
    27868,  // Runesong Dagger
    27899,  // Mana Wrath
    27905,  // Greatsword of Horrid Dreams
    27937,  // Sky Breaker
    28216,  // Dathrohan's Ceremonial Hammer
    28257,  // Hammer of the Penitent
    28297,  // Gladiator's Spellblade
    28313,  // Gladiator's Right Ripper
    28392,  // Reflex Blades
    28432,  // Black Planar Edge
    28433,  // Wicked Edge of the Planes
    28438,  // Dragonmaw
    28439,  // Dragonstrike
    28522,  // Shard of the Virtuous
    28584,  // Big Bad Wolf's Paw
    28657,  // Fool's Bane
    28767,  // The Decapitator
    28770,  // Nathrezim Mindblade
    28771,  // Light's Justice
    28802,  // Bloodmaw Magus-Blade
    28931,  // High Warlord's Spellblade
    29153,  // Blade of the Archmage
    29155,  // Stormcaller
    29175,  // Gavel of Pure Light
    29185,  // Continuum Blade
    29348,  // The Bladefist
    29353,  // Shockwave Truncheon
    29371,  // Nexus-Claw
    30058,  // Mallet of the Tides
    30095,  // Fang of the Leviathan
    30108,  // Lightfathom Scepter
    30277,  // Ripfang Paw
    30723,  // Talon of the Tempest
    30787,  // Illidari-Bane Mageblade
    30832,  // Gavel of Unearthed Secrets
    30910,  // Tempest of Chaos
    30918,  // Hammer of Atonement
    31142,  // Blade of Trapped Knowledge
    31304,  // The Essence Focuser
    31336,  // Blade of Wizardry
    31342,  // The Ancient Scepter of Sue-Min
    32053,  // Merciless Gladiator's Spellblade
    32237,  // The Maelstrom's Fury
    32450,  // Gladiator's Gavel
    32451,  // Gladiator's Salvation
    32500,  // Crystal Spire of Karabor
    32660,  // Crystalforged Sword
    32837,  // Warglaive of Azzinoth (MH)
    32944,  // Talon of the Phoenix
    32946,  // Claw of Molten Fury
    32963,  // Merciless Gladiator's Gavel
    32964,  // Merciless Gladiator's Salvation
    33283,  // Amani Punisher
    33354,  // Wub's Cursed Hexblade
    33467,  // Blade of Twisted Visions
    33468,  // Dark Blessing
    33495,  // Rage
    33687,  // Vengeful Gladiator's Gavel
    33737,  // Vengeful Gladiator's Right Ripper
    33743,  // Vengeful Gladiator's Salvation
    33763,  // Vengeful Gladiator's Spellblade
    34009,  // Hammer of Judgement
    34176,  // Reign of Misery
    34199,  // Archon's Gavel
    34331,  // Hand of the Deceiver
    34335,  // Hammer of Sanctification
    34336,  // Sunflare
    34604,  // Jaded Crystal Dagger
    34611,  // Cudgel of Consecration
    34893,  // Vanir's Right Fist of Brutality
    34895,  // Scryer's Blade of Focus
    34896,  // Gavel of Naaru Blessings
    35014,  // Brutal Gladiator's Gavel
    35082,  // Brutal Gladiator's Salvation
    35102,  // Brutal Gladiator's Spellblade
]);

// TWO_HAND: items that are Two-Handed weapons (staff, 2h sword, 2h mace, polearm etc.)
// Used to correctly slot WCL data items into "Two Hand" instead of "Main Hand"
const ITEM_TWO_HAND_WEAPON = new Set([
    22589,22630,22631,27903,28429,28430,28435,28441,28442,28476,
    28573,28587,28604,28633,28658,28773,28782,28800,29171,29359,
    29981,29988,29993,30021,30090,30883,30902,30908,31334,32014,
    32055,32248,32332,32344,32374,33465,33492,33716,34014,34182,
    34183,34198,34247,34337,34898,
]);

// SHIELD: items that are shields (Off Hand armor)
// Used to filter Prot Warrior/Paladin OH to shields only
const ITEM_SHIELD = new Set([
    22819,28606,28611,28754,28825,29176,29266,29267,29268,29458,
    30882,30889,30909,32255,32375,33309,33313,33332,33661,34011,
    34185,34231,34986,
]);
