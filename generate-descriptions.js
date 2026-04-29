/**
 * generate-descriptions.js
 * Auto-generate SPEC_PHASE_DESCRIPTIONS from WCL data + manual P0 data.
 * Outputs JS code to paste into app.js.
 */
const fs = require('fs');

eval(fs.readFileSync('js/wcl-data.js', 'utf8').replace('const WCL_DATA', 'globalThis.WCL_DATA'));
const DATA = JSON.parse(fs.readFileSync('data.json', 'utf8'));

// App spec key → WCL spec key
const APP_TO_WCL = {
    'Druid|Cat': 'Druid|Feral',
    'Druid|Bear': 'Druid|Guardian',
};
// App spec → manual data fallback
const MANUAL_FALLBACK = {
    'Rogue|Combat': 'Rogue|Dps',
    'Rogue|Assassination': 'Rogue|Dps',
    'Rogue|Subtlety': 'Rogue|Dps',
    'Priest|Discipline': 'Priest|Holy',
};

const PHASE_LABELS = {
    0: 'Pre-raid', 1: 'Phase 1', 2: 'Phase 2',
    3: 'Phase 3', 4: 'Phase 4', 5: 'Phase 5 (Sunwell)',
};
const PHASE_RAIDS = {
    1: 'Karazhan, Gruul & Magtheridon',
    2: 'SSC & TK',
    3: 'Black Temple & Hyjal',
    4: 'ZA & Badge gear',
    5: 'Sunwell Plateau',
};

const ITEM_TWO_HAND = new Set();
try {
    eval(fs.readFileSync('js/item-restrictions.js', 'utf8').replace(/const /g, 'globalThis.'));
    if (typeof ITEM_TWO_HAND_WEAPON !== 'undefined') {
        for (const id of ITEM_TWO_HAND_WEAPON) ITEM_TWO_HAND.add(id);
    }
} catch(e) {}

const SPEC_NAMES = {
    'Warrior|Arms': 'Arms Warrior', 'Warrior|Fury': 'Fury Warrior', 'Warrior|Protection': 'Protection Warrior',
    'Paladin|Holy': 'Holy Paladin', 'Paladin|Protection': 'Protection Paladin', 'Paladin|Retribution': 'Retribution Paladin',
    'Hunter|Beast Mastery': 'Beast Mastery Hunter', 'Hunter|Marksmanship': 'Marksmanship Hunter', 'Hunter|Survival': 'Survival Hunter',
    'Rogue|Combat': 'Combat Rogue', 'Rogue|Assassination': 'Assassination Rogue', 'Rogue|Subtlety': 'Subtlety Rogue',
    'Priest|Holy': 'Holy Priest', 'Priest|Shadow': 'Shadow Priest', 'Priest|Discipline': 'Discipline Priest',
    'Shaman|Elemental': 'Elemental Shaman', 'Shaman|Enhancement': 'Enhancement Shaman', 'Shaman|Restoration': 'Restoration Shaman',
    'Mage|Arcane': 'Arcane Mage', 'Mage|Fire': 'Fire Mage', 'Mage|Frost': 'Frost Mage',
    'Warlock|Affliction': 'Affliction Warlock', 'Warlock|Demonology': 'Demonology Warlock', 'Warlock|Destruction': 'Destruction Warlock',
    'Druid|Balance': 'Balance Druid', 'Druid|Bear': 'Feral Bear Druid', 'Druid|Cat': 'Feral Cat Druid', 'Druid|Restoration': 'Restoration Druid',
};

// Slot groupings for description
const WEAPON_SLOTS = new Set(['Main Hand', 'Off Hand', 'Two Hand', 'Ranged']);
const TRINKET_SLOTS = new Set(['Trinket 1', 'Trinket 2']);
const RING_SLOTS = new Set(['Ring 1', 'Ring 2']);
const JEWELRY_SLOTS = new Set(['Neck', 'Ring 1', 'Ring 2', 'Back']);

