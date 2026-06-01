#!/usr/bin/env node
/**
 * fetch-enchant-catalog.js
 * Builds the enchant catalog for the interactive /enchants browser.
 *
 * Source of truth is data.json: `enchantSources` (spellId → {name, source,
 * sourceLocation}) and `specs[].phases[N].enchants` (recommended {spellId, slot}
 * per spec/phase). Enriches each enchant with its Wowhead spell name/icon/effect.
 *
 * Outputs (deploy-served, consumed lazily by initEnchantBrowser() in js/app.js,
 * and enchant-catalog.json is read by prerender.js for the crawlable list):
 *   - enchant-catalog.json : { "<spellId>": {name, slot, effect, statTags, icon, source, sourceLocation} }
 *   - enchant-usage.json   : { "Class|Spec": { "<phase>": { "<slot>": "<spellId>" } } }
 *
 * Usage:  node fetch-enchant-catalog.js
 */

const fs    = require('fs');
const path  = require('path');
const https = require('https');

const DATA_PATH    = path.join(__dirname, 'data.json');
const CATALOG_OUT  = path.join(__dirname, 'enchant-catalog.json');
const USAGE_OUT    = path.join(__dirname, 'enchant-usage.json');
const CACHE_PATH   = path.join(__dirname, '.enchant-catalog-cache.json');

const WH_API = 'https://nether.wowhead.com/tbc/tooltip/spell/';
const RPS    = 8;
const DELAY  = Math.ceil(1000 / RPS);
const sleep  = ms => new Promise(r => setTimeout(r, ms));

const STAT_KEYWORDS = [
    ['Spell Damage', 'Spell Damage'], ['Spell Power', 'Spell Damage'], ['Healing', 'Healing'],
    ['Attack Power', 'Attack Power'], ['Strength', 'Strength'], ['Agility', 'Agility'],
    ['Stamina', 'Stamina'], ['Intellect', 'Intellect'], ['Spirit', 'Spirit'],
    ['Spell Penetration', 'Spell Penetration'],
    ['Hit Rating', 'Hit'], ['Spell Hit', 'Hit'], ['to hit', 'Hit'],
    ['Critical', 'Crit'], ['Crit', 'Crit'], ['Haste', 'Haste'],
    ['Defense', 'Defense'], ['Dodge', 'Dodge'], ['Resilience', 'Resilience'],
    ['mana per 5', 'MP5'], ['mana every 5', 'MP5'], ['Resistance', 'Resistance'],
    ['All Stats', 'All Stats'], ['to all stats', 'All Stats'], ['Stats', 'All Stats'],
    ['Threat', 'Threat'], ['threat', 'Threat'], ['Run Speed', 'Run Speed'],
    ['Block', 'Block'], ['Armor', 'Armor'], ['Mana', 'Mana'],
    ['movement speed', 'Run Speed'], ['frost damage', 'Spell Damage'],
    ['fire damage', 'Spell Damage'], ['shadow damage', 'Spell Damage'],
    ['arcane damage', 'Spell Damage'], ['nature damage', 'Spell Damage']
];

function parseEffect(tooltip) {
    if (!tooltip) return '';
    const t = tooltip.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')
        .replace(/&#?\w+;/g, ' ').replace(/\s+/g, ' ').trim();
    const m = t.match(/Permanently[^.]*\./i);
    return m ? m[0].trim() : '';
}

function statTagsFor(text) {
    const lower = text.toLowerCase();
    const tags = new Set();
    for (const [kw, tag] of STAT_KEYWORDS) {
        if (lower.includes(kw.toLowerCase())) tags.add(tag);
    }
    return [...tags];
}

function fetchSpell(id) {
    return new Promise(resolve => {
        https.get(WH_API + id, { headers: { 'User-Agent': 'TBC-BiS-App/1.0' } }, res => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => {
                try {
                    const j = JSON.parse(body);
                    resolve({ name: j.name || null, icon: j.icon || null, effect: parseEffect(j.tooltip) });
                } catch { resolve(null); }
            });
        }).on('error', () => resolve(null));
    });
}

