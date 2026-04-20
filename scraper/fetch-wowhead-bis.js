#!/usr/bin/env node
/**
 * Wowhead BiS Scraper (Puppeteer)
 *
 * Hämtar Best-in-Slot-guider från Wowhead för alla specs och phases.
 * Använder Puppeteer för att kringgå anti-bot-skydd.
 * Sparar rådata som JSON i scraper/output/wowhead-bis-raw.json
 *
 * Usage:
 *   node scraper/fetch-wowhead-bis.js                     # Alla phases och specs
 *   node scraper/fetch-wowhead-bis.js --phase 1           # Bara phase 1
 *   node scraper/fetch-wowhead-bis.js --spec "Fury"       # Bara specs som matchar "Fury"
 *   node scraper/fetch-wowhead-bis.js --delay 2000        # 2s mellan requests (default: 2500)
 *   node scraper/fetch-wowhead-bis.js --resume            # Hoppa över redan hämtade
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const OUTPUT_FILE = path.join(__dirname, 'output', 'wowhead-bis-raw.json');

// ─── CLI Args ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name, fallback) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}
const filterPhase = getArg('phase', null);
const filterSpec  = getArg('spec', null);
const delayMs     = parseInt(getArg('delay', '2500'), 10);
const resume      = args.includes('--resume');

// ─── Spec Definitions ─────────────────────────────────────────────────

const SPECS = [
  // ── Phase 1 – Karazhan / Gruul / Magtheridon ─────────────────────
  { phase: 1, role: 'tank',   class: 'Druid',   spec: 'Feral Tank',       url: 'https://www.wowhead.com/tbc/guide/feral-druid-tank-karazhan-best-in-slot-gear-burning-crusade-classic-wow' },
  { phase: 1, role: 'tank',   class: 'Paladin', spec: 'Protection',       url: 'https://www.wowhead.com/tbc/guide/paladin-tank-karazhan-best-in-slot-gear-burning-crusade-classic-wow' },
  { phase: 1, role: 'tank',   class: 'Warrior', spec: 'Protection',       url: 'https://www.wowhead.com/tbc/guide/protection-warrior-tank-karazhan-best-in-slot-gear-burning-crusade-classic-wow' },
  { phase: 1, role: 'melee',  class: 'Druid',   spec: 'Feral DPS',        url: 'https://www.wowhead.com/tbc/guide/feral-druid-dps-karazhan-best-in-slot-gear-burning-crusade-classic-wow' },
  { phase: 1, role: 'melee',  class: 'Paladin', spec: 'Retribution',      url: 'https://www.wowhead.com/tbc/guide/retribution-paladin-dps-karazhan-best-in-slot-gear-burning-crusade-classic-wow' },
  { phase: 1, role: 'melee',  class: 'Rogue',   spec: 'Rogue',            url: 'https://www.wowhead.com/tbc/guide/rogue-dps-karazhan-best-in-slot-gear-burning-crusade-classic-wow' },
  { phase: 1, role: 'melee',  class: 'Shaman',  spec: 'Enhancement',      url: 'https://www.wowhead.com/tbc/guide/enhancement-shaman-dps-karazhan-best-in-slot-gear-burning-crusade-classic-wow' },
  { phase: 1, role: 'melee',  class: 'Warrior', spec: 'Arms',             url: 'https://www.wowhead.com/tbc/guide/arms-warrior-dps-karazhan-best-in-slot-gear-burning-crusade-classic-wow' },
  { phase: 1, role: 'melee',  class: 'Warrior', spec: 'Fury',             url: 'https://www.wowhead.com/tbc/guide/fury-warrior-dps-karazhan-best-in-slot-gear-burning-crusade-classic-wow' },
  { phase: 1, role: 'ranged', class: 'Druid',   spec: 'Balance',          url: 'https://www.wowhead.com/tbc/guide/balance-druid-dps-karazhan-best-in-slot-gear-burning-crusade-classic-wow' },
  { phase: 1, role: 'ranged', class: 'Hunter',  spec: 'Beast Mastery',    url: 'https://www.wowhead.com/tbc/guide/beast-mastery-hunter-dps-karazhan-best-in-slot-gear-burning-crusade-classic-wow' },
  { phase: 1, role: 'ranged', class: 'Hunter',  spec: 'Marksmanship',     url: 'https://www.wowhead.com/tbc/guide/marksmanship-hunter-dps-karazhan-best-in-slot-gear-burning-crusade-classic-wow' },
  { phase: 1, role: 'ranged', class: 'Hunter',  spec: 'Survival',         url: 'https://www.wowhead.com/tbc/guide/survival-hunter-dps-karazhan-best-in-slot-gear-burning-crusade-classic-wow' },
  { phase: 1, role: 'ranged', class: 'Mage',    spec: 'Arcane',           url: 'https://www.wowhead.com/tbc/guide/arcane-mage-dps-karazhan-best-in-slot-gear-burning-crusade-classic-wow' },
  { phase: 1, role: 'ranged', class: 'Mage',    spec: 'Fire',             url: 'https://www.wowhead.com/tbc/guide/fire-mage-dps-karazhan-best-in-slot-gear-burning-crusade-classic-wow' },
  { phase: 1, role: 'ranged', class: 'Mage',    spec: 'Frost',            url: 'https://www.wowhead.com/tbc/guide/frost-mage-dps-karazhan-best-in-slot-gear-burning-crusade-classic-wow' },
  { phase: 1, role: 'ranged', class: 'Priest',  spec: 'Shadow',           url: 'https://www.wowhead.com/tbc/guide/shadow-priest-dps-karazhan-best-in-slot-gear-burning-crusade-classic-wow' },
  { phase: 1, role: 'ranged', class: 'Shaman',  spec: 'Elemental',        url: 'https://www.wowhead.com/tbc/guide/elemental-shaman-dps-karazhan-best-in-slot-gear-burning-crusade-classic-wow' },
  { phase: 1, role: 'ranged', class: 'Warlock', spec: 'Affliction',       url: 'https://www.wowhead.com/tbc/guide/affliction-warlock-dps-karazhan-best-in-slot-gear-burning-crusade-classic-wow' },
  { phase: 1, role: 'ranged', class: 'Warlock', spec: 'Demonology',       url: 'https://www.wowhead.com/tbc/guide/demonology-warlock-dps-karazhan-best-in-slot-gear-burning-crusade-classic-wow' },
  { phase: 1, role: 'ranged', class: 'Warlock', spec: 'Destruction',      url: 'https://www.wowhead.com/tbc/guide/destruction-warlock-dps-karazhan-best-in-slot-gear-burning-crusade-classic-wow' },
  { phase: 1, role: 'healer', class: 'Druid',   spec: 'Restoration',      url: 'https://www.wowhead.com/tbc/guide/druid-healer-karazhan-best-in-slot-gear-burning-crusade-classic-wow' },
  { phase: 1, role: 'healer', class: 'Paladin', spec: 'Holy',             url: 'https://www.wowhead.com/tbc/guide/holy-paladin-healer-karazhan-best-in-slot-gear-burning-crusade-classic-wow' },
  { phase: 1, role: 'healer', class: 'Priest',  spec: 'Holy/Disc',        url: 'https://www.wowhead.com/tbc/guide/priest-healer-karazhan-best-in-slot-gear-burning-crusade-classic-wow' },
  { phase: 1, role: 'healer', class: 'Shaman',  spec: 'Restoration',      url: 'https://www.wowhead.com/tbc/guide/shaman-healer-karazhan-best-in-slot-gear-burning-crusade-classic-wow' },

  // ── Phase 2 – SSC / TK ────────────────────────────────────────────
  // Specs utan Wowhead-guide → faller tillbaka på LUA-data:
  //   Hunter: Marksmanship, Survival
  //   Mage: Frost
  //   Warlock: Demonology, Destruction
  //   Warrior: Arms
  { phase: 2, role: 'ranged', class: 'Druid',   spec: 'Balance',          url: 'https://tbc.wowhead.com/guides/balance-druid-dps-tk-ssc-phase-2-best-in-slot-gear-burning-crusade' },
  { phase: 2, role: 'melee',  class: 'Druid',   spec: 'Feral DPS',        url: 'https://tbc.wowhead.com/guides/feral-druid-dps-tk-ssc-phase-2-best-in-slot-gear-burning-crusade' },
  { phase: 2, role: 'ranged', class: 'Hunter',  spec: 'Beast Mastery',    url: 'https://tbc.wowhead.com/guides/beast-mastery-hunter-dps-tk-ssc-phase-2-best-in-slot-gear-burning-crusade' },
  { phase: 2, role: 'ranged', class: 'Mage',    spec: 'Arcane',           url: 'https://tbc.wowhead.com/guides/arcane-mage-dps-tk-ssc-phase-2-best-in-slot-gear-burning-crusade' },
  { phase: 2, role: 'ranged', class: 'Mage',    spec: 'Fire',             url: 'https://tbc.wowhead.com/guides/fire-mage-dps-tk-ssc-phase-2-best-in-slot-gear-burning-crusade' },
  { phase: 2, role: 'melee',  class: 'Paladin', spec: 'Retribution',      url: 'https://tbc.wowhead.com/guides/retribution-paladin-dps-tk-ssc-phase-2-best-in-slot-gear-burning-crusade' },
  { phase: 2, role: 'ranged', class: 'Priest',  spec: 'Shadow',           url: 'https://tbc.wowhead.com/guides/shadow-priest-dps-tk-ssc-phase-2-best-in-slot-gear-burning-crusade' },
  { phase: 2, role: 'melee',  class: 'Rogue',   spec: 'Rogue',            url: 'https://tbc.wowhead.com/guides/rogue-dps-tk-ssc-phase-2-best-in-slot-gear-burning-crusade' },
  { phase: 2, role: 'ranged', class: 'Shaman',  spec: 'Elemental',        url: 'https://tbc.wowhead.com/guides/elemental-shaman-dps-tk-ssc-phase-2-best-in-slot-gear-burning-crusade' },
  { phase: 2, role: 'melee',  class: 'Shaman',  spec: 'Enhancement',      url: 'https://tbc.wowhead.com/guides/enhancement-shaman-dps-tk-ssc-phase-2-best-in-slot-gear-burning-crusade' },
  { phase: 2, role: 'ranged', class: 'Warlock', spec: 'Affliction',       url: 'https://tbc.wowhead.com/guides/affliction-warlock-dps-tk-ssc-phase-2-best-in-slot-gear-burning-crusade' },
  { phase: 2, role: 'ranged', class: 'Warlock', spec: 'Destruction',      url: 'https://tbc.wowhead.com/guides/destruction-warlock-dps-tk-ssc-phase-2-best-in-slot-gear-burning-crusade' },
  { phase: 2, role: 'melee',  class: 'Warrior', spec: 'Arms',             url: 'https://tbc.wowhead.com/guides/arms-warrior-dps-tk-ssc-phase-2-best-in-slot-gear-burning-crusade' },
  { phase: 2, role: 'melee',  class: 'Warrior', spec: 'Fury',             url: 'https://tbc.wowhead.com/guides/fury-warrior-dps-tk-ssc-phase-2-best-in-slot-gear-burning-crusade' },
  { phase: 2, role: 'tank',   class: 'Druid',   spec: 'Feral Tank',       url: 'https://tbc.wowhead.com/guides/feral-druid-tank-tk-ssc-phase-2-best-in-slot-gear-burning-crusade' },
  { phase: 2, role: 'tank',   class: 'Paladin', spec: 'Protection',       url: 'https://tbc.wowhead.com/guides/paladin-tank-tk-ssc-phase-2-best-in-slot-gear-burning-crusade' },
  { phase: 2, role: 'tank',   class: 'Warrior', spec: 'Protection',       url: 'https://tbc.wowhead.com/guides/protection-warrior-tank-tk-ssc-phase-2-best-in-slot-gear-burning-crusade' },
  { phase: 2, role: 'healer', class: 'Druid',   spec: 'Restoration',      url: 'https://tbc.wowhead.com/guides/druid-healer-tk-ssc-phase-2-best-in-slot-gear-burning-crusade' },
  { phase: 2, role: 'healer', class: 'Paladin', spec: 'Holy',             url: 'https://tbc.wowhead.com/guides/holy-paladin-healer-tk-ssc-phase-2-best-in-slot-gear-burning-crusade' },
  { phase: 2, role: 'healer', class: 'Priest',  spec: 'Holy/Disc',        url: 'https://tbc.wowhead.com/guides/priest-healer-tk-ssc-phase-2-best-in-slot-gear-burning-crusade' },
  { phase: 2, role: 'healer', class: 'Shaman',  spec: 'Restoration',      url: 'https://tbc.wowhead.com/guides/shaman-healer-tk-ssc-phase-2-best-in-slot-gear-burning-crusade' },

  // ── Phase 3 – Hyjal / Black Temple (Icy Veins) ───────────────────
  // Källa: icy-veins.com – strukturen skiljer sig från Wowhead (ingen rank-kolumn)
  // Specs som saknas på Icy Veins faller tillbaka på LUA-data: ingen känd saknad
  { phase: 3, role: 'tank',   class: 'Druid',   spec: 'Feral Tank',       url: 'https://www.icy-veins.com/tbc-classic/feral-druid-tank-pve-gear-best-in-slot?area=p3',                source: 'icyveins' },
  { phase: 3, role: 'tank',   class: 'Paladin', spec: 'Protection',       url: 'https://www.icy-veins.com/tbc-classic/protection-paladin-tank-pve-gear-best-in-slot?area=area_3',    source: 'icyveins' },
  { phase: 3, role: 'tank',   class: 'Warrior', spec: 'Protection',       url: 'https://www.icy-veins.com/tbc-classic/protection-warrior-tank-pve-gear-best-in-slot?area=area_3',    source: 'icyveins' },
  { phase: 3, role: 'healer', class: 'Druid',   spec: 'Restoration',      url: 'https://www.icy-veins.com/tbc-classic/restoration-druid-healer-pve-gear-best-in-slot?area=p3',       source: 'icyveins' },
  { phase: 3, role: 'healer', class: 'Paladin', spec: 'Holy',             url: 'https://www.icy-veins.com/tbc-classic/holy-paladin-healer-pve-gear-best-in-slot?area=area_3',        source: 'icyveins' },
  { phase: 3, role: 'healer', class: 'Priest',  spec: 'Holy/Disc',        url: 'https://www.icy-veins.com/tbc-classic/holy-priest-healer-pve-gear-best-in-slot?area=area_3',         source: 'icyveins' },
  { phase: 3, role: 'healer', class: 'Shaman',  spec: 'Restoration',      url: 'https://www.icy-veins.com/tbc-classic/restoration-shaman-healer-pve-gear-best-in-slot?area=p3',      source: 'icyveins' },
  { phase: 3, role: 'ranged', class: 'Hunter',  spec: 'Beast Mastery',    url: 'https://www.icy-veins.com/tbc-classic/beast-mastery-hunter-dps-pve-gear-best-in-slot?area=area_3',   source: 'icyveins' },
  { phase: 3, role: 'ranged', class: 'Hunter',  spec: 'Marksmanship',     url: 'https://www.icy-veins.com/tbc-classic/marksmanship-hunter-dps-pve-gear-best-in-slot?area=area_3',    source: 'icyveins' },
  { phase: 3, role: 'ranged', class: 'Hunter',  spec: 'Survival',         url: 'https://www.icy-veins.com/tbc-classic/survival-hunter-dps-pve-gear-best-in-slot?area=area_3',        source: 'icyveins' },
  { phase: 3, role: 'ranged', class: 'Mage',    spec: 'Arcane',           url: 'https://www.icy-veins.com/tbc-classic/arcane-mage-dps-pve-gear-best-in-slot?area=p3_mage',           source: 'icyveins' },
  { phase: 3, role: 'ranged', class: 'Mage',    spec: 'Fire',             url: 'https://www.icy-veins.com/tbc-classic/fire-mage-dps-pve-gear-best-in-slot?area=p3_mage',             source: 'icyveins' },
  { phase: 3, role: 'ranged', class: 'Mage',    spec: 'Frost',            url: 'https://www.icy-veins.com/tbc-classic/frost-mage-dps-pve-gear-best-in-slot?area=p3_mage',            source: 'icyveins' },
  { phase: 3, role: 'ranged', class: 'Priest',  spec: 'Shadow',           url: 'https://www.icy-veins.com/tbc-classic/shadow-priest-dps-pve-gear-best-in-slot?area=area_3',          source: 'icyveins' },
  { phase: 3, role: 'ranged', class: 'Shaman',  spec: 'Elemental',        url: 'https://www.icy-veins.com/tbc-classic/elemental-shaman-dps-pve-gear-best-in-slot?area=p3',           source: 'icyveins' },
  { phase: 3, role: 'ranged', class: 'Warlock', spec: 'Affliction',       url: 'https://www.icy-veins.com/tbc-classic/affliction-warlock-dps-pve-gear-best-in-slot?area=area_3',     source: 'icyveins' },
  { phase: 3, role: 'ranged', class: 'Warlock', spec: 'Destruction',      url: 'https://www.icy-veins.com/tbc-classic/destruction-warlock-dps-pve-gear-best-in-slot?area=area_3',    source: 'icyveins' },
  { phase: 3, role: 'ranged', class: 'Warlock', spec: 'Demonology',       url: 'https://www.icy-veins.com/tbc-classic/demonology-warlock-dps-pve-gear-best-in-slot?area=area_3',     source: 'icyveins' },
  { phase: 3, role: 'melee',  class: 'Druid',   spec: 'Feral DPS',        url: 'https://www.icy-veins.com/tbc-classic/feral-druid-dps-pve-gear-best-in-slot?area=p3',                source: 'icyveins' },
  { phase: 3, role: 'melee',  class: 'Paladin', spec: 'Retribution',      url: 'https://www.icy-veins.com/tbc-classic/retribution-paladin-dps-pve-gear-best-in-slot?area=area_3',    source: 'icyveins' },
  { phase: 3, role: 'melee',  class: 'Rogue',   spec: 'Rogue',            url: 'https://www.icy-veins.com/tbc-classic/rogue-dps-pve-gear-best-in-slot?area=area_3',                  source: 'icyveins' },
  { phase: 3, role: 'melee',  class: 'Shaman',  spec: 'Enhancement',      url: 'https://www.icy-veins.com/tbc-classic/enhancement-shaman-dps-pve-gear-best-in-slot?area=p3',         source: 'icyveins' },
  { phase: 3, role: 'melee',  class: 'Warrior', spec: 'Arms',             url: 'https://www.icy-veins.com/tbc-classic/arms-warrior-dps-pve-gear-best-in-slot?area=area_3',           source: 'icyveins' },
  { phase: 3, role: 'melee',  class: 'Warrior', spec: 'Fury',             url: 'https://www.icy-veins.com/tbc-classic/fury-warrior-dps-pve-gear-best-in-slot?area=area_3',           source: 'icyveins' },
  { phase: 3, role: 'ranged', class: 'Druid',   spec: 'Balance',          url: 'https://www.icy-veins.com/tbc-classic/balance-druid-dps-pve-gear-best-in-slot?area=p3',              source: 'icyveins' },
  // Alla specs finns på Wowhead för Phase 4!
  { phase: 4, role: 'ranged', class: 'Druid',   spec: 'Balance',          url: 'https://www.wowhead.com/tbc/guide/balance-druid-dps-za-phase-4-best-in-slot-gear-burning-crusade' },
  { phase: 4, role: 'melee',  class: 'Druid',   spec: 'Feral DPS',        url: 'https://www.wowhead.com/tbc/guide/feral-druid-dps-za-phase-4-best-in-slot-gear-burning-crusade' },
  { phase: 4, role: 'ranged', class: 'Hunter',  spec: 'Survival',         url: 'https://www.wowhead.com/tbc/guide/survival-hunter-dps-za-phase-4-best-in-slot-gear-burning-crusade' },
  { phase: 4, role: 'ranged', class: 'Hunter',  spec: 'Beast Mastery',    url: 'https://www.wowhead.com/tbc/guide/beast-mastery-hunter-dps-za-phase-4-best-in-slot-gear-burning-crusade' },
  { phase: 4, role: 'ranged', class: 'Hunter',  spec: 'Marksmanship',     url: 'https://www.wowhead.com/tbc/guide/marksmanship-hunter-dps-za-phase-4-best-in-slot-gear-burning-crusade' },
  { phase: 4, role: 'ranged', class: 'Mage',    spec: 'Arcane',           url: 'https://www.wowhead.com/tbc/guide/arcane-mage-dps-za-phase-4-best-in-slot-gear-burning-crusade' },
  { phase: 4, role: 'ranged', class: 'Mage',    spec: 'Fire',             url: 'https://www.wowhead.com/tbc/guide/fire-mage-dps-za-phase-4-best-in-slot-gear-burning-crusade' },
  { phase: 4, role: 'ranged', class: 'Mage',    spec: 'Frost',            url: 'https://www.wowhead.com/tbc/guide/frost-mage-dps-za-phase-4-best-in-slot-gear-burning-crusade' },
  { phase: 4, role: 'melee',  class: 'Paladin', spec: 'Retribution',      url: 'https://www.wowhead.com/tbc/guide/retribution-paladin-dps-za-phase-4-best-in-slot-gear-burning-crusade' },
  { phase: 4, role: 'ranged', class: 'Priest',  spec: 'Shadow',           url: 'https://www.wowhead.com/tbc/guide/shadow-priest-dps-za-phase-4-best-in-slot-gear-burning-crusade' },
  { phase: 4, role: 'melee',  class: 'Rogue',   spec: 'Rogue',            url: 'https://www.wowhead.com/tbc/guide/rogue-dps-za-phase-4-best-in-slot-gear-burning-crusade' },
  { phase: 4, role: 'ranged', class: 'Shaman',  spec: 'Elemental',        url: 'https://www.wowhead.com/tbc/guide/elemental-shaman-dps-za-phase-4-best-in-slot-gear-burning-crusade' },
  { phase: 4, role: 'melee',  class: 'Shaman',  spec: 'Enhancement',      url: 'https://www.wowhead.com/tbc/guide/enhancement-shaman-dps-za-phase-4-best-in-slot-gear-burning-crusade' },
  { phase: 4, role: 'ranged', class: 'Warlock', spec: 'Affliction',       url: 'https://www.wowhead.com/tbc/guide/affliction-warlock-dps-za-phase-4-best-in-slot-gear-burning-crusade' },
  { phase: 4, role: 'ranged', class: 'Warlock', spec: 'Destruction',      url: 'https://www.wowhead.com/tbc/guide/destruction-warlock-dps-za-phase-4-best-in-slot-gear-burning-crusade' },
  { phase: 4, role: 'ranged', class: 'Warlock', spec: 'Demonology',       url: 'https://www.wowhead.com/tbc/guide/demonology-warlock-dps-za-phase-4-best-in-slot-gear-burning-crusade' },
  { phase: 4, role: 'melee',  class: 'Warrior', spec: 'Arms',             url: 'https://www.wowhead.com/tbc/guide/arms-warrior-dps-za-phase-4-best-in-slot-gear-burning-crusade' },
  { phase: 4, role: 'melee',  class: 'Warrior', spec: 'Fury',             url: 'https://www.wowhead.com/tbc/guide/fury-warrior-dps-za-phase-4-best-in-slot-gear-burning-crusade' },
  { phase: 4, role: 'tank',   class: 'Druid',   spec: 'Feral Tank',       url: 'https://www.wowhead.com/tbc/guide/feral-druid-tank-za-phase-4-best-in-slot-gear-burning-crusade' },
  { phase: 4, role: 'tank',   class: 'Paladin', spec: 'Protection',       url: 'https://www.wowhead.com/tbc/guide/paladin-tank-za-phase-4-best-in-slot-gear-burning-crusade' },
  { phase: 4, role: 'tank',   class: 'Warrior', spec: 'Protection',       url: 'https://www.wowhead.com/tbc/guide/protection-warrior-tank-za-phase-4-best-in-slot-gear-burning-crusade' },
  { phase: 4, role: 'healer', class: 'Druid',   spec: 'Restoration',      url: 'https://www.wowhead.com/tbc/guide/druid-healer-za-phase-4-best-in-slot-gear-burning-crusade' },
  { phase: 4, role: 'healer', class: 'Paladin', spec: 'Holy',             url: 'https://www.wowhead.com/tbc/guide/holy-paladin-healer-za-phase-4-best-in-slot-gear-burning-crusade' },
  { phase: 4, role: 'healer', class: 'Priest',  spec: 'Holy/Disc',        url: 'https://www.wowhead.com/tbc/guide/priest-healer-za-phase-4-best-in-slot-gear-burning-crusade' },
  { phase: 4, role: 'healer', class: 'Shaman',  spec: 'Restoration',      url: 'https://www.wowhead.com/tbc/guide/shaman-healer-za-phase-4-best-in-slot-gear-burning-crusade' },

  // ── Phase 5 – Sunwell Plateau ─────────────────────────────────────
  // Alla specs finns på Wowhead för Phase 5!
  { phase: 5, role: 'ranged', class: 'Druid',   spec: 'Balance',          url: 'https://www.wowhead.com/tbc/guide/balance-druid-dps-swp-phase-5-best-in-slot-gear-burning-crusade' },
  { phase: 5, role: 'melee',  class: 'Druid',   spec: 'Feral DPS',        url: 'https://www.wowhead.com/tbc/guide/feral-druid-dps-swp-phase-5-best-in-slot-gear-burning-crusade' },
  { phase: 5, role: 'ranged', class: 'Hunter',  spec: 'Survival',         url: 'https://www.wowhead.com/tbc/guide/survival-hunter-dps-swp-phase-5-best-in-slot-gear-burning-crusade' },
  { phase: 5, role: 'ranged', class: 'Hunter',  spec: 'Beast Mastery',    url: 'https://www.wowhead.com/tbc/guide/beast-mastery-hunter-dps-swp-phase-5-best-in-slot-gear-burning-crusade' },
  { phase: 5, role: 'ranged', class: 'Hunter',  spec: 'Marksmanship',     url: 'https://www.wowhead.com/tbc/guide/marksmanship-hunter-dps-swp-phase-5-best-in-slot-gear-burning-crusade' },
  { phase: 5, role: 'ranged', class: 'Mage',    spec: 'Arcane',           url: 'https://www.wowhead.com/tbc/guide/arcane-mage-dps-swp-phase-5-best-in-slot-gear-burning-crusade' },
  { phase: 5, role: 'ranged', class: 'Mage',    spec: 'Fire',             url: 'https://www.wowhead.com/tbc/guide/fire-mage-dps-swp-phase-5-best-in-slot-gear-burning-crusade' },
  { phase: 5, role: 'ranged', class: 'Mage',    spec: 'Frost',            url: 'https://www.wowhead.com/tbc/guide/frost-mage-dps-swp-phase-5-best-in-slot-gear-burning-crusade' },
  { phase: 5, role: 'melee',  class: 'Paladin', spec: 'Retribution',      url: 'https://www.wowhead.com/tbc/guide/retribution-paladin-dps-swp-phase-5-best-in-slot-gear-burning-crusade' },
  { phase: 5, role: 'ranged', class: 'Priest',  spec: 'Shadow',           url: 'https://www.wowhead.com/tbc/guide/shadow-priest-dps-swp-phase-5-best-in-slot-gear-burning-crusade' },
  { phase: 5, role: 'melee',  class: 'Rogue',   spec: 'Rogue',            url: 'https://www.wowhead.com/tbc/guide/rogue-dps-swp-phase-5-best-in-slot-gear-burning-crusade' },
  { phase: 5, role: 'ranged', class: 'Shaman',  spec: 'Elemental',        url: 'https://www.wowhead.com/tbc/guide/elemental-shaman-dps-swp-phase-5-best-in-slot-gear-burning-crusade' },
  { phase: 5, role: 'melee',  class: 'Shaman',  spec: 'Enhancement',      url: 'https://www.wowhead.com/tbc/guide/enhancement-shaman-dps-swp-phase-5-best-in-slot-gear-burning-crusade' },
  { phase: 5, role: 'ranged', class: 'Warlock', spec: 'Affliction',       url: 'https://www.wowhead.com/tbc/guide/affliction-warlock-dps-swp-phase-5-best-in-slot-gear-burning-crusade' },
  { phase: 5, role: 'ranged', class: 'Warlock', spec: 'Destruction',      url: 'https://www.wowhead.com/tbc/guide/destruction-warlock-dps-swp-phase-5-best-in-slot-gear-burning-crusade' },
  { phase: 5, role: 'ranged', class: 'Warlock', spec: 'Demonology',       url: 'https://www.wowhead.com/tbc/guide/demonology-warlock-dps-swp-phase-5-best-in-slot-gear-burning-crusade' },
  { phase: 5, role: 'melee',  class: 'Warrior', spec: 'Arms',             url: 'https://www.wowhead.com/tbc/guide/arms-warrior-dps-swp-phase-5-best-in-slot-gear-burning-crusade' },
  { phase: 5, role: 'melee',  class: 'Warrior', spec: 'Fury',             url: 'https://www.wowhead.com/tbc/guide/fury-warrior-dps-swp-phase-5-best-in-slot-gear-burning-crusade' },
  { phase: 5, role: 'tank',   class: 'Druid',   spec: 'Feral Tank',       url: 'https://www.wowhead.com/tbc/guide/feral-druid-tank-swp-phase-5-best-in-slot-gear-burning-crusade' },
  { phase: 5, role: 'tank',   class: 'Paladin', spec: 'Protection',       url: 'https://www.wowhead.com/tbc/guide/paladin-tank-swp-phase-5-best-in-slot-gear-burning-crusade' },
  { phase: 5, role: 'tank',   class: 'Warrior', spec: 'Protection',       url: 'https://www.wowhead.com/tbc/guide/protection-warrior-tank-swp-phase-5-best-in-slot-gear-burning-crusade' },
  { phase: 5, role: 'healer', class: 'Druid',   spec: 'Restoration',      url: 'https://www.wowhead.com/tbc/guide/druid-healer-swp-phase-5-best-in-slot-gear-burning-crusade' },
  { phase: 5, role: 'healer', class: 'Paladin', spec: 'Holy',             url: 'https://www.wowhead.com/tbc/guide/holy-paladin-healer-swp-phase-5-best-in-slot-gear-burning-crusade' },
  { phase: 5, role: 'healer', class: 'Priest',  spec: 'Holy/Disc',        url: 'https://www.wowhead.com/tbc/guide/priest-healer-swp-phase-5-best-in-slot-gear-burning-crusade' },
  { phase: 5, role: 'healer', class: 'Shaman',  spec: 'Restoration',      url: 'https://www.wowhead.com/tbc/guide/shaman-healer-swp-phase-5-best-in-slot-gear-burning-crusade' },
];

// ─── HTML Parsers ──────────────────────────────────────────────────────

/**
 * Parsar Wowhead item-länk och extraherar item-ID.
 * Ex: /tbc/item=29124/vindicators-brand → 29124
 */