function describeWcl(specKey, phase) {
    const wclKey = APP_TO_WCL[specKey] || specKey;
    const phaseData = WCL_DATA.phases[String(phase)];
    if (!phaseData || !phaseData[wclKey]) return null;
    const slots = phaseData[wclKey].slots;

    // Get top item per slot
    const top = {};
    for (const [slot, items] of Object.entries(slots)) {
        if (items.length) top[slot] = items[0];
    }

    const specName = SPEC_NAMES[specKey] || specKey;
    const raidInfo = PHASE_RAIDS[phase] || '';
    const parts = [];

    // Weapons
    const mh = top['Main Hand'];
    const oh = top['Off Hand'];
    const wpns = [];
    if (mh && ITEM_TWO_HAND.has(mh.id)) {
        wpns.push(`${mh.name} as the two-handed weapon`);
    } else if (mh && oh) {
        if (mh.id === oh.id) {
            wpns.push(`${mh.name} in both hands`);
        } else {
            wpns.push(`${mh.name} main-hand with ${oh.name} off-hand`);
        }
    } else if (mh) {
        wpns.push(`${mh.name} as the weapon`);
    }
    if (wpns.length) parts.push(wpns.join('. '));

    // Head + Shoulders + Chest (key armor)
    const armor = [];
    if (top['Head']) armor.push(top['Head'].name);
    if (top['Shoulders']) armor.push(top['Shoulders'].name);
    if (top['Chest']) armor.push(top['Chest'].name);
    if (armor.length) parts.push(armor.join(', ') + ' form the armor core');

    // Trinkets
    const t1 = top['Trinket 1'], t2 = top['Trinket 2'];
    if (t1 && t2) {
        parts.push(`${t1.name} and ${t2.name} are the top trinkets`);
    } else if (t1) {
        parts.push(`${t1.name} is the top trinket`);
    }

    // Neck + rings
    const jewels = [];
    if (top['Neck']) jewels.push(top['Neck'].name);
    if (top['Ring 1']) jewels.push(top['Ring 1'].name);
    if (jewels.length) parts.push(jewels.join(' and ') + (jewels.length > 1 ? ' fill key jewelry slots' : ' anchors the neck'));

    // Ranged/Relic
    const ranged = top['Ranged'];
    if (ranged) parts.push(`${ranged.name} fills the ranged slot`);

    const prefix = `${PHASE_LABELS[phase]} ${specName} BiS${raidInfo ? ' (' + raidInfo + ')' : ''} features `;
    return prefix + parts.join('. ') + '.';
}

function describeManual(specKey, phase) {
    const [cls, spec] = specKey.split('|');
    const fbKey = MANUAL_FALLBACK[specKey];
    const lookupCls = fbKey ? fbKey.split('|')[0] : cls;
    const lookupSpec = fbKey ? fbKey.split('|')[1] : spec;
    
    const specData = DATA.specs.find(s => s.className === lookupCls && s.specName === lookupSpec);
    if (!specData || !specData.phases[phase]) return null;
    
    const items = specData.phases[phase].items;
    if (!items.length) return null;
    
    // Group by slot, pick BIS
    const top = {};
    for (const item of items) {
        if (item.rank === 'BIS' && !top[item.slot]) {
            top[item.slot] = item;
        }
    }
    // Fallback to first per slot
    for (const item of items) {
        if (!top[item.slot]) top[item.slot] = item;
    }

    const specName = SPEC_NAMES[specKey] || specKey;
    const parts = [];

    // Weapons
    const mh = top['Main Hand'] || top['Weapon'] || top['Two Hand'];
    const oh = top['Off Hand'];
    if (mh && oh) {
        parts.push(`${mh.name} main-hand with ${oh.name} off-hand`);
    } else if (mh) {
        parts.push(`${mh.name} as the weapon`);
    }

    // Armor highlights
    const armor = [];
    for (const s of ['Head', 'Shoulder', 'Chest']) {
        if (top[s]) armor.push(top[s].name);
    }
    if (armor.length) parts.push(armor.join(', ') + ' form the armor core');

    // Trinkets
    const t1 = top['Trinket 1'], t2 = top['Trinket 2'];
    if (t1 && t2) {
        parts.push(`${t1.name} and ${t2.name} are the top trinkets`);
    } else if (t1) {
        parts.push(`${t1.name} is the top trinket`);
    }

    return `Pre-raid ${specName} BiS features ${parts.join('. ')}.`;
}

// All app specs
const APP_SPECS = [
    'Warrior|Arms', 'Warrior|Fury', 'Warrior|Protection',
    'Paladin|Holy', 'Paladin|Protection', 'Paladin|Retribution',
    'Hunter|Beast Mastery', 'Hunter|Marksmanship', 'Hunter|Survival',
    'Rogue|Combat', 'Rogue|Assassination', 'Rogue|Subtlety',
    'Priest|Discipline', 'Priest|Holy', 'Priest|Shadow',
    'Shaman|Elemental', 'Shaman|Enhancement', 'Shaman|Restoration',
    'Mage|Arcane', 'Mage|Fire', 'Mage|Frost',
    'Warlock|Affliction', 'Warlock|Demonology', 'Warlock|Destruction',
    'Druid|Balance', 'Druid|Bear', 'Druid|Cat', 'Druid|Restoration',
];

const output = {};
for (const specKey of APP_SPECS) {
    const [cls, spec] = specKey.split('|');
    const jsKey = `${cls}-${spec}`;
    output[jsKey] = {};
    
    for (let phase = 0; phase <= 5; phase++) {
        let desc;
        if (phase === 0) {
            desc = describeManual(specKey, 0);
        } else {
            desc = describeWcl(specKey, phase);
        }
        if (desc) output[jsKey][phase] = desc;
    }
}

// Output as JS
let js = '    const SPEC_PHASE_DESCRIPTIONS = {\n';
for (const [key, phases] of Object.entries(output)) {
    if (!Object.keys(phases).length) continue;
    js += `        '${key}': {\n`;
    for (const [p, desc] of Object.entries(phases)) {
        js += `            ${p}: ${JSON.stringify(desc)},\n`;
    }
    js += '        },\n';
}
js += '    };';

console.log(js);
