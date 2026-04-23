const data = require('./data.json');
const fire = data.specs.find(s => s.className === 'Mage' && s.specName === 'Fire');
for (const phase of ['3','4','5']) {
  const items = (fire.phases[phase] && fire.phases[phase].items || []).filter(i => i.rank === 'BIS');
  const slots = {};
  items.forEach(i => { if (!(i.slot in slots)) slots[i.slot] = i; });
  const slotList = Object.values(slots);
  console.log('P'+phase+' ('+slotList.length+' BIS slots):');
  slotList.sort((a,b) => a.slot.localeCompare(b.slot)).forEach(i => {
    console.log('  '+i.slot+': '+i.name+' ('+i.itemId+')');
  });

  // Check what auto-detect would pick
  const all = fire.phases[phase].items;
  const twoHanders = all.filter(i => i.slot === 'Two Hand');
  const mainHanders = all.filter(i => i.slot === 'Main Hand');
  const top2H = twoHanders[0];
  const topMH = mainHanders[0];
  const rankOrder = { 'BIS': 0, 'Pre-BIS': 1, 'Alt': 2 };
  const r2h = top2H ? (rankOrder[top2H.rank] || 99) : 99;
  const rmh = topMH ? (rankOrder[topMH.rank] || 99) : 99;
  const mode = (top2H && r2h < rmh) ? '2h' : 'dw';
  console.log('  Auto-detect: '+mode+' (2h='+top2H?.name+' rank:'+top2H?.rank+', MH='+topMH?.name+' rank:'+topMH?.rank+')');
  console.log('');
}