function extractItemId(href) {
  if (!href) return null;
  const m = href.match(/\/item[=\/](\d+)/i);
  return m ? m[1] : null;
}

/**
 * Rensa dubblerade itemnamn som Wowhead skriver ("Dragonmaw Dragonmaw")
 */
function cleanItemName(raw) {
  const trimmed = raw.trim();
  // Om strängen är "X X" (dubbelt), returnera bara "X"
  const half = Math.ceil(trimmed.length / 2);
  const first = trimmed.slice(0, half).trim();
  const second = trimmed.slice(half).trim();
  if (first === second) return first;
  // Ibland är det "Gladiator's Slicer Gladiator's Cleaver" – behåll allt
  return trimmed;
}

/**
 * Parsar tabeller med kolumnerna Rank | Item | Source ur HTML-strängen.
 * Returnerar { slot, items: [{rank, itemName, itemId, source}] }[]
 */
function parseBisTablesFromHtml(html) {
  const slots = [];

  // Hitta alla "Best in Slot <Slot> for ..." sektioner via <h3>
  // och sedan nästa <table> efter varje h3
  const h3Regex = /###\s*Best in Slot ([^\n]+)/g;
  const tableRegex = /\|\s*Rank\s*\|\s*Item\s*\|\s*Source\s*\|([\s\S]*?)(?=\n###|\n##|\Z)/g;

  // Wowhead renderar som markdown i fetch_webpage – vi får markdown-tabeller
  // Extrahera slot-rubriker och tabeller

  const sections = [];
  let h3Match;
  const h3Positions = [];

  // Hitta alla h3-positioner
  const h3Re = /### Best in Slot ([^\n\r]+)/g;
  while ((h3Match = h3Re.exec(html)) !== null) {
    h3Positions.push({ pos: h3Match.index, slot: h3Match[1].trim() });
  }

  for (let i = 0; i < h3Positions.length; i++) {
    const start = h3Positions[i].pos;
    const end = i + 1 < h3Positions.length ? h3Positions[i + 1].pos : html.length;
    sections.push({
      slot: h3Positions[i].slot,
      content: html.slice(start, end)
    });
  }

  for (const section of sections) {
    // Normalisera slot-namn
    const slotName = normalizeSlot(section.slot);
    if (!slotName) continue;

    const items = [];

    // Hitta markdown-tabellrader: | Rank | Item | Source |
    const rowRe = /\|\s*([^|\n]+?)\s*\|\s*([^|\n]+?)\s*\|\s*([^|\n]+?)\s*\|/g;
    let rowMatch;
    let firstRow = true;

    while ((rowMatch = rowRe.exec(section.content)) !== null) {
      const col1 = rowMatch[1].trim();
      const col2 = rowMatch[2].trim();
      const col3 = rowMatch[3].trim();

      // Hoppa över header-raden och separator-raden
      if (col1 === 'Rank' || col1 === '---' || col1.startsWith('---')) continue;

      const rank = col1;
      const itemRaw = col2;
      const source = col3;

      // Extrahera item-ID från markdown-länk: [Namn](url)
      const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
      let linkMatch;
      let itemId = null;
      let itemName = itemRaw;

      // Sök igenom hela item-cellen för item-ID
      while ((linkMatch = linkRe.exec(itemRaw)) !== null) {
        const href = linkMatch[2];
        const id = extractItemId(href);
        if (id) {
          itemId = id;
          break;
        }
      }

      // Om ingen länk, rensa dubblat namn
      if (!itemId) {
        // Extrahera bara text (ta bort markdown-länkformatering)
        itemName = itemRaw.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
      } else {
        itemName = itemRaw.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
      }

      itemName = cleanItemName(itemName);

      if (itemName && rank) {
        items.push({ rank, itemName, itemId, source: source.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim() });
      }
    }

    if (items.length > 0) {
      slots.push({ slot: slotName, items });
    }
  }

  return slots;
}

/**
 * Normaliserar slot-rubriken till ett standardformat.
 */
function normalizeSlot(raw) {
  const r = raw.toLowerCase();
  if (r.includes('main hand') || r.includes('main-hand'))        return 'Main Hand';
  if (r.includes('off hand') || r.includes('off-hand'))          return 'Off Hand';
  if (r.includes('two-hand') || r.includes('two hand'))          return 'Two-Hand';
  if (r.includes('head'))                                         return 'Head';
  if (r.includes('neck'))                                         return 'Neck';
  if (r.includes('shoulder'))                                     return 'Shoulder';
  if (r.includes('back') || r.includes('cloak'))                 return 'Back';
  if (r.includes('chest'))                                        return 'Chest';
  if (r.includes('wrist') || r.includes('bracer'))               return 'Wrist';
  if (r.includes('hand') || r.includes('glove') || r.includes('gauntlet')) return 'Hands';
  if (r.includes('waist') || r.includes('belt'))                 return 'Waist';
  if (r.includes('leg'))                                          return 'Legs';
  if (r.includes('feet') || r.includes('boot'))                  return 'Feet';
  if (r.includes('ring'))                                         return 'Ring';
  if (r.includes('trinket'))                                      return 'Trinket';
  if (r.includes('ranged') || r.includes('wand') || r.includes('bow') || r.includes('gun') || r.includes('thrown')) return 'Ranged';
  if (r.includes('weapon'))                                       return 'Weapon';
  if (r.includes('relic') || r.includes('idol') || r.includes('totem') || r.includes('libram')) return 'Relic';
  return null; // okänt, ignorera
}

// ─── Puppeteer helpers ─────────────────────────────────────────────────

let browser = null;

async function getBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1280,900'
      ]
    });
  }
  return browser;
}

