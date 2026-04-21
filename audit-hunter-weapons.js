#!/usr/bin/env node
/**
 * Audit Hunter Weapon Slots
 *
 * Compares data.json (what the app shows) against wowhead-bis-raw.json
 * (what Wowhead/IcyVeins actually recommends) for all Hunter specs & phases.
 *
 * Highlights:
 *  - Missing Off Hand slots
 *  - "Weapon" slots not split into MH/OH
 *  - Items in wrong slot
 *  - Green (quality 2) items flagged as BIS
 *  - Phases with no scraped data (Lua-only)
 */

const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));
const scraped = JSON.parse(fs.readFileSync(path.join(__dirname, 'scraper', 'output', 'wowhead-bis-raw.json'), 'utf8'));

// Load item quality
const qualityFile = fs.readFileSync(path.join(__dirname, 'js', 'item-quality.js'), 'utf8');
const qualityMap = JSON.parse(qualityFile.match(/\{.*\}/)[0]);
const QUALITY_NAMES = { 0: 'Poor', 1: 'Common', 2: 'Uncommon(GREEN)', 3: 'Rare(blue)', 4: 'Epic(purple)', 5: 'Legendary(orange)' };

const WEAPON_SLOTS = ['Main Hand', 'Off Hand', 'Two Hand', 'Ranged/Relic'];
const HUNTER_SPECS = ['Beast Mastery', 'Marksmanship', 'Survival'];

console.log('='.repeat(80));
console.log('  HUNTER WEAPON AUDIT — data.json vs Wowhead/IcyVeins scraped data');
console.log('='.repeat(80));

let totalIssues = 0;