async function main() {
    console.log('✨ Enchant Catalog Builder — Wowhead TBC\n');

    const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    const sources = data.enchantSources || {};
    const spellIds = Object.keys(sources);
    console.log(`📦 ${spellIds.length} enchants in data.json enchantSources\n`);

    // ── Usage: collapse to ONE enchant per slot per spec across all phases ──
    // Phase-by-phase data is sparse/inconsistent (some phases list 1 enchant,
    // others 9-14); enchants barely change by phase in TBC, so we take the most
    // common spellId per slot across phases to get a complete, stable per-spec set.
    const slotCount = {};                 // spellId → { slot: n }  (for catalog's bestSlot)
    const specSlotIds = {};               // "Class|Spec" → slot → { spellId: n }
    for (const spec of data.specs || []) {
        const key = `${spec.className}|${spec.specName}`;
        specSlotIds[key] = specSlotIds[key] || {};
        for (const phase of Object.keys(spec.phases || {})) {
            for (const e of (spec.phases[phase].enchants || [])) {
                const id = String(e.spellId);
                const slot = String(e.slot).split('~')[0];   // normalize multi-slot
                slotCount[id] = slotCount[id] || {};
                slotCount[id][slot] = (slotCount[id][slot] || 0) + 1;
                specSlotIds[key][slot] = specSlotIds[key][slot] || {};
                specSlotIds[key][slot][id] = (specSlotIds[key][slot][id] || 0) + 1;
            }
        }
    }
    const bestSlot = id => {
        const counts = slotCount[id] || {};
        const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || '';
        return top.split('~')[0];
    };

    // Role → default Ring enchant (enchanter-only; source data omits it for some
    // specs). Ring enchant spellIds: Striking 27920, Spellpower 27924,
    // Healing Power 27926, Stats 27927.
    const RING_BY_ROLE = { tank: '27927', healer: '27926', caster: '27924', physical: '27920' };
    const SPEC_ROLE = {
        'Warrior|Protection': 'tank', 'Paladin|Protection': 'tank', 'Druid|Bear': 'tank',
        'Paladin|Holy': 'healer', 'Priest|Holy': 'healer', 'Shaman|Restoration': 'healer', 'Druid|Restoration': 'healer',
        'Mage|Arcane': 'caster', 'Mage|Fire': 'caster', 'Mage|Frost': 'caster',
        'Warlock|Affliction': 'caster', 'Warlock|Demonology': 'caster', 'Warlock|Destruction': 'caster',
        'Priest|Shadow': 'caster', 'Shaman|Elemental': 'caster', 'Druid|Balance': 'caster'
    };
    const usage = {};                     // "Class|Spec" → { slot: spellId }
    for (const key of Object.keys(specSlotIds)) {
        usage[key] = {};
        for (const slot of Object.keys(specSlotIds[key])) {
            const ids = specSlotIds[key][slot];
            usage[key][slot] = Object.keys(ids).sort((a, b) => ids[b] - ids[a])[0];
        }
        if (!usage[key].Ring) usage[key].Ring = RING_BY_ROLE[SPEC_ROLE[key] || 'physical'];
    }

    // Fetch Wowhead spell metadata (cached)
    let cache = fs.existsSync(CACHE_PATH) ? JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')) : {};
    const needed = spellIds.filter(id => !cache[id]);
    console.log(`🌐 Fetching ${needed.length} from Wowhead (${spellIds.length - needed.length} cached)\n`);
    for (let i = 0; i < needed.length; i++) {
        const r = await fetchSpell(needed[i]);
        cache[needed[i]] = r || { name: null, icon: null, effect: '' };
        await sleep(DELAY);
        if ((i + 1) % 20 === 0 || i === needed.length - 1) {
            process.stdout.write(`\r  ⏳ ${i + 1}/${needed.length}  `);
            fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
        }
    }
    if (needed.length) console.log('\n');
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));

    // Build catalog
    const catalog = {};
    for (const id of spellIds) {
        const c = cache[id] || {};
        const src = sources[id] || {};
        const name = c.name || src.name || `Enchant ${id}`;
        const effect = c.effect || '';
        catalog[id] = {
            name,
            slot:     bestSlot(id),
            effect,
            statTags: statTagsFor(`${name} ${effect}`),
            icon:     c.icon || 'inv_misc_note_01',
            source:   src.source || '',
            sourceLocation: src.sourceLocation || ''
        };
    }
    fs.writeFileSync(CATALOG_OUT, JSON.stringify(catalog));
    fs.writeFileSync(USAGE_OUT, JSON.stringify(usage));

    const bySlot = {};
    for (const e of Object.values(catalog)) bySlot[e.slot] = (bySlot[e.slot] || 0) + 1;
    console.log(`✅ ${CATALOG_OUT} — ${Object.keys(catalog).length} enchants`);
    console.log(`✅ ${USAGE_OUT} — ${Object.keys(usage).length} specs`);
    console.log('\n📊 By slot:', bySlot);
    const noTags = Object.values(catalog).filter(e => !e.statTags.length).length;
    console.log('enchants without statTags:', noTags);
}

main().catch(console.error);