async function fetchPage(url, retries = 3) {
  const b = await getBrowser();
  const page = await b.newPage();
  try {
    // Maskera automation-flaggor
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        // Vänta lite extra för att JS ska rendera tabellerna
        await new Promise(r => setTimeout(r, 2000));
        const html = await page.content();
        return html;
      } catch (err) {
        if (attempt < retries) {
          const wait = 3000 * attempt;
          console.log(`\n      ⚠️  Försök ${attempt} misslyckades (${err.message}). Väntar ${wait / 1000}s...`);
          await new Promise(r => setTimeout(r, wait));
        } else {
          throw err;
        }
      }
    }
  } finally {
    await page.close();
  }
}

// ─── Scrape one spec page ──────────────────────────────────────────────

async function scrapeSpec(spec) {
  const html = await fetchPage(spec.url);

  if (spec.source === 'icyveins') {
    // Extrahera ?area=xxx från URL:en för att välja rätt fas-tabell
    const areaMatch = spec.url.match(/[?&]area=([^&]+)/);
    const areaId = areaMatch ? areaMatch[1] : null;
    return parseBisTablesFromIcyVeins(html, areaId);
  }

  // Primär parser: HTML-taggar (Wowhead)
  const htmlSlots = parseBisTablesFromHtmlTags(html);

  // Fallback parser: text-tabeller (för sidor som renderar annorlunda)
  const textSlots = parseBisTablesFromHtml(html);

  return mergeSlots(htmlSlots, textSlots);
}