for (const specName of HUNTER_SPECS) {
  const spec = data.specs.find(s => s.className === 'Hunter' && s.specName === specName);
  if (!spec) { console.log(`\n❌ Hunter ${specName} not found in data.json!`); totalIssues++; continue; }

  for (const phase of Object.keys(spec.phases).sort()) {
    const phaseData = spec.phases[phase];
    const issues = [];

    // What data.json has for weapons
    const appItems = {};
    for (const slot of WEAPON_SLOTS) {
      appItems[slot] = phaseData.items.filter(i => i.slot === slot);
    }

    // What Wowhead/IcyVeins has
    const scrapeKey = `p${phase}-Hunter-${specName.replace(/ /g, '_')}`;
    const scrapeEntry = scraped[scrapeKey];

    console.log(`\n${'─'.repeat(70)}`);
    console.log(`  Hunter ${specName} — Phase ${phase}`);
    console.log(`  Source: ${scrapeEntry ? scrapeEntry.url : 'LUA DATA ONLY (no scrape)'}`);
    console.log(`${'─'.repeat(70)}`);

    // Flag green items
    for (const slot of WEAPON_SLOTS) {
      for (const item of appItems[slot]) {
        const q = qualityMap[item.itemId];
        if (q !== undefined && q <= 2) {
          issues.push(`⚠️  GREEN ITEM in ${slot}: ${item.name} (${item.itemId}) quality=${QUALITY_NAMES[q]} rank="${item.rank}"`);
        }
      }
    }

    // Check missing slots
    if (appItems['Main Hand'].length > 0 && appItems['Off Hand'].length === 0 && appItems['Two Hand'].length > 0) {
      // Could be intentional (2H only) but flag it
      issues.push(`ℹ️  No Off Hand items — only Main Hand (${appItems['Main Hand'].length}) + Two Hand (${appItems['Two Hand'].length})`);
    }
    if (appItems['Main Hand'].length > 0 && appItems['Off Hand'].length === 0 && appItems['Two Hand'].length === 0) {
      issues.push(`🔴 Main Hand items exist (${appItems['Main Hand'].length}) but NO Off Hand and NO Two Hand!`);
    }

    if (!scrapeEntry) {
      if (issues.length) {
        issues.forEach(i => console.log(`  ${i}`));
        totalIssues += issues.length;
      }
      console.log(`  📋 App data (Lua):  MH=${appItems['Main Hand'].length}  OH=${appItems['Off Hand'].length}  2H=${appItems['Two Hand'].length}  Ranged=${appItems['Ranged/Relic'].length}`);
      console.log(`  ⚪ No scraped data for this phase — using Lua only`);
      continue;
    }

    // Parse scraped weapon data
    const scrapeSlots = {};
    for (const s of scrapeEntry.slots) {
      const sl = s.slot.toLowerCase();
      if (sl.includes('hand') || sl.includes('weapon') || sl.includes('two')) {
        scrapeSlots[s.slot] = s.items;
      }
    }

    // Show comparison
    console.log(`  📋 App data:     MH=${appItems['Main Hand'].length}  OH=${appItems['Off Hand'].length}  2H=${appItems['Two Hand'].length}  Ranged=${appItems['Ranged/Relic'].length}`);
    const scrapeSlotNames = Object.keys(scrapeSlots);
    if (scrapeSlotNames.length === 0) {
      console.log(`  🌐 Scraped data: NO weapon slots found!`);
      issues.push(`🔴 Wowhead scrape has NO weapon slot data for this phase`);
    } else {
      for (const [slot, items] of Object.entries(scrapeSlots)) {
        console.log(`  🌐 Scraped "${slot}": ${items.map(i => `${i.rank} ${i.itemId} ${i.itemName}`).join(' | ')}`);
      }
    }

    // Detect "Weapon" slot that should be split
    if (scrapeSlots['Weapon']) {
      const weaponItems = scrapeSlots['Weapon'];
      const hasMH = weaponItems.some(i => i.rank.toLowerCase().includes('mh'));
      const hasOH = weaponItems.some(i => i.rank.toLowerCase().includes('oh'));
      const hasX2 = weaponItems.some(i => i.rank.toLowerCase().includes('x2') || i.rank.toLowerCase().includes('×2'));

      if (hasMH || hasOH || hasX2) {
        issues.push(`🔴 Scraped "Weapon" slot has MH/OH/x2 indicators that should be split into Main Hand + Off Hand`);
        for (const item of weaponItems) {
          const inMH = appItems['Main Hand'].some(i => i.itemId === item.itemId);
          const inOH = appItems['Off Hand'].some(i => i.itemId === item.itemId);
          const rankLower = item.rank.toLowerCase();
          if (rankLower.includes('oh') && !inOH) {
            issues.push(`  → ${item.itemName} (${item.itemId}) rank="${item.rank}" should be in Off Hand but is ${inMH ? 'only in Main Hand' : 'MISSING'}`);
          }
          if (rankLower.includes('mh') && !inMH) {
            issues.push(`  → ${item.itemName} (${item.itemId}) rank="${item.rank}" should be in Main Hand but is ${inOH ? 'only in Off Hand' : 'MISSING'}`);
          }
          if (rankLower.includes('x2') || rankLower.includes('×2')) {
            if (!inMH) issues.push(`  → ${item.itemName} (${item.itemId}) rank="${item.rank}" (x2) missing from Main Hand`);
            if (!inOH) issues.push(`  → ${item.itemName} (${item.itemId}) rank="${item.rank}" (x2) missing from Off Hand`);
          }
        }
      }
    }

    // Detect scraped "Main Hand" slot with OH items inside
    if (scrapeSlots['Main Hand']) {
      for (const item of scrapeSlots['Main Hand']) {
        const rankLower = item.rank.toLowerCase();
        if (rankLower.includes('oh') && !rankLower.includes('mh')) {
          const inOH = appItems['Off Hand'].some(i => i.itemId === item.itemId);
          if (!inOH) {
            issues.push(`🔴 Scraped Main Hand slot has OH item: ${item.itemName} (${item.itemId}) rank="${item.rank}" — not in app Off Hand`);
          }
        }
        if (rankLower.includes('mh') && rankLower.includes('oh')) {
          const inMH = appItems['Main Hand'].some(i => i.itemId === item.itemId);
          const inOH = appItems['Off Hand'].some(i => i.itemId === item.itemId);
          if (!inMH) issues.push(`🔴 ${item.itemName} (${item.itemId}) rank="${item.rank}" missing from Main Hand`);
          if (!inOH) issues.push(`🔴 ${item.itemName} (${item.itemId}) rank="${item.rank}" missing from Off Hand`);
        }
      }
    }

    // Check if scraped has Off Hand but app doesn't
    if (scrapeSlots['Off Hand'] && appItems['Off Hand'].length === 0) {
      issues.push(`🔴 Wowhead has Off Hand slot with ${scrapeSlots['Off Hand'].length} items, but app has NONE`);
    }

    // Check for scraped items missing from app entirely
    for (const [slot, items] of Object.entries(scrapeSlots)) {
      if (slot === 'Weapon') continue; // handled above
      const normalizedSlot = slot === 'Two-Hand' ? 'Two Hand' : slot;
      const appSlotItems = appItems[normalizedSlot] || [];
      for (const item of items) {
        if (!appSlotItems.some(i => i.itemId === item.itemId)) {
          // Check if it's in any weapon slot
          const inAny = WEAPON_SLOTS.some(s => appItems[s]?.some(i => i.itemId === item.itemId));
          if (!inAny) {
            // Only flag top-ranked missing items (BiS/Best)
            if (item.rank.toLowerCase().includes('bis') || item.rank.toLowerCase().includes('best')) {
              issues.push(`⚠️  Scraped BIS item missing from app: ${item.itemName} (${item.itemId}) in "${slot}" rank="${item.rank}"`);
            }
          }
        }
      }
    }

    // Print issues
    if (issues.length) {
      console.log('');
      issues.forEach(i => console.log(`  ${i}`));
      totalIssues += issues.length;
    } else {
      console.log(`  ✅ No issues found`);
    }
  }
}

console.log(`\n${'='.repeat(80)}`);
console.log(`  TOTAL ISSUES: ${totalIssues}`);
console.log(`${'='.repeat(80)}`);
