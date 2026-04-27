const fs = require('fs');
let raw = fs.readFileSync('js/pvp-data.js', 'utf8');
raw = raw.replace('const PVP_DATA', 'var PVP_DATA');
eval(raw);
const have = new Set(Object.keys(PVP_DATA.specs));
const allPvP = [
  'Druid|Balance','Druid|Feral Combat','Druid|Restoration',
  'Hunter|Beast Mastery','Hunter|Marksmanship','Hunter|Survival',
  'Mage|Arcane','Mage|Fire','Mage|Frost',
  'Paladin|Holy','Paladin|Protection','Paladin|Retribution',
  'Priest|Discipline','Priest|Holy','Priest|Shadow',
  'Rogue|Combat','Rogue|Subtlety',
  'Shaman|Elemental','Shaman|Enhancement','Shaman|Restoration',
  'Warlock|Affliction','Warlock|Demonology','Warlock|Destruction',
  'Warrior|Arms','Warrior|Fury','Warrior|Protection'
];
console.log('HAVE:', have.size, 'PvP specs');
console.log('MISSING:');
allPvP.filter(s => have.has(s) === false).forEach(s => console.log(' ', s));