/**
 * Parser för Icy Veins BiS-sidor.
 * Formatet är en tabell med | Slot | Item: Source Item: Source ... |
 * Slot-kolumnen innehåller t.ex. "Helm", "Neck", "Two-Hand" etc.
 */
function parseBisTablesFromIcyVeins(html, areaId) {
  const slots = [];

  // Icy Veins renderar alla fas-tabeller i HTML:en, en per fas.
  // Varje tabell är inbäddad i <div id="area_X" class="image_block_content ...">
  // Vi måste välja rätt div baserat på areaId (t.ex. "area_3", "p3", "p3_mage")
  // och sedan parsa tabellen inuti den.

  let htmlToParse = html;

  if (areaId) {
    // Hitta div med id="areaId"
    const divRe = new RegExp(`<div[^>]*\\bid=["']${areaId}["'][^>]*>([\\s\\S]*?)(?=<div[^>]*\\bimage_block_content\\b|<\\/div>\\s*<\\/div>\\s*<\\/div>\\s*(?:<div|$))`, 'i');
    const divMatch = divRe.exec(html);
    if (divMatch) {
      htmlToParse = divMatch[1];
    } else {
      // Fallback: försök hitta en tabell som föregås av id="areaId"
      // Sök i ett bredare fönster
      const idIdx = html.indexOf(`id="${areaId}"`);
      if (idIdx === -1) {
        // Prova enkelt citattecken
        const idIdx2 = html.indexOf(`id='${areaId}'`);
        if (idIdx2 > -1) {
          htmlToParse = html.substring(idIdx2, idIdx2 + 20000);
        }
      } else {
        htmlToParse = html.substring(idIdx, idIdx + 20000);
      }
    }
  }

  // Hitta alla tabeller och parsa den första giltig en (med slot-data)
  const tableRe = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch;

  while ((tableMatch = tableRe.exec(htmlToParse)) !== null) {
    const tableContent = tableMatch[1];

    // Parsa rader
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;

    while ((rowMatch = rowRe.exec(tableContent)) !== null) {
      const rowHtml = rowMatch[1];

      // Extrahera celler
      const cells = [];
      const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let cellMatch;
      while ((cellMatch = cellRe.exec(rowHtml)) !== null) {
        cells.push(cellMatch[1]);
      }

      if (cells.length < 2) continue;

      // Första cellen = slot-namn (ren text)
      const slotRaw = cells[0].replace(/<[^>]+>/g, '').trim();
      const slotName = normalizeSlot(slotRaw);
      if (!slotName) continue;

      // Andra cellen = items, separerade av mellanrum/text
      // Format: "ItemName Icon ItemName: Source ItemName Icon ItemName: Source ..."
      // Vi extraherar item-länkar: href="/tbc/item=ID" eller wowclassicdb.com/tbc/item/ID
      const itemCellHtml = cells[1];
      const items = parseIcyVeinsItemCell(itemCellHtml);

      if (items.length > 0) {
        // Deduplicera om sloten redan finns (ta den med flest items)
        const existing = slots.find(s => s.slot === slotName);
        if (existing) {
          if (items.length > existing.items.length) {
            existing.items = items;
          }
        } else {
          slots.push({ slot: slotName, items });
        }
      }
    }
  }

  return slots;
}

/**
 * Parsar en Icy Veins item-cell och extraherar items med ID och source.
 * Cellen innehåller flera items separerade av text.
 */
function parseIcyVeinsItemCell(cellHtml) {
  const items = [];

  // Extrahera alla länk-element med item-ID
  // Icy Veins använder wowclassicdb.com/tbc/item/ID eller /tbc-classic/item=ID
  const linkRe = /<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let linkMatch;

  while ((linkMatch = linkRe.exec(cellHtml)) !== null) {
    const href = linkMatch[1];
    const linkInner = linkMatch[2];

    // Extrahera item-ID
    let itemId = null;
    const idMatch = href.match(/\/item[=\/](\d+)/i);
    if (idMatch) itemId = idMatch[1];
    if (!itemId) continue;

    // Extrahera itemnamn (ta bort ikon-bilder och rensa)
    const itemName = cleanItemName(linkInner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    if (!itemName) continue;

    // Extrahera source-text (texten efter länken fram till nästa länk)
    // Vi letar i HTML:en efter textnoden som följer direkt efter länken
    const afterLink = cellHtml.slice(linkMatch.index + linkMatch[0].length);
    const sourceMatch = afterLink.match(/^([^<]{0,100})/);
    let source = sourceMatch ? sourceMatch[1].replace(/^[\s:–-]+/, '').trim() : '';
    // Rensa "Icon" suffix som Icy Veins lägger till
    source = source.replace(/\s*Icon\s*/gi, ' ').trim();

    items.push({ rank: 'BiS', itemName, itemId, source });
  }

  return items;
}

/**
 * Parsar HTML <table>-taggar direkt.
 */
function parseBisTablesFromHtmlTags(html) {
  const slots = [];

  // Hitta h3-rubriker och tillhörande tables
  // Mönstret: <h3 ...>Best in Slot X for ...</h3> följt av <table>
  const sectionRe = /<h[23][^>]*>[\s\S]*?Best in Slot ([^<]+(?:<[^>]+>[^<]*<\/[^>]+>)*[^<]*)<\/h[23]>([\s\S]*?)(?=<h[23]|$)/gi;
  let secMatch;

  while ((secMatch = sectionRe.exec(html)) !== null) {
    // Extrahera slot-namn (ta bort HTML-taggar)
    const slotRaw = secMatch[1].replace(/<[^>]+>/g, '').trim();
    const sectionContent = secMatch[2];
    const slotName = normalizeSlot(slotRaw);
    if (!slotName) continue;

    // Hitta <table> i sektionen
    const tableMatch = sectionContent.match(/<table[\s\S]*?<\/table>/i);
    if (!tableMatch) continue;

    const tableHtml = tableMatch[0];
    const items = [];

    // Parsa <tr>-rader
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    let isFirst = true;

    while ((rowMatch = rowRe.exec(tableHtml)) !== null) {
      const rowContent = rowMatch[1];

      // Extrahera <td> celler
      const cells = [];
      const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let cellMatch;
      while ((cellMatch = cellRe.exec(rowContent)) !== null) {
        cells.push(cellMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
      }

      if (cells.length < 2) continue;
      if (isFirst) { isFirst = false; continue; } // hoppa header

      const rank = cells[0];
      const itemCellHtml = rowMatch[1].match(/<td[^>]*>([\s\S]*?)<\/td>/gi)?.[1] || '';

      // Extrahera item ID från länk i cell
      const linkRe = /href="[^"]*\/item[=\/](\d+)[^"]*"/i;
      const linkMatch = itemCellHtml.match(linkRe);
      const itemId = linkMatch ? linkMatch[1] : null;
      const itemName = cleanItemName(cells[1]);
      const source = cells[2] || '';

      if (rank && itemName) {
        items.push({ rank, itemName, itemId, source });
      }
    }

    if (items.length > 0) {
      slots.push({ slot: slotName, items });
    }
  }

  return slots;
}

function mergeSlots(primary, secondary) {
  // Deduplicera primary först (kan finnas dubbletter om parsern träffar två gånger)
  const dedupMap = new Map();
  for (const s of primary) {
    const existing = dedupMap.get(s.slot);
    if (!existing || s.items.length > existing.items.length) {
      dedupMap.set(s.slot, s);
    }
  }
  const result = [...dedupMap.values()];
  const existingSlots = new Set(result.map(s => s.slot));

  for (const sec of secondary) {
    if (!existingSlots.has(sec.slot)) {
      result.push(sec);
    } else {
      // Håll den med flest items
      const idx = result.findIndex(s => s.slot === sec.slot);
      if (sec.items.length > result[idx].items.length) {
        result[idx] = sec;
      }
    }
  }
  return result;
}

// ─── Main ──────────────────────────────────────────────────────────────

async function main() {
  console.log('🔍 Wowhead BiS Scraper\n');

  // Ladda alltid befintlig data för att inte skriva över andra phases
  let existing = {};
  if (fs.existsSync(OUTPUT_FILE)) {
    existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
    if (resume) {
      console.log(`📂 Återupptar – ${Object.keys(existing).length} specs redan hämtade\n`);
    } else {
      const existingCount = Object.keys(existing).length;
      if (existingCount > 0) {
        console.log(`📂 Bevarar ${existingCount} befintliga specs från andra phases\n`);
      }
    }
  }

  // Filtrera specs
  let specs = SPECS;
  if (filterPhase) {
    specs = specs.filter(s => s.phase === parseInt(filterPhase));
    console.log(`🔎 Filtrerar: Phase ${filterPhase} (${specs.length} specs)\n`);
  }
  if (filterSpec) {
    const q = filterSpec.toLowerCase();
    specs = specs.filter(s => s.spec.toLowerCase().includes(q) || s.class.toLowerCase().includes(q));
    console.log(`🔎 Filtrerar: spec="${filterSpec}" (${specs.length} specs)\n`);
  }

  const results = { ...existing };
  let fetched = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    const key = `p${spec.phase}-${spec.class}-${spec.spec}`.replace(/\s+/g, '_');

    if (resume && results[key]) {
      console.log(`  ⏭️  [${i + 1}/${specs.length}] Hoppar ${key}`);
      skipped++;
      continue;
    }

    const label = `Phase ${spec.phase} – ${spec.class} ${spec.spec} (${spec.role})`;
    process.stdout.write(`  ⏳ [${i + 1}/${specs.length}] ${label}... `);

    try {
      const slots = await scrapeSpec(spec);

      results[key] = {
        phase: spec.phase,
        role: spec.role,
        class: spec.class,
        spec: spec.spec,
        url: spec.url,
        scrapedAt: new Date().toISOString(),
        slots
      };

      const totalItems = slots.reduce((sum, s) => sum + s.items.length, 0);
      console.log(`✅ ${slots.length} slots, ${totalItems} items`);
      fetched++;

      // Spara efter varje spec (stöder resume vid avbrott)
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));

      // Rate limiting
      if (i < specs.length - 1) {
        await new Promise(r => setTimeout(r, delayMs + Math.random() * 500));
      }
    } catch (err) {
      console.log(`❌ Fel: ${err.message}`);
      failed++;
    }
  }

  console.log('\n─────────────────────────────────────────');
  console.log(`✅ Klart!`);
  console.log(`   Hämtade:  ${fetched}`);
  console.log(`   Hoppade:  ${skipped}`);
  console.log(`   Misslyckade: ${failed}`);
  console.log(`   Totalt i filen: ${Object.keys(results).length} specs`);
  console.log(`\n📄 Sparad: ${OUTPUT_FILE}`);

  // Skriv ut en sammanfattning
  printSummary(results);

  // Stäng Puppeteer
  if (browser) await browser.close();
}

function printSummary(results) {
  console.log('\n📊 Sammanfattning per Phase:\n');
  const byPhase = {};
  for (const [key, data] of Object.entries(results)) {
    const p = data.phase;
    if (!byPhase[p]) byPhase[p] = { specs: 0, slots: 0, items: 0 };
    byPhase[p].specs++;
    byPhase[p].slots  += data.slots.length;
    byPhase[p].items  += data.slots.reduce((sum, s) => sum + s.items.length, 0);
  }
  for (const [phase, stats] of Object.entries(byPhase).sort()) {
    console.log(`  Phase ${phase}: ${stats.specs} specs, ${stats.slots} slots, ${stats.items} items`);
  }
}

main().catch(async err => {
  console.error('💥 Oväntat fel:', err);
  if (browser) await browser.close();
  process.exit(1);
});
