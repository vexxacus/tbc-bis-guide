#!/usr/bin/env node
/**
 * Prerender static HTML pages with correct <title>, <meta>, <link rel="canonical">
 * and JSON-LD baked in — so Googlebot sees unique content per URL without needing
 * to render JavaScript first.
 *
 * Usage:
 *   node prerender.js                                # all URLs from sitemap.xml
 *   node prerender.js --only /druid/balance/phase-5  # one URL (test mode)
 *   node prerender.js --dry-run                      # don't write files, print plan
 *
 * The generated <path>/index.html files live alongside the existing index.html.
 * Firebase Hosting prefers static files over the SPA rewrite, so /druid/balance/phase-5
 * will serve /druid/balance/phase-5/index.html when present.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const BASE_URL  = 'https://tbc-bis-guide.com';
const ROOT      = __dirname;
const TEMPLATE  = path.join(ROOT, 'index.html');

// WCL parser counts — used in the per-page methodology line. Built from the
// same scrape JSON the runtime serves; loaded lazily so dev never breaks if missing.
let WCL_COUNTS = null;
function getWclTotalPlayers(cls, spec, phase) {
    if (phase === 0 || phase == null) return null;
    if (WCL_COUNTS === null) {
        try {
            const raw = fs.readFileSync(path.join(ROOT, 'scraper/output/wcl-bis-data.json'), 'utf8');
            const data = JSON.parse(raw);
            WCL_COUNTS = {};
            for (const [ph, phData] of Object.entries(data.phases || {})) {
                WCL_COUNTS[ph] = {};
                for (const [specKey, specData] of Object.entries(phData.specs || {})) {
                    WCL_COUNTS[ph][specKey] = specData.totalPlayers || null;
                }
            }
        } catch (_) {
            WCL_COUNTS = {};
        }
    }
    const appKey = `${cls}|${spec}`;
    const wclKey = APP_TO_WCL_SPEC[appKey] || appKey;
    return WCL_COUNTS?.[phase]?.[wclKey] || null;
}

// Mirror of app.js APP_TO_WCL_SPEC
const APP_TO_WCL_SPEC = {
    'Druid|Cat':  'Druid|Feral',
    'Druid|Bear': 'Druid|Guardian',
};

// ─── Route data (mirrors js/app.js) ──────────────────────────────────

const CLASS_META = {
    Warrior:  { color: '#C79C6E', specs: ['Arms', 'Fury', 'Protection'] },
    Paladin:  { color: '#F58CBA', specs: ['Holy', 'Protection', 'Retribution'] },
    Hunter:   { color: '#ABD473', specs: ['Beast Mastery', 'Marksmanship', 'Survival'] },
    Rogue:    { color: '#FFF569', specs: ['Combat', 'Assassination', 'Subtlety'] },
    Priest:   { color: '#FFFFFF', specs: ['Discipline', 'Holy', 'Shadow'] },
    Shaman:   { color: '#0070DE', specs: ['Elemental', 'Enhancement', 'Restoration'] },
    Mage:     { color: '#69CCF0', specs: ['Arcane', 'Fire', 'Frost'] },
    Warlock:  { color: '#9482C9', specs: ['Affliction', 'Demonology', 'Destruction'] },
    Druid:    { color: '#FF7D0A', specs: ['Balance', 'Bear', 'Cat', 'Restoration'] }
};

const PHASE_NAMES = {
    0: { label: 'Pre-BiS' },
    1: { label: 'Phase 1' },
    2: { label: 'Phase 2' },
    3: { label: 'Phase 3' },
    4: { label: 'Phase 4' },
    5: { label: 'Phase 5' }
};

const PHASE_SLUG_MAP = {
    'pre-bis': 0, 'phase-0': 0,
    'phase-1': 1, 'phase-2': 2, 'phase-3': 3, 'phase-4': 4, 'phase-5': 5
};

function toSlug(str) {
    return str.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

// Build reverse lookups
const CLASS_SLUG_MAP = {};
const SPEC_SLUG_MAP  = {};
for (const cls of Object.keys(CLASS_META)) {
    CLASS_SLUG_MAP[toSlug(cls)] = cls;
    for (const spec of CLASS_META[cls].specs) {
        SPEC_SLUG_MAP[`${toSlug(cls)}-${toSlug(spec)}`] = { cls, spec };
    }
}

// PvP-only spec names that come from scraped arena data (not in CLASS_META).
// Mirrors PVP_TO_PVE_SPEC in app.js — display name shown to users is the PvP name.
const PVP_SPEC_OVERRIDES = {
    'druid-feral-combat': { cls: 'Druid', spec: 'Feral Combat' },
};

// Spec abbreviations injected into meta descriptions to capture searches like
// "ret pally bis", "bm hunter bis", "boomkin enchants". Volume data from Ahrefs.
// Only specs with a widely-used short form are listed — Arms/Fury/Frost etc. are
// already short and don't need expansion.
const SPEC_ABBREV = {
    'Paladin-Retribution':  'Ret',
    'Paladin-Protection':   'Prot',
    'Warrior-Protection':   'Prot',
    'Hunter-Beast Mastery': 'BM',
    'Hunter-Marksmanship':  'MM',
    'Warlock-Destruction':  'Destro',
    'Warlock-Affliction':   'Affli',
    'Druid-Restoration':    'Resto',
    'Shaman-Restoration':   'Resto',
    'Shaman-Elemental':     'Ele',
    'Shaman-Enhancement':   'Enh',
    'Rogue-Subtlety':       'Sub',
    'Priest-Discipline':    'Disc',
    'Druid-Balance':        'Boomkin',
    'Druid-Cat':            'Feral DPS',
    'Druid-Bear':           'Feral Tank',
};

/** Return "Spec Cls (Abbrev)" if an abbrev exists, otherwise just "Spec Cls". */
function specWithAbbrev(cls, spec) {
    const abbrev = SPEC_ABBREV[`${cls}-${spec}`];
    return abbrev ? `${spec} ${cls} (${abbrev})` : `${spec} ${cls}`;
}

/** Inject the abbreviation into a description that already mentions "Spec Cls". */
function injectAbbrev(desc, cls, spec) {
    const abbrev = SPEC_ABBREV[`${cls}-${spec}`];
    if (!abbrev || !desc) return desc;
    const needle = `${spec} ${cls}`;
    if (desc.includes(needle)) {
        // Replace only the first occurrence, append abbrev *after* the class name
        return desc.replace(needle, `${spec} ${cls} (${abbrev})`);
    }
    return desc;
}

// ─── Per-spec phase descriptions (extracted from app.js) ─────────────
// Only the ones we need for prerendering. Full set lives in app.js.
const SPEC_PHASE_DESCRIPTIONS = require('./prerender-descriptions.js');

// ─── BiS item data (for static BiS summary, prerendered into pages) ──
// Lazy-loaded on first use to keep prerender startup fast.
let _bisData = null;
function getBisData() {
    if (_bisData) return _bisData;
    _bisData = require('./data.json');
    return _bisData;
}

// ─── PvP scraped data (for live arena snapshot, prerendered) ─────────
// js/pvp-data.js is an auto-generated `const PVP_DATA = {...};` script.
// We strip the prefix/suffix and parse as JSON so we can load it in Node.
let _pvpData = null;
function getPvpData() {
    if (_pvpData) return _pvpData;
    const raw = fs.readFileSync(path.join(ROOT, 'js/pvp-data.js'), 'utf8');
    const json = raw.replace(/^const PVP_DATA = /, '').replace(/;\s*$/, '');
    _pvpData = JSON.parse(json);
    return _pvpData;
}

// Static, hand-written PvP context per spec. Rendered as additional FAQ items
// (plain-text answers, since FAQPage JSON-LD requires plain strings and we
// want the visible FAQ to match the structured data exactly).
//
// All entries researched via WebSearch from authoritative TBC PvP guides
// (Skill-Capped, Wowhead, Icy Veins, Warcraft Tavern) on 2026-05-22.
// Key format matches PVP_DATA.specs keys: "Class|Spec".
const PVP_SPEC_CONTEXT = {
    'Warrior|Arms': {
        roleAnswer: `Arms is one of the strongest melee specs in TBC arena, built around Mortal Strike — a 50% healing reduction that turns enemy heals into a finite resource the opposing team must outlast. Arms brings sustained pressure, strong mobility through Charge and Intercept, and the famous Deep Thunder mace stun as hard-CC. Above 2000 rating Arms is typically played as swap-and-pressure: open on a kill target, force defensive cooldowns, then maintain Mortal Strike uptime while the team sets up the kill window. Stance dancing — Battle for Overpower, Berserker for Whirlwind and the crit bonus, Defensive for Spell Reflect and Disarm — is core to the spec.`,
        compsAnswer: `In 2v2, Warrior plus a healer is the time-honored setup. Warrior/Druid (Resto) is the dominant pairing — Druid HoTs match the Warrior's high armor and Resilience well — with Warrior/Priest (Discipline) as a strong alternative whose dispels help against Mage teams. In 3v3, the textbook setups are Warrior/Mage/Druid (WMD) and Warrior/Mage/Priest (WMP); both rely on caster CC chains to land Mortal Strike windows. Warrior/Warlock/Druid (WLD) is the legendary attrition comp that wins by outlasting opponents, with the Warlock's Felhunter handling debuff cleanup via Devour Magic. Turbo Cleave (Warrior/Enhancement Shaman/Healer) is the burst-oriented variant, leaning on Bloodlust and Windfury Totem to delete targets in one go.`,
        statsAnswer: `Resilience is the foundation — it reduces both the chance of being crit and the damage taken from crits, which is decisive against Mages and Warlocks. Stack as much Resilience as the season's gear allows without significantly gapping your Attack Power and Critical Strike rating. After Resilience, Strength scales Mortal Strike's flat damage and is the primary offensive stat, followed by Critical Strike Rating, Hit Rating, and Expertise. From Season 3 onward, the Arena sets begin including passive Armor Penetration, which combined with specific PvE off-pieces lets Arms tear through high-armor targets. Two-handed slow weapons are mandatory — they maximize Mortal Strike's weapon-damage component, and the Arena-purchased 2H weapons are the standard targets.`,
    },
    'Hunter|Beast Mastery': {
        roleAnswer: `Beast Mastery is the burst-oriented Hunter spec in TBC arena. The core mechanic is Bestial Wrath combined with The Beast Within, which causes the Hunter and pet to deal massively increased damage for 18 seconds while also dispelling and preventing crowd control. BM is most effective in lower-to-mid rating brackets where uncoordinated teams struggle to peel the pet and survive the burst window. The pet — typically a Ravager for the stun and damage profile — is central to BM's value: positioning and keeping it alive is the spec's main skill check. Above 2400 rating, Marksmanship generally supplants BM due to Viper Sting drain pressure being harder to counter than burst.`,
        compsAnswer: `In 2v2, Beast Mastery Hunter/Restoration Druid is the standard setup — a durable team using line-of-sight, HoT healing through pet-on-healer pressure, and the BM burst window to force kills. Hunter/Disc Priest also sees play for the Pain Suppression security blanket during burst trades. In 3v3, BM fits into Hunter/Druid/Rogue and Hunter/Warlock/Druid lineups, leveraging pet utility (Ravager stun, Felhunter cleanse) alongside high burst windows. The comp is generally less stable than MM's drain teams at the top of the ladder but more explosive at the moment of the kill attempt.`,
        statsAnswer: `Hit Rating comes first — get to the 3% special-attack hit cap (around 50 Hit Rating) so Aimed Shot and Steady Shot never miss. After Hit, stack Resilience to survive burst trades and Mage Frostbolts. Agility is the primary offensive stat (Attack Power, Crit, dodge), followed by Stamina for survivability. Use a slow ranged weapon (~3.0 speed) with high top-end damage to maximize Auto Shot and Aimed Shot, and keep ammo at the highest tier you can afford — Adamantite Stinger or the Engineering shells in later phases.`,
    },
    'Hunter|Marksmanship': {
        roleAnswer: `Marksmanship is the meta Hunter spec for high-rated TBC arena, built around Viper Sting drain pressure and reliable burst from Aimed Shot. The Hunter's role is to apply continuous mana pressure on the enemy healer with Viper Sting, while landing Scatter Shot, Wyvern Sting (via the MM/SV hybrid build), and Silencing Shot to lock out kill windows. Pet positioning matters less than for BM — the pet is primarily there to interrupt drinking and apply Growl-based pressure. Most high-rated Hunters run a hybrid 41/20/0 build that grabs Scatter Shot and Wyvern Sting from the Survival tree.`,
        compsAnswer: `In 2v2, Hunter/Resto Druid is the classic drain team — the Druid's HoTs and Cyclone keep the Hunter alive while Viper Sting forces the enemy healer out of mana. In 3v3, the textbook drain comp is Hunter/Druid/Disc Priest: triple sustain through HoTs and Power Infusion, with the pet preventing enemy drinks while the team rotates CC. Hunter/Warlock/Druid is another strong drain composition that leans on Fear chains alongside Viper Sting. Burst-oriented variants pair the Hunter with a Rogue or Mage instead of going full attrition.`,
        statsAnswer: `Hit Rating first — 3% special-attack hit cap is non-negotiable, otherwise Aimed Shot and the stings miss. After hit, Resilience is the priority defensive stat. Agility provides Attack Power, Crit, and dodge in one stat and is the main offensive scaling. Intellect matters more than for BM because of Viper Sting's mana cost and Aimed Shot spam — keeping mana up over a 10-minute drain match is part of the spec's job. A slow 3.0-speed bow or crossbow with the highest damage available, paired with top-tier ammo, is the ranged-weapon baseline.`,
    },
    'Hunter|Survival': {
        roleAnswer: `Survival plays similarly to Marksmanship in arena but trades a small amount of burst for better durability through Survivalist (extra Stamina) and additional CC tools. The spec's defining ability for arena is Wyvern Sting — a 12-second sleep with a damage component that's effectively a second CC line on top of Scatter Shot and Freezing Trap. Most arena Hunters labelled as Survival are actually running a Survival-leaning hybrid that puts enough points in Marksmanship for Aimed Shot and Trueshot Aura. Pure Survival is uncommon at the highest ratings — MM with Survival talents is the more common build — but the playstyle and comps overlap heavily.`,
        compsAnswer: `Survival's comp options mirror Marksmanship: Hunter/Resto Druid in 2v2 leveraging the drain plan, and Hunter/Druid/Disc Priest or Hunter/Warlock/Druid in 3v3. The added Wyvern Sting CC makes Survival particularly strong against melee cleaves that lack defensive dispels, since the sleep is harder to remove than a Mage's Polymorph. Survival is also seen in less drain-oriented 3v3 setups that prioritize CC layering over pure mana attrition.`,
        statsAnswer: `Hit Rating to 3% special-attack cap, then Resilience for survival. Agility leads offensive scaling (Attack Power, Crit, dodge) and Stamina provides extra effective health that pairs with Survival's defensive talents. Intellect supports the sting-heavy playstyle. Like MM, use a slow ranged weapon with high damage range and the best ammo you can craft or buy — Survival also benefits from some melee stats due to occasional Raptor Strike and Mongoose Bite use at close range.`,
    },
    'Rogue|Subtlety': {
        roleAnswer: `Subtlety is the dominant Rogue arena spec in TBC, built around Shadowstep — a 30-yard teleport that places the Rogue behind the target with a movement-speed bonus and a damage bonus on the next ability. Shadowstep enables long-range Cheap Shot openers, gap-closing onto kiting casters, and re-stealth plays after Vanish. The spec's value in arena is one-shot windows (full energy plus Premeditation, Hemorrhage spam, and Cold Blood Eviscerate) combined with the longest CC chain in the game — Cheap Shot into Kidney Shot, with Blind and Sap as setup tools. After patch 2.3.2 nerfed Combat, virtually all high-rated arena Rogues run Subtlety with Shadowstep.`,
        compsAnswer: `In 2v2, Rogue/Druid (Resto) and Rogue/Priest (Discipline) are the staple compositions — the Rogue applies CC and burst while the healer dispels offensively (Priest) or sets up with Cyclone (Druid). In 3v3, RMP (Rogue/Mage/Priest) is the most famous TBC arena composition and is widely considered one of the best teams in the game's history, built around chained Polymorph, Sap, and Cheap Shot into a Mage shatter burst. Variants include RLS (Rogue/Warlock/Shaman) and RLD (Rogue/Warlock/Druid) for more attrition-oriented play, and Rogue/Warrior/Druid cleave for double-melee pressure on a single target.`,
        statsAnswer: `Hit Rating is the most important stat — get to the 5% special-attack hit cap (around 80 Hit Rating, since the off-hand penalty doesn't apply to specials), otherwise Cheap Shot, Kidney Shot, and Hemorrhage can miss and entire CC chains collapse. After hit, Resilience for survivability. Agility is the primary offensive stat (Attack Power, Crit, dodge). Both weapons should be the fastest dagger speed available; Mace Specialization builds can swap to maces for the 1% stun proc against plate targets. Stack Resilience aggressively — Rogues are squishier than they look once enemies pop their cooldowns on you.`,
    },
    'Rogue|Combat': {
        roleAnswer: `Combat was a viable arena spec in early TBC seasons but fell out of favor after patch 2.3.2 nerfed Combat Potency and several supporting talents, after which Subtlety became the near-universal pick. Combat brings sustained sword or fist-weapon pressure through Sword Specialization or Combat Potency, with stronger uptime damage than Subtlety but no Shadowstep, meaning gap-closing and re-stealth options are limited. The spec is occasionally seen in pure burst-cleave comps where the team can hard-train a single target and Combat's energy regeneration delivers more sustained DPS than Subtlety can. At the highest ratings it's a niche pick.`,
        compsAnswer: `Combat's natural pairing is with a healer who can keep the Rogue on a melee target without needing Shadowstep gap closers — typically Rogue/Druid (Resto) or Rogue/Paladin (Holy) in 2v2. In 3v3, Combat fits into double-melee cleaves like Rogue/Warrior/Healer where two melee with high uptime can pressure a target into a defensive cooldown rotation. Pure Combat is rarely seen at Gladiator-level ratings; most "Combat" Rogues at the top of the ladder are actually 15/41/5 hybrid builds that grab Shadowstep but pick up Combat's weapon expertise.`,
        statsAnswer: `Hit Rating to the 5% special-attack cap, then Resilience. Agility scales Attack Power, Crit, and dodge. Combat synergizes with slower main-hand weapons (swords or maces in the 2.6 speed range) and a fast off-hand dagger or fist weapon — the main-hand carries Sinister Strike damage while the off-hand drives Combat Potency procs. Like Subtlety, the Combat Rogue lives or dies by Resilience in arena; the spec brings no Shadowstep defensive tech, so stacking damage mitigation over raw offense is even more important than for Sub.`,
    },
    'Priest|Discipline': {
        roleAnswer: `Discipline is the dominant arena healer for most of TBC, especially through Seasons 1 and 2. The spec's identity is built around Pain Suppression (a 65% damage-reduction cooldown that saves teammates from burst), Power Infusion (a 20% damage and haste cooldown given to a DPS partner), and Mass Dispel (which removes Polymorph, Ice Block, Divine Shield, and other previously uncleansable effects). On top of that, Discipline's instant heals, shields via Power Word: Shield, and the Disc/Holy hybrid talent build give the spec the best survivability of any TBC healer. Offensive dispel (removing buffs from enemies) is a core part of the toolkit in nearly every match.`,
        compsAnswer: `In 2v2, Discipline pairs naturally with high-pressure DPS — Disc/Warrior (Arms), Disc/Rogue (Sub), and Disc/Mage (Frost) are all common Gladiator-level setups. In 3v3, Disc is the healer slot in RMP (Rogue/Mage/Priest), one of the strongest 3v3 compositions in TBC. Disc also features in WMP (Warrior/Mage/Priest), Hunter/Druid/Disc drain comps, and Rogue/Warrior/Disc double-melee. Disc's biggest weakness is being trained by a coordinated melee cleave with kicks — Pain Suppression on cooldown is the spec's main escape valve.`,
        statsAnswer: `Resilience is the top priority — Disc Priests are often the focus target and need to survive long burst windows. After Resilience, Bonus Healing scales the throughput of Greater Heal and Prayer of Healing, and Spirit (combined with Meditation) provides in-combat mana regen. Stamina contributes survivability through Inner Fire and effective health. Spell Hit Rating matters surprisingly little since healing spells don't miss, but a small amount helps the offensive Shadow Word: Death and Mind Blast that Disc occasionally casts.`,
    },
    'Priest|Holy': {
        roleAnswer: `Holy is rarely played in high-rated TBC arena — Discipline's combination of Pain Suppression, Power Infusion, and Mass Dispel is significantly better suited to the 2v2/3v3 format. Holy's higher raw throughput on Greater Heal and access to Circle of Healing make it stronger in 5v5 arena and battlegrounds where there are more targets to heal and less burst targeted at the healer. In small-scale arena, Holy's lack of Pain Suppression makes it a noticeably softer target than Disc, and you'll see it almost exclusively at lower ratings or in specific comp experiments rather than in the meta.`,
        compsAnswer: `When Holy is played in 2v2 arena, it functions in the same comp slots as Disc — Holy/Warrior and Holy/Rogue see occasional play — but generally underperforms compared to a Disc Priest in those same setups. In 3v3, Holy is uncommon; the RMP slot is universally Disc. Where Holy shines is 5v5 arena and rated battlegrounds, where the larger team size lets Holy take advantage of group healing without being singled out for damage.`,
        statsAnswer: `Resilience and Stamina are still the survivability foundation, but Holy gets significantly more value from Bonus Healing and Spirit than Discipline does, because Holy's larger heals scale more aggressively with healing power and the spec relies more on sustained throughput than damage mitigation. Mana per 5 (MP5) on PvP-flexible PvE pieces is also more valuable for Holy than for Disc. Beyond that, Holy follows the same gear template as Disc — there is no dedicated "Holy PvP" set distinct from the Priest arena set.`,
    },
    'Priest|Shadow': {
        roleAnswer: `Shadow Priest is top-tier in every TBC arena bracket and is the default caster DPS slot in many high-rated 3v3 compositions. The spec's value comes from layered pressure (Vampiric Touch, Shadow Word: Pain, and Devouring Plague tick at the same time), high-impact burst from Mind Blast and Shadow Word: Death, and a deep toolkit: Psychic Scream AoE fear, Silence, Shadowfiend mana drain, Shadowform damage reduction, and offensive dispel through Mass Dispel and Dispel Magic. Vampiric Touch also returns mana to the entire party on each tick, which sustains drain comps over long matches.`,
        compsAnswer: `Shadow Priest's flagship 3v3 composition is Shatterplay — Shadow Priest/Frost Mage/Resto Druid — where Shadow Priest sets up kills with Silence and Mind Blast while the Mage delivers Shatter combos. Shadow also features in Rogue/Shadow Priest/Healer comps, Hunter/Shadow Priest/Druid drain teams, and Warrior/Shadow Priest/Druid for swap-pressure plus dispel. In 2v2, Shadow Priest/Disc Priest and Shadow Priest/Resto Druid are the standard pairings; both rely on the Shadow Priest's self-healing via Vampiric Embrace and Shadowform mitigation to survive long matches.`,
        statsAnswer: `Resilience is the top defensive priority since Shadow Priests are frequently focus-targeted. Hit Rating to the 3% spell hit cap (76 Hit Rating with no talents, less if you take Shadow Focus) is essential — Vampiric Touch and Mind Flay missing breaks the entire damage profile. After hit, Bonus Damage scales every shadow spell, with Spell Penetration helping against magic-resistance auras. Intellect and Spirit support sustained casting in long matches, and Stamina from Shadowform gives Shadow more effective health than other caster specs.`,
    },
    'Shaman|Elemental': {
        roleAnswer: `Elemental Shaman struggles in 2v2 and 3v3 TBC arena due to its reliance on long cast times (Lightning Bolt at ~2.5 seconds, Lava Burst on cooldown) and a thin defensive toolkit compared to other caster DPS. The spec's strengths — burst damage from Elemental Mastery plus Lava Burst with Flame Shock applied for guaranteed crit, Earth Shock to interrupt casts, and Grounding Totem to absorb a key spell — shine in larger formats where the Shaman can find more uninterrupted casting time. In 2v2 and 3v3, Elemental is generally considered off-meta and is rarely seen at high ratings, but does compete in 5v5 arena and rated battlegrounds where its burst and totem utility scale better.`,
        compsAnswer: `In 2v2, Elemental pairs with CC-heavy partners that can buy casting time — Elemental/Rogue (Sub), Elemental/Warlock, or Elemental/Frost Mage are the options, though all are uphill compared to other caster pairings. In 3v3, the standard setup is Elemental plus a melee CC class (Rogue, Warrior, or Warlock with Fear) plus a healer (Disc Priest or Resto Druid). Elemental is far more comfortable in 5v5 arena, where its AoE burst and Grounding Totem find more value, and in battlegrounds where it can free-cast from range.`,
        statsAnswer: `Resilience is essential since the Shaman is squishy in cloth-equivalent mail. Hit Rating to the spell hit cap (3%, accounting for Elemental Precision in talents) ensures Lightning Bolt and Lava Burst (when not guaranteed) land reliably. Bonus Damage scales the spec's offensive throughput, with Spell Penetration helping against shamanistic resistances. Intellect and MP5 support long matches against drain teams, and Stamina provides much-needed effective health.`,
    },
    'Shaman|Enhancement': {
        roleAnswer: `Enhancement Shaman is generally considered weak in 2v2 and 3v3 TBC arena due to lacking a Mortal Strike-equivalent healing reduction and no strong crowd-control toolkit compared to other melee. Its arena identity is built around Stormstrike (a hard-hitting nature-damage strike), Windfury Totem (which dramatically boosts melee group damage), and Bloodlust (group 30% haste cooldown). Enhancement does see niche play at the 3v3 level in the Turbo Cleave composition where Bloodlust plus Windfury power a Warrior's burst window, but outside that specific setup the spec is rare at high ratings. Earth Shock provides melee-range interrupt as the spec's primary lockdown.`,
        compsAnswer: `Enhancement's signature 3v3 composition is Turbo Cleave — Warrior plus Enhancement Shaman plus Healer (typically Resto Druid or Disc Priest) — where the Shaman drops Windfury Totem and casts Bloodlust to enable a coordinated burst window with the Warrior. Outside of Turbo Cleave, 2v2 options include Enh/Resto Druid, Enh/Disc Priest, or Enh/Rogue, but all are off-meta compared to the standard melee comps. The spec's lack of consistent CC means its arena viability is heavily comp-dependent.`,
        statsAnswer: `Resilience is the foundation as Enhancement is a melee target without plate armor. Hit Rating to the special-attack hit cap (5% on yellow attacks, around 80 Hit Rating) is essential so Stormstrike doesn't miss. Agility provides Attack Power, Crit, and dodge as the main offensive scaling, with Intellect supporting Shock and totem mana costs. A two-handed weapon was the standard in early TBC, with the spec eventually transitioning to dual-wield as Windfury weapon enchant and gear improved — most arena Enhancement Shamans run two-handed for the larger Stormstrike hits.`,
    },
    'Shaman|Restoration': {
        roleAnswer: `Restoration Shaman is relatively weak in 2v2 and 3v3 TBC arena due to reliance on long cast times (Healing Wave at 3 seconds, Lesser Healing Wave at 1.5) that are vulnerable to interrupts and crowd control. The spec lacks an instant-cast emergency heal equivalent to Druid HoTs or Priest Power Word: Shield, and Earth Shield, while useful, doesn't fully compensate. Resto Shaman's strengths — Bloodlust as a 30% haste cooldown, Tremor Totem to break fears, Grounding Totem, Mana Tide Totem, and Nature's Swiftness — find more value in 5v5 arena and rated battlegrounds where the totems benefit more allies and the Shaman has more peeling support.`,
        compsAnswer: `In 2v2, Resto Shaman/Rogue and Resto Shaman/Warrior are the standard pairings, leveraging the Shaman's Bloodlust to enable a kill window, but both struggle against double-DPS teams that train the Shaman. In 3v3, Resto Shaman sees occasional play in Shaman cleave (Enh Shaman/Resto Shaman/DPS), but is generally outclassed by Disc Priest and Resto Druid as the healer slot. Resto Shaman dominates in 5v5 arena and rated battlegrounds where totem coverage scales with team size, Tremor Totem becomes essential against multiple fear classes, and the Shaman has more peelers available.`,
        statsAnswer: `Resilience is the priority — healers are focus-targeted in arena and the Shaman lacks the survivability tools of Disc or Druid. Bonus Healing scales every heal, and MP5 (along with Spirit through Mana Spring Totem) supports long matches. Stamina provides effective health for surviving burst trades. Spell hit doesn't apply to healing spells, so it's only relevant for the occasional Earth Shock interrupt or Purge (offensive dispel). A one-hand weapon plus shield is preferable to two-handed for the survivability stats most healing maces lack.`,
    },
    'Mage|Arcane': {
        roleAnswer: `Arcane Mage is the burst-window specialization, built around a single 15-second kill attempt powered by Arcane Power, Presence of Mind, and Icy Veins (through the 17/0/44 hybrid talent build that most Arcane PvP Mages use). The plan is to set up the target with CC (Polymorph, Counterspell), then deliver an Arcane Blast or Pyroblast-tier burst that can one-shot a non-Resilience-stacked target. Arcane is rarely the top arena Mage choice — Frost's sustained control and Shatter combos win out at high ratings — but it sees niche play in burst-focused comps where the team can chain CC long enough to set up a single kill window.`,
        compsAnswer: `Arcane fits into the same comp slots as Frost (RMP, Shatterplay variants, Mage cleaves) but is generally outperformed by Frost in each. In 2v2, Arcane/Disc Priest leans on Power Infusion to amplify the burst window. In 3v3, Arcane occasionally appears in Rogue/Mage/Priest variants where the team has decided to commit to a one-shot strategy rather than long-game pressure. Most "Arcane" PvP Mages at high rating are running the 17/0/44 Frost/Arcane hybrid that takes Arcane Power and Presence of Mind from the Arcane tree while keeping the Frost survival toolkit.`,
        statsAnswer: `Resilience is the foundation — Mages are squishy and the burst-window playstyle means surviving long enough to set it up is the bottleneck. Hit Rating to the 3% spell hit cap (76 Hit Rating, less with Arcane Focus) ensures the burst lands. Bonus Damage (or Bonus Spell Damage) scales the kill window, with Intellect providing Crit through Arcane Mind and mana pool. Spell Penetration helps push damage through Mark of the Wild and shaman resistance totems. Stamina via the Mage Armor variant of Frost Armor provides survivability — mandatory for arena.`,
    },
    'Mage|Frost': {
        roleAnswer: `Frost Mage is one of the strongest arena specs in TBC and the dominant Mage choice at high ratings. The spec's identity is Shatter — Frost's talented critical-strike chance against frozen targets reaches up to 50% on top of base Crit — combined with the Water Elemental's Freeze and the Mage's own Frost Nova and Frostbite procs to keep targets locked down. The classic shatter combo is Frostbolt cast on a frozen target with Ice Lance pre-cast to land the moment Frostbolt finishes, delivering a guaranteed-crit burst. Beyond burst, Frost brings the deepest control toolkit in the game: Polymorph, Counterspell, Frost Nova, Cone of Cold slow, Blink, and Ice Block as the ultimate "out of jail" defensive.`,
        compsAnswer: `Frost Mage is the cornerstone of RMP (Rogue/Mage/Priest) — widely considered one of the best TBC arena compositions of all time — where the Mage chains Polymorph and delivers Shatter combos while the Rogue lands kidney chains. Shatterplay (Frost Mage/Shadow Priest/Resto Druid) is the other Frost staple, using Mind Blast burst alongside the Mage's Shatter windows. In 2v2, Frost Mage/Disc Priest and Frost Mage/Resto Druid are both strong, with the "Shatter Rogue" 2v2 (Frost Mage/Rogue) leveraging stuns into Shatter for a sub-10-second kill window. WMD (Warrior/Mage/Druid) is the melee-cleave variant.`,
        statsAnswer: `Hit Rating to the 3% spell hit cap (76 Hit Rating, less with talented spell-school hit) is essential — Polymorph missing breaks entire kill setups. After hit, Resilience for surviving focus pressure. Bonus Damage scales every Frost spell, and Spell Penetration (target 40+) helps push damage through Mark of the Wild and resistance auras. Intellect provides Crit through Arcane Mind and mana pool. Stamina is more important for Mages than for other casters because Ice Block consumes 1% of max HP, so a deep health pool means more Ice Blocks worth of effective health.`,
    },
    'Warlock|Demonology': {
        roleAnswer: `In TBC arena, Demonology is rarely played as a pure spec — the dominant Warlock arena build is SL/SL (Soul Link Affliction/Demonology hybrid), a 0/21/40 build that takes Soul Link from Demonology for the 20% damage-share with the Felguard and the surrounding survivability talents, while keeping Siphon Life, Curse of Exhaustion, and the core Affliction DoTs from the Affliction tree. The result is an attrition-based DPS that wins through outlasting opponents: Soul Link splits damage with the pet, Fel Armor with Demonic Aegis boosts healing taken, Siphon Life self-heals through DoT damage, and Death Coil provides a 3-second fear that doubles as a self-heal. The Felguard's Intercept and stun are the spec's primary peel tools.`,
        compsAnswer: `SL/SL Warlock plus a Resto Druid is one of the strongest 2v2 compositions in TBC — extreme attrition, multiple CC sources (Fear, Howl of Terror, Death Coil, Cyclone), and self-healing make the team almost impossible to kill if played correctly. In 3v3, WLD (Warrior/Warlock/Druid) is the legendary attrition comp built around Death Coil and Fear chains; RLD (Rogue/Warlock/Druid) trades the Warrior for Rogue burst windows; and Warlock/Shadow Priest/Druid is a triple-DoT pressure comp. The Felhunter pet (swapped in over the Felguard for certain matchups) provides Devour Magic for cleansing the team of buffs and DoTs.`,
        statsAnswer: `Resilience is the foundation — even with Soul Link splitting damage, the Warlock is a high-priority target. Hit Rating to the 3% spell hit cap (76 Hit Rating, accounting for Suppression in the Affliction tree) ensures Fear and DoTs land reliably. Bonus Damage scales DoT throughput and Shadow Bolt damage, and Spell Penetration (40+) helps push damage through Mage Mark of the Wild. Intellect and Stamina from gear pair well with Fel Armor's healing increase. Spirit is largely wasted as Life Tap provides mana — most arena Warlocks ignore it in favor of pure DPS stats.`,
    },
    'Druid|Feral Combat': {
        roleAnswer: `Feral Druid in TBC arena plays like a hybrid Rogue/Warrior with shape-shift utility. Cat form delivers high burst through Mangle, Shred, and Rip bleed pressure, while Bear form provides emergency survival via Frenzied Regeneration, a higher armor and HP pool, and Bash for stun. The unique kit also includes Cyclone (shape-shifting before cast lets Feral break stuns and silences to cast it), Innervate for team mana sustain, and Travel Form for between-pillar mobility. Feral's value comes from the combination — few specs can swap from a 60% burst window to a 30k-HP defensive form in a single global cooldown.`,
        compsAnswer: `In 2v2, Feral/Rogue is the highest-pressure double-melee setup with shared stun and bleed pressure, while Feral/Disc Priest leverages Power Infusion plus Pain Suppression to enable kill windows. Feral/Hunter and Feral/Warlock also see play for the CC-heavy partner approach. In 3v3, Feral/Disc Priest/Hunter and Feral/Disc Priest/Rogue are the standard compositions, both relying on the Priest's dispels and Power Infusion to amplify the Druid's burst. Pure Feral is less common than Resto at the top of the ladder but consistently competitive in dedicated burst comps.`,
        statsAnswer: `Hit Rating to the special-attack hit cap (around 5% / ~80 Hit Rating) is essential — Mangle and Shred missing cancels entire combo-point chains. After hit, Resilience for surviving burst trades. Agility scales Attack Power, Crit, and dodge as the primary offensive stat. Strength gives Attack Power but at a worse rate than Agility for Feral. Stamina is important because Bear form's HP pool is the spec's main defensive cooldown — more health means more time in Bear before swap. A slow two-handed staff or polearm is the standard weapon, with Idols providing additional bonuses to specific abilities.`,
    },
    'Druid|Restoration': {
        roleAnswer: `Restoration Druid is one of the strongest arena healers in TBC, especially after the introduction of Resilience and Cyclone reshaped the meta. The kit is built around heal-over-time stacking — Rejuvenation, Lifebloom, Regrowth, Wild Growth — which allows the Druid to apply healing while moving, kiting, and even drinking behind pillars. Cyclone is one of the strongest CC abilities in the game: a 6-second target lockout where the enemy cannot be healed, damaged, or affected, making it a kill-window CC and a defensive save in equal measure. Innervate provides team mana sustain, and Travel Form plus Barkskin offer survivability against melee trains.`,
        compsAnswer: `In 2v2, Resto Druid pairs with virtually every DPS as a strong option — Druid/Rogue, Druid/Warrior, Druid/Warlock, Druid/Hunter, and Druid/Mage are all standard Gladiator-range setups. In 3v3, Resto Druid is the healer slot in WLD (Warrior/Warlock/Druid), RLD (Rogue/Warlock/Druid), WMD (Warrior/Mage/Druid), Shatterplay (Frost Mage/Shadow Priest/Druid), Hunter/Warlock/Druid drain comps, and many others. The Druid's portability — HoTs run while moving, easy drinking behind LoS, escape via Travel Form — makes them the most flexible healer in TBC arena.`,
        statsAnswer: `Resilience is the priority — healers are focus-targeted and the Druid needs to survive the burst trades. Bonus Healing scales every HoT and direct heal, with Spirit (combined with Tree of Life's mana regen mechanics) supporting long matches. Stamina provides survivability — a deep HP pool means more time before a Druid is killed or has to pop Barkskin. MP5 on flexible PvE pieces is also valuable. Intellect helps mana pool but is usually a byproduct of stacking healing power and stamina rather than a primary stat.`,
    },
    'Paladin|Retribution': {
        roleAnswer: `Retribution Paladin is the burst-and-CC melee spec in TBC arena, built around the burst window combination of Avenging Wrath (20% damage bonus for 20 seconds) plus an on-use trinket (typically Bloodlust Brooch for AP) plus Hammer of Justice stun and Repentance long-cast incapacitate. The kill plan is to open with Repentance on the enemy healer to buy a six-second free hit on their DPS, then stack on the kill target with Avenging Wrath active and use Hammer of Justice during the burst to extend their inability to act. Outside the burst window, Ret offers Blessing of Protection (for melee swap targets), Blessing of Freedom (against snares), and Cleanse to remove poisons, diseases, and magic.`,
        compsAnswer: `Rogue/Paladin (RPS or "RPally") is the classic Ret 2v2 — coordinated burst with the Rogue's stuns lining up with Avenging Wrath for a one-shot window. Ret/Warlock (Demonology) is also viable for sustained control combined with Ret burst, and Ret/Resto Shaman pairs Ret's offensive utility with the Shaman's Bloodlust for an explosive burst phase. In 3v3, Ret features in compositions like Ret/Rogue/Healer (double-melee burst) and Ret/Mage/Healer, with the Mage's Polymorph and Frost Nova layering with Ret's Repentance for extended CC. Ret is generally stronger as a burst-window specialist than as a sustained-pressure DPS.`,
        statsAnswer: `Hit Rating to the special-attack hit cap (around 5% / ~80 Hit Rating) is essential — Crusader Strike and Judgements missing during the burst window collapses kill attempts. After hit, Strength scales Attack Power and the spec's damage profile, with Critical Strike Rating amplifying the Seal of Command and Judgement of Command crit-heavy burst. Resilience for survivability — Ret is a focus target due to the burst threat. Armor Penetration becomes more valuable in Season 3 onward as Arena sets begin including it natively, paired with specific PvE off-pieces. A two-handed weapon (axe, mace, or sword) is mandatory; slow weapons with high top-end damage maximize Seal of Command procs and Crusader Strike damage.`,
    },
};

// Slot order for the live PvP data summary. PVP_DATA slot keys use "Shoulders"
// and don't have a Two-Hand entry (it's Main Hand for 2H weapons).
const PVP_SLOT_ORDER = [
    'Head', 'Neck', 'Shoulders', 'Back', 'Chest', 'Wrist',
    'Hands', 'Waist', 'Legs', 'Feet',
    'Ring', 'Trinket', 'Main Hand', 'Off Hand', 'Ranged'
];

// Static BiS summary is rendered on all phase pages. Set to a specific URL
// (e.g. '/druid/balance/phase-5') to limit while testing UX changes.
const STATIC_BIS_PROTOTYPE_URL = null;

const STATIC_BIS_SLOT_ORDER = [
    'Head', 'Neck', 'Shoulder', 'Back', 'Chest', 'Wrist',
    'Hands', 'Waist', 'Legs', 'Feet',
    'Ring', 'Trinket',
    'Main Hand', 'Off Hand', 'Two Hand',
    'Ranged/Relic', 'Ranged', 'Relic'
];

/** Pick top-BIS items per slot (1 each, except Ring/Trinket = 2). Returns
 *  ordered array suitable for a summary table. */
function pickTopBisItems(items) {
    const seenIds = new Set();
    const picked = [];
    for (const it of items) {
        if (it.rank !== 'BIS') continue;
        if (seenIds.has(it.itemId)) continue;
        const limit = (it.slot === 'Ring' || it.slot === 'Trinket') ? 2 : 1;
        const count = picked.filter(p => p.slot === it.slot).length;
        if (count >= limit) continue;
        picked.push(it);
        seenIds.add(it.itemId);
    }
    picked.sort((a, b) => {
        const ai = STATIC_BIS_SLOT_ORDER.indexOf(a.slot);
        const bi = STATIC_BIS_SLOT_ORDER.indexOf(b.slot);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
    return picked;
}

/** Build the visible static BiS summary block — a definition-list of top BIS
 *  items per slot with Wowhead links and source descriptions. Used by
 *  Googlebot on first crawl before JS renders the interactive list. */
function buildStaticBisBlock(route) {
    if (route.type !== 'phase') return null;
    const data = getBisData();
    const spec = data.specs.find(s =>
        s.className === route.cls && s.specName === route.spec
    );
    if (!spec || !spec.phases || !spec.phases[route.phase]) return null;
    const phase = spec.phases[route.phase];
    const top = pickTopBisItems(phase.items || []);
    if (!top.length) return null;

    const phLabel = route.phase === 0 ? 'Pre-Raid' : PHASE_NAMES[route.phase].label;
    const heading = `${route.spec} ${route.cls} ${phLabel} BiS Items — Quick Reference`;

    const rows = top.map(it => {
        const src = data.itemSources[it.itemId];
        const srcText = src
            ? [src.source || src.sourceType, src.sourceLocation]
                .filter(Boolean).join(' — ')
            : '';
        const wowheadHref = `https://www.wowhead.com/tbc/item=${it.itemId}`;
        const link = `<a href="${wowheadHref}" rel="external">${escapeHtmlText(it.name)}</a>`;
        const srcSpan = srcText ? `<span class="bis-static-src">(${escapeHtmlText(srcText)})</span>` : '';
        return `<dt>${escapeHtmlText(it.slot)}</dt><dd>${link} ${srcSpan}</dd>`;
    }).join('\n        ');

    return `<h3>${escapeHtmlText(heading)}</h3>
    <dl>
        ${rows}
    </dl>
    <p class="bis-static-note">Interactive view with alternatives, enchants, gems &amp; sim loads below.</p>`;
}

// ─── Route parser ────────────────────────────────────────────────────

function parseRoute(urlPath) {
    const parts = urlPath.replace(/^\//, '').replace(/\/$/, '').split('/').filter(Boolean);

    if (!parts.length) return { type: 'home' };

    if (['about', 'privacy', 'feedback'].includes(parts[0])) {
        return { type: 'static', page: parts[0] };
    }

    const cls = CLASS_SLUG_MAP[parts[0]];
    if (!cls) return null;

    if (parts.length === 1) return { type: 'class', cls };

    let specEntry = SPEC_SLUG_MAP[`${parts[0]}-${parts[1]}`];

    // PvP-only spec slugs (e.g. druid-feral-combat) aren't in CLASS_META.
    if (!specEntry && parts[2] === 'pvp') {
        specEntry = PVP_SPEC_OVERRIDES[`${parts[0]}-${parts[1]}`];
    }
    if (!specEntry) return { type: 'class', cls };          // fall back to class page

    if (parts.length === 2) return { type: 'spec', cls, spec: specEntry.spec };

    if (parts[2] === 'pvp') return { type: 'pvp', cls, spec: specEntry.spec };

    const phase = PHASE_SLUG_MAP[parts[2]];
    if (phase == null) return { type: 'spec', cls, spec: specEntry.spec };

    return { type: 'phase', cls, spec: specEntry.spec, phase };
}

// ─── SEO content per route (mirrors updateSeoMeta in app.js) ─────────

function seoForRoute(route, fullUrl) {
    let title, desc, h1;

    switch (route.type) {
        case 'home':
            title = 'TBC Classic BiS Guide — Best in Slot for Every Class & Spec';
            desc  = 'Complete TBC Classic Best in Slot gear guide for every class and spec — Pre-Raid through Sunwell. Includes enchants, gems, stat priority, and phase-by-phase progression.';
            h1    = 'TBC Best in Slot — Top Player Picks';
            break;
        case 'static':
            const titleMap = {
                about:    'About — TBC Classic BiS Guide',
                privacy:  'Privacy Policy — TBC Classic BiS Guide',
                feedback: 'Feedback & Roadmap — TBC Classic BiS Guide'
            };
            const descMap = {
                about:    'About the TBC Classic Best in Slot Guide — sources, methodology, and contact.',
                privacy:  'Privacy policy for tbc-bis-guide.com.',
                feedback: 'Send feedback, request new features, or view the public roadmap for TBC BiS Guide.'
            };
            title = titleMap[route.page];
            desc  = descMap[route.page];
            h1    = titleMap[route.page].split(' — ')[0];
            break;
        case 'class':
            title = `${route.cls} BiS Guide — TBC Classic`;
            desc  = `WoW Classic TBC Best in Slot gear for ${route.cls} — every spec, Pre-Raid through Sunwell Plateau. Includes enchants, gems, and stat priority for each phase.`;
            // H1 matches post-JS keyword-rich version (was "Druid"; JS later sets "Druid BiS Guide")
            h1    = `${route.cls} BiS Guide`;
            break;
        case 'spec':
            title = `${route.spec} ${route.cls} BiS Guide — TBC Classic`;
            desc  = `${specWithAbbrev(route.cls, route.spec)} BiS for TBC Classic — Pre-Raid through Sunwell Plateau. Full gear lists with enchants, gems, and stat priority. Pick a phase below.`;
            h1    = `${route.spec} ${route.cls} BiS Guide`;
            break;
        case 'pvp':
            title = `${route.spec} ${route.cls} PvP BiS — TBC Classic`;
            desc  = `Live arena snapshot of the best gear for ${specWithAbbrev(route.cls, route.spec)} PvP in TBC Classic, based on what the highest-rated arena players are wearing right now. Includes enchants and gems.`;
            h1    = `${route.spec} ${route.cls} PvP BiS`;
            break;
        case 'phase':
            const phLabel    = PHASE_NAMES[route.phase].label;
            // SEO label: "Pre-Raid" matches search volume better than "Pre-BiS" (Ahrefs).
            const seoPhLabel = route.phase === 0 ? 'Pre-Raid' : phLabel;
            const phaseSpecDesc = (SPEC_PHASE_DESCRIPTIONS[`${route.cls}-${route.spec}`] || {})[route.phase];
            const bisSuffix = /bis/i.test(seoPhLabel) ? '' : ' BiS';
            title = `${route.spec} ${route.cls} ${seoPhLabel}${bisSuffix} — TBC Classic`;
            desc  = phaseSpecDesc
                ? injectAbbrev(phaseSpecDesc, route.cls, route.spec)
                : `Best in Slot gear for ${specWithAbbrev(route.cls, route.spec)} in TBC Classic ${phLabel}. Full gear list with enchants, gems, stat priority, and item sources.`;
            // H1 matches the keyword-rich title (minus "— TBC Classic" suffix) — same as JS sets post-render
            h1    = `${route.spec} ${route.cls} ${seoPhLabel}${bisSuffix}`;
            break;
        default:
            return null;
    }

    return { title, desc, h1, url: fullUrl };
}

// ─── Visible SEO body content (#seoDescription, #seoFaq, #seoSummary) ─

const PHASE_RAID_CONTEXT = {
    0: 'Pre-Raid dungeons and heroics',
    1: 'Karazhan, Gruul\'s Lair, and Magtheridon\'s Lair',
    2: 'Serpentshrine Cavern and Tempest Keep',
    3: 'Black Temple and Mount Hyjal',
    4: 'Zul\'Aman and Badge of Justice gear',
    5: 'Sunwell Plateau'
};

// Short raid name for anchor-text use (e.g., "Phase 1 (Karazhan)"). Targets
// raid-specific search volume (Sunwell 2300, Karazhan 800, ZA 400 etc.).
const PHASE_RAID_SHORT = {
    0: 'Pre-Raid Dungeons',
    1: 'Karazhan',
    2: 'SSC & TK',
    3: 'Black Temple',
    4: "Zul'Aman",
    5: 'Sunwell'
};

const PHASE_TO_SLUG_REV = { 0:'phase-0', 1:'phase-1', 2:'phase-2', 3:'phase-3', 4:'phase-4', 5:'phase-5' };

// Lightweight role hint for class-landing spec lists.
const SPEC_ROLE = {
    Arms: 'Melee DPS', Fury: 'Melee DPS', Protection: 'Tank',
    Holy: 'Healer', Retribution: 'Melee DPS', Discipline: 'Healer',
    'Beast Mastery': 'Ranged DPS', Marksmanship: 'Ranged DPS', Survival: 'Ranged DPS',
    Combat: 'Melee DPS', Assassination: 'Melee DPS', Subtlety: 'Melee DPS',
    Shadow: 'Ranged DPS', Elemental: 'Ranged DPS', Enhancement: 'Melee DPS',
    Restoration: 'Healer',
    Arcane: 'Ranged DPS', Fire: 'Ranged DPS', Frost: 'Ranged DPS',
    Affliction: 'Ranged DPS', Demonology: 'Ranged DPS', Destruction: 'Ranged DPS',
    Balance: 'Ranged DPS', Bear: 'Tank', Cat: 'Melee DPS',
};

/** Phase anchor text: e.g. "Phase 1 (Karazhan)", "Pre-Raid (Dungeons)". */
function phaseAnchorText(phase) {
    const label = phase === 0 ? 'Pre-Raid' : PHASE_NAMES[phase].label;
    const raid  = PHASE_RAID_SHORT[phase];
    if (!raid) return label;
    if (phase === 0) return `Pre-Raid (Dungeons)`;
    return `${label} (${raid})`;
}

/** Build the visible #seoDescription content (H2 + paragraph). */
function buildSeoDescriptionBlock(route, seo) {
    if (route.type !== 'phase') return null;
    const seoPhLabel = route.phase === 0 ? 'Pre-Raid' : PHASE_NAMES[route.phase].label;
    const heading = `${specWithAbbrev(route.cls, route.spec)} ${seoPhLabel} BiS Guide`;
    return `<div class="seo-desc-inner">
        <span class="seo-desc-icon">📖</span>
        <div>
            <h2 class="seo-desc-heading">${escapeHtmlText(heading)}</h2>
            ${buildMethodologyLine(route.cls, route.spec, route.phase)}
            <p class="seo-desc-text">${escapeHtmlText(seo.desc)}</p>
        </div>
    </div>`;
}

/** Methodology framing line — mirrored in js/app.js buildMethodologyLine. */
function buildMethodologyLine(cls, spec, phase) {
    if (phase === 0 || phase == null) {
        return `<p class="seo-methodology">📊 Pre-raid gear from dungeons, heroics, and crafting — the foundation top parsers build on before their first raid kill.</p>`;
    }
    const players = getWclTotalPlayers(cls, spec, phase);
    const countStr = players ? `the top <strong>${players}</strong> ` : `top `;
    const phLabel = (PHASE_NAMES[phase] || { label: `Phase ${phase}` }).label;
    return `<p class="seo-methodology">✨ Based on what ${countStr}WarcraftLogs ${escapeHtmlText(spec)} ${escapeHtmlText(cls)} parsers actually wear in ${escapeHtmlText(phLabel)} — ranked by usage, not theorycraft.</p>`;
}

/** Build the visible #seoFaq content (3 Q&A items in a <dl>). */
function buildSeoFaqBlock(route, seo) {
    if (route.type !== 'phase') return null;
    const phLabel = PHASE_NAMES[route.phase].label;
    const items = [
        {
            q: `What is BiS for ${route.spec} ${route.cls} in ${phLabel}?`,
            a: seo.desc
        },
        {
            q: `Where do I get ${route.spec} ${route.cls} ${phLabel} gear?`,
            a: route.phase === 0
                ? 'The best gear comes from dungeons, heroics, reputation vendors, and crafting. See the full list above with item sources for each slot.'
                : 'The best gear comes from raid drops, Badge of Justice vendor, arena, and crafted items. See the full list above with item sources for each slot.'
        },
        {
            q: `What enchants and gems should ${route.spec} ${route.cls} use in ${phLabel}?`,
            a: `Each slot has a recommended enchant and gem shown next to the item. Enchants and gems are chosen based on the stat priority for ${route.spec} ${route.cls} in TBC Classic.`
        }
    ];
    const dl = items.map(i =>
        `<dt>${escapeHtmlText(i.q)}</dt><dd>${escapeHtmlText(i.a)}</dd>`
    ).join('\n        ');
    return `<h2 class="seo-faq-heading">Frequently Asked Questions</h2>
    <dl>
        ${dl}
    </dl>`;
}

/** Build the visible #seoClassLanding block for class landing pages (e.g. /paladin). */
function buildClassLandingBlock(route, pvpSpecsByClass) {
    if (route.type !== 'class') return null;
    const cls   = route.cls;
    const specs = (CLASS_META[cls] || {}).specs || [];

    const specLis = specs.map(s => {
        const abbrev = SPEC_ABBREV[`${cls}-${s}`];
        const label  = abbrev ? `${s} (${abbrev}) ${cls}` : `${s} ${cls}`;
        const role   = SPEC_ROLE[s] || '';
        const href   = `/${toSlug(cls)}/${toSlug(s)}`;
        return `<li><a href="${href}"><strong>${escapeHtmlText(label)} BiS</strong></a>${role ? ' — ' + escapeHtmlText(role) : ''}</li>`;
    }).join('\n        ');

    // Phase quick-links: one row per spec, all six phases each.
    const phaseSpecBlocks = specs.map(s => {
        const links = [0, 1, 2, 3, 4, 5].map(p => {
            const slug  = PHASE_TO_SLUG_REV[p];
            const href  = `/${toSlug(cls)}/${toSlug(s)}/${slug}`;
            const label = phaseAnchorText(p);
            return `<a href="${href}">${escapeHtmlText(label)}</a>`;
        }).join(' · ');
        return `<p><strong>${escapeHtmlText(s)}:</strong> ${links}</p>`;
    }).join('\n    ');

    // PvP cross-links: only specs that actually have PvP data (sourced from sitemap).
    // Includes PvP-only specs like Druid Feral Combat that aren't in CLASS_META.
    const pvpSpecs = (pvpSpecsByClass && pvpSpecsByClass[cls]) || [];
    const pvpLinks = pvpSpecs.map(spec =>
        `<a href="/${toSlug(cls)}/${toSlug(spec)}/pvp">${escapeHtmlText(spec)} PvP</a>`
    ).join(' · ');

    return `<h2>${escapeHtmlText(cls)} BiS for TBC Classic — Every Spec, Every Phase</h2>
    <p>Best in Slot gear guides for <strong>${escapeHtmlText(cls)}</strong> in WoW Classic TBC. Pick a spec for phase-by-phase BiS lists from Pre-Raid through Sunwell Plateau, including enchants, gems, and stat priority recommendations.</p>
    <h3>${escapeHtmlText(cls)} specs</h3>
    <ul>
        ${specLis}
    </ul>
    ${phaseSpecBlocks ? `<h3>Quick links by phase</h3>\n    ${phaseSpecBlocks}` : ''}
    ${pvpLinks ? `<h3>${escapeHtmlText(cls)} PvP BiS</h3>\n    <p>Live arena snapshot of top-rated players. ${pvpLinks}</p>` : ''}`;
}

/** Build the visible #seoSpecLanding block for spec landing pages (e.g. /paladin/retribution). */
function buildSpecLandingBlock(route) {
    if (route.type !== 'spec') return null;
    const cls    = route.cls;
    const spec   = route.spec;
    const abbrev = SPEC_ABBREV[`${cls}-${spec}`];
    const specFull = abbrev ? `${spec} ${cls} (${abbrev})` : `${spec} ${cls}`;
    const role   = SPEC_ROLE[spec] || '';

    const phaseLis = [0, 1, 2, 3, 4, 5].map(p => {
        const slug  = PHASE_TO_SLUG_REV[p];
        const href  = `/${toSlug(cls)}/${toSlug(spec)}/${slug}`;
        const phLabel = p === 0 ? 'Pre-Raid BiS' : `${PHASE_NAMES[p].label} BiS`;
        const raid    = PHASE_RAID_CONTEXT[p];
        return `<li><a href="${href}"><strong>${escapeHtmlText(phLabel)}</strong></a> — ${escapeHtmlText(raid)}</li>`;
    }).join('\n        ');

    const otherSpecs = (CLASS_META[cls] ? CLASS_META[cls].specs : [])
        .filter(s => s !== spec)
        .map(s => {
            const a = SPEC_ABBREV[`${cls}-${s}`];
            const label = a ? `${s} (${a})` : s;
            return `<a href="/${toSlug(cls)}/${toSlug(s)}">${escapeHtmlText(label)}</a>`;
        }).join(' · ');

    return `<h2>${escapeHtmlText(specFull)} BiS for TBC Classic</h2>
    <p>Best in Slot gear lists for <strong>${escapeHtmlText(specFull)}</strong>${role ? ` (${escapeHtmlText(role)})` : ''} in TBC Classic. Choose a phase below for the full gear list with enchants, gems, stat priority, and item sources.</p>
    <h3>Phase guides</h3>
    <ul>
        ${phaseLis}
    </ul>
    ${otherSpecs ? `<h3>Other ${escapeHtmlText(cls)} specs</h3>\n    <p>${otherSpecs}</p>` : ''}`;
}

/** Build the visible #seoDescription content (H2 + paragraph) for PvP landing pages.
 *  Stays intentionally minimal — arena role / comps / stat priority live in the
 *  FAQ block below so the page doesn't open with a wall of text. */
function buildPvpDescriptionBlock(route, seo) {
    if (route.type !== 'pvp') return null;
    const spec = specWithAbbrev(route.cls, route.spec);
    return `<div class="seo-desc-inner">
        <span class="seo-desc-icon">⚔️</span>
        <div>
            <h2 class="seo-desc-heading">${escapeHtmlText(spec)} PvP BiS — TBC Classic Arena</h2>
            <p class="seo-desc-text">${escapeHtmlText(seo.desc)}</p>
        </div>
    </div>`;
}

/** Return the spec's PvP data block (PVP_DATA.specs[key]) or null if missing.
 *  PvP-only specs like Druid Feral Combat are keyed by their scraped name, which
 *  matches route.spec for those (we route them via PVP_SPEC_OVERRIDES). */
function getPvpSpecData(route) {
    if (route.type !== 'pvp') return null;
    const data = getPvpData();
    return (data.specs || {})[`${route.cls}|${route.spec}`] || null;
}

/** Build a "live arena snapshot" block: meta line + dl of top-popularity items
 *  per slot. Reuses the #bisStaticSummary container (same CSS as the PvE block).
 *  Returns null if PVP_DATA has no entry for this spec. */
function buildPvpDataSummaryBlock(route) {
    const sd = getPvpSpecData(route);
    if (!sd) return null;
    const rr = sd.ratingRange || {};
    const rows = PVP_SLOT_ORDER.map(slot => {
        const items = sd.slots && sd.slots[slot];
        if (!items || !items.length) return null;
        const top = items[0];
        const href = `https://www.wowhead.com/tbc/item=${top.id}`;
        return `<dt>${escapeHtmlText(slot)}</dt><dd><a href="${href}" rel="external">${escapeHtmlText(top.name)}</a> <span class="bis-static-src">(${top.popularity}% of players)</span></dd>`;
    }).filter(Boolean).join('\n        ');

    return `<h3>Most-used gear — live arena snapshot</h3>
    <p>Across <strong>${sd.playerCount}</strong> top-rated ${escapeHtmlText(route.spec)} ${escapeHtmlText(route.cls)}s in this snapshot (rating <strong>${rr.min}–${rr.max}</strong>, average <strong>${rr.avg}</strong>), the most popular pick per slot is shown below. Full alternatives, gem and enchant breakdowns are in the interactive list further down.</p>
    <dl>
        ${rows}
    </dl>`;
}

/** Build the auto-generated PvP FAQ block (visible). Combines static spec
 *  context (if authored) with five data-driven Q&A from scraped PVP_DATA. */
function buildPvpFaqBlock(route) {
    if (route.type !== 'pvp') return null;
    const sd = getPvpSpecData(route);
    const items = buildPvpFaqItems(route, sd);
    if (!items.length) return null;
    const dl = items.map(i =>
        `<dt>${escapeHtmlText(i.q)}</dt><dd>${escapeHtmlText(i.a)}</dd>`
    ).join('\n        ');
    return `<h2 class="seo-faq-heading">Frequently Asked Questions</h2>
    <dl>
        ${dl}
    </dl>`;
}

/** Shared PvP FAQ item list — used both for visible block and FAQPage JSON-LD,
 *  so the structured data matches exactly what the user sees.
 *
 *  Order: static spec context first (arena role, comps, stats) when we have it,
 *  then dynamic data-driven Q&A. Top placement of context Q&A means users see
 *  it expanded near the page top while keeping the intro short. */
function buildPvpFaqItems(route, sd) {
    const items = [];
    const specName = `${route.spec} ${route.cls}`;

    // Static spec context (when authored) — placed at the top of FAQ.
    const ctx = PVP_SPEC_CONTEXT[`${route.cls}|${route.spec}`];
    if (ctx) {
        if (ctx.roleAnswer) {
            items.push({
                q: `What is ${specName}'s role in TBC arena?`,
                a: ctx.roleAnswer,
            });
        }
        if (ctx.compsAnswer) {
            items.push({
                q: `Which arena compositions are strongest for ${specName}?`,
                a: ctx.compsAnswer,
            });
        }
        if (ctx.statsAnswer) {
            items.push({
                q: `What is the PvP stat priority for ${specName}?`,
                a: ctx.statsAnswer,
            });
        }
    }

    // Dynamic data-driven Q&A — skip if no scraped data for this spec.
    if (!sd) return items;
    const rr = sd.ratingRange || {};

    // Q1: top chest piece (high-popularity gold/strong tier item)
    const chest = (sd.slots && sd.slots.Chest && sd.slots.Chest[0]);
    if (chest) {
        items.push({
            q: `What chest piece do top ${specName} arena players wear?`,
            a: `${chest.name} is worn by ${chest.popularity}% of the ${sd.playerCount} top-rated ${specName}s analyzed in this snapshot. See alternatives and enchant choices in the live list above.`
        });
    }

    // Q2: chest enchant — Resilience-or-similar pattern
    const chestEnchant = chest && chest.topEnchants && chest.topEnchants[0];
    if (chestEnchant) {
        items.push({
            q: `What chest enchant should ${specName} use in PvP?`,
            a: `${cleanEnchantName(chestEnchant.name)} is used by ${chestEnchant.usage}% of top arena players in this spec, making it the standard PvP chest enchant.`
        });
    }

    // Q3: weapon
    const mainHand = sd.slots && sd.slots['Main Hand'] && sd.slots['Main Hand'][0];
    if (mainHand) {
        items.push({
            q: `What weapon do top ${specName} PvP players use?`,
            a: `${mainHand.name} is the most popular choice at ${mainHand.popularity}% usage. Weapon choice in TBC PvP often comes down to whether you've cleared the relevant rating gate or can afford the gold/honor cost — see alternatives in the live list above.`
        });
    }

    // Q4: rating range / data source
    items.push({
        q: `What rating range does this ${specName} PvP BiS list cover?`,
        a: `Data is based on ${sd.playerCount} ${specName} arena players rated between ${rr.min} and ${rr.max} (average ${rr.avg}). The list is refreshed weekly from ironforge.pro's arena leaderboard scrape.`
    });

    // Q5: PvE crossover
    items.push({
        q: `Should ${specName} use PvE gear in arena?`,
        a: `Some PvE epics with high stat budgets are worn by top arena players when the slot's PvP option is weak — they're marked "PvE flex" in the live list. However, Resilience-bearing pieces from the Honor and Arena vendors are still the foundation of any PvP gear set.`
    });

    return items;
}

/** Strip the "Enchanted: " prefix used in some PVP_DATA enchant names so the
 *  FAQ reads naturally ("+15 Resilience Rating" instead of "Enchanted: +15..."). */
function cleanEnchantName(name) {
    return String(name || '').replace(/^Enchanted:\s*/, '');
}

/** Build the visible PvP summary (cross-links to PvE BiS + sibling PvP specs +
 *  data refresh meta). */
function buildPvpSummaryBlock(route) {
    if (route.type !== 'pvp') return null;
    const cls  = route.cls;
    const spec = route.spec;

    const pveLink = `<a href="/${toSlug(cls)}/${toSlug(spec)}"><strong>${escapeHtmlText(spec)} ${escapeHtmlText(cls)} PvE BiS</strong></a>`;

    const otherSpecs = (CLASS_META[cls] ? CLASS_META[cls].specs : [])
        .filter(s => s !== spec)
        .map(s => {
            const a = SPEC_ABBREV[`${cls}-${s}`];
            const label = a ? `${s} (${a})` : s;
            return `<a href="/${toSlug(cls)}/${toSlug(s)}/pvp">${escapeHtmlText(label)} PvP</a>`;
        }).join(' · ');

    // Data freshness paragraph — visible E-E-A-T signal explaining methodology.
    const sd = getPvpSpecData(route);
    let dataNote = '';
    if (sd) {
        const data = getPvpData();
        const analyzedAt = (data.meta && data.meta.analyzedAt) ? data.meta.analyzedAt.slice(0, 10) : null;
        dataNote = `<p><em>How this list is built:</em> the items above are aggregated from the public arena leaderboard scrape at ironforge.pro, filtered to ${escapeHtmlText(spec)} ${escapeHtmlText(cls)}s within a competitive rating range. The snapshot refreshes weekly so the rankings track the live meta.${analyzedAt ? ` Current snapshot analyzed on ${escapeHtmlText(analyzedAt)}.` : ''}</p>`;
    }

    return `${dataNote}<p>Looking for raid gear instead? See ${pveLink} for phase-by-phase PvE Best in Slot.</p>
    ${otherSpecs ? `<p>Other ${escapeHtmlText(cls)} PvP specs: ${otherSpecs}</p>` : ''}`;
}

/** Build the visible #seoSummary content (closing paragraph + cross-links). */
function buildSeoSummaryBlock(route) {
    if (route.type !== 'phase') return null;
    const seoPhLabel = route.phase === 0 ? 'Pre-Raid' : PHASE_NAMES[route.phase].label;
    const raid = PHASE_RAID_CONTEXT[route.phase];
    const specName = specWithAbbrev(route.cls, route.spec);

    // Sibling-phase cross-links with raid-context anchor text
    // ("Phase 1 (Karazhan)" captures raid keyword volume in addition to phase keyword).
    const otherPhases = [0, 1, 2, 3, 4, 5]
        .filter(p => p !== route.phase)
        .map(p => {
            const slug  = PHASE_TO_SLUG_REV[p];
            const label = phaseAnchorText(p);
            const href  = `/${toSlug(route.cls)}/${toSlug(route.spec)}/${slug}`;
            return `<a href="${href}">${escapeHtmlText(label)}</a>`;
        }).join(' · ');

    // Sibling-spec cross-links (other specs in same class, same phase)
    const otherSpecs = (CLASS_META[route.cls] ? CLASS_META[route.cls].specs : [])
        .filter(s => s !== route.spec)
        .map(s => {
            const abbrev = SPEC_ABBREV[`${route.cls}-${s}`];
            const label = abbrev ? `${s} (${abbrev})` : s;
            const href = `/${toSlug(route.cls)}/${toSlug(s)}/${PHASE_TO_SLUG_REV[route.phase]}`;
            return `<a href="${href}">${escapeHtmlText(label)}</a>`;
        }).join(' · ');

    let html = `<p>This <strong>${escapeHtmlText(specName)} ${escapeHtmlText(seoPhLabel)} Best in Slot</strong> list covers gear for ${escapeHtmlText(raid)} in TBC Classic — including enchants, gems, and stat priority recommendations.</p>
    <p>Other phases: ${otherPhases}</p>`;
    if (otherSpecs) {
        html += `\n    <p>Other ${escapeHtmlText(route.cls)} specs (${escapeHtmlText(seoPhLabel)}): ${otherSpecs}</p>`;
    }
    return html;
}

// ─── JSON-LD builder ─────────────────────────────────────────────────

function buildJsonLd(route, seo) {
    const schemas = [];

    schemas.push({
        '@context': 'https://schema.org',
        '@type':    'WebPage',
        name:        seo.title,
        description: seo.desc,
        url:         seo.url,
        isPartOf: { '@type': 'WebSite', name: 'TBC BiS Guide', url: BASE_URL + '/' }
    });

    if (route.cls) {
        const items = [];
        let pos = 1;
        items.push({ '@type': 'ListItem', position: pos++, name: 'Home', item: BASE_URL + '/' });
        items.push({ '@type': 'ListItem', position: pos++, name: route.cls, item: BASE_URL + '/' + toSlug(route.cls) });

        if (route.spec) {
            items.push({
                '@type': 'ListItem', position: pos++,
                name: route.spec,
                item: BASE_URL + '/' + toSlug(route.cls) + '/' + toSlug(route.spec)
            });
            if (route.type === 'pvp') {
                items.push({ '@type': 'ListItem', position: pos++, name: 'PvP', item: seo.url });
            } else if (route.type === 'phase') {
                items.push({
                    '@type': 'ListItem', position: pos++,
                    name: PHASE_NAMES[route.phase].label,
                    item: seo.url
                });
            }
        }

        schemas.push({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items });
    }

    if (route.type === 'phase' || route.type === 'pvp') {
        schemas.push({
            '@context': 'https://schema.org',
            '@type':    'ItemList',
            name:        seo.title,
            description: seo.desc,
            url:         seo.url
        });
    }

    // Article schema for phase + PvP pages — eligible for rich results in search.
    // datePublished is fixed (original go-live); dateModified bumps on every prerender.
    if (route.type === 'phase' || route.type === 'pvp') {
        const today = new Date().toISOString().slice(0, 10);
        schemas.push({
            '@context': 'https://schema.org',
            '@type':    'Article',
            headline:    seo.title,
            description: seo.desc,
            url:         seo.url,
            datePublished: '2026-04-01',
            dateModified:  today,
            image:        BASE_URL + '/og-image.png',
            author: {
                '@type': 'Organization',
                name:    'TBC BiS Guide',
                url:     BASE_URL + '/'
            },
            publisher: {
                '@type': 'Organization',
                name:    'TBC BiS Guide',
                url:     BASE_URL + '/',
                logo: {
                    '@type': 'ImageObject',
                    url:     BASE_URL + '/android-chrome-192x192.png'
                }
            },
            mainEntityOfPage: {
                '@type': 'WebPage',
                '@id':   seo.url
            }
        });
    }

    if (route.type === 'phase') {
        const phLabel = PHASE_NAMES[route.phase].label;
        const faq = [
            {
                q: `What is BiS for ${route.spec} ${route.cls} in ${phLabel}?`,
                a: seo.desc
            },
            {
                q: `Where do I get ${route.spec} ${route.cls} ${phLabel} gear?`,
                a: 'The best gear comes from ' +
                    (route.phase === 0
                        ? 'dungeons, heroics, reputation vendors, and crafting.'
                        : 'raid drops, Badge of Justice vendor, arena, and crafted items.') +
                    ' See the full list above with item sources for each slot.'
            },
            {
                q: `What enchants should ${route.spec} ${route.cls} use in ${phLabel}?`,
                a: `Each slot has a recommended enchant shown next to the item. Enchants are chosen based on stat weights for ${route.spec} ${route.cls} in TBC Classic.`
            }
        ];
        schemas.push({
            '@context': 'https://schema.org',
            '@type':    'FAQPage',
            mainEntity: faq.map(f => ({
                '@type': 'Question',
                name: f.q,
                acceptedAnswer: { '@type': 'Answer', text: f.a }
            }))
        });
    }

    // FAQPage schema for PvP pages — questions/answers must mirror the visible
    // FAQ block exactly (Google flags mismatched structured data).
    if (route.type === 'pvp') {
        const sd = getPvpSpecData(route);
        const faq = buildPvpFaqItems(route, sd);
        if (faq.length) {
            schemas.push({
                '@context': 'https://schema.org',
                '@type':    'FAQPage',
                mainEntity: faq.map(f => ({
                    '@type': 'Question',
                    name: f.q,
                    acceptedAnswer: { '@type': 'Answer', text: f.a }
                }))
            });
        }
    }

    return schemas.map(s =>
        `<script type="application/ld+json" data-bis-jsonld>${JSON.stringify(s)}</script>`
    ).join('\n    ');
}

// ─── HTML rewriter ───────────────────────────────────────────────────

function escapeHtmlAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtmlText(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function rewriteHtml(template, seo, jsonLd, bodyBlocks) {
    let html = template;

    // <title>
    html = html.replace(
        /<title>[\s\S]*?<\/title>/,
        `<title>${escapeHtmlText(seo.title)}</title>`
    );

    // <meta name="description">
    html = html.replace(
        /<meta id="metaDescription"[^>]*>/,
        `<meta id="metaDescription" name="description" content="${escapeHtmlAttr(seo.desc)}">`
    );

    // <link rel="canonical">
    html = html.replace(
        /<link id="canonicalLink"[^>]*>/,
        `<link id="canonicalLink" rel="canonical" href="${escapeHtmlAttr(seo.url)}">`
    );

    // OG URL
    html = html.replace(
        /<meta id="ogUrl"[^>]*>/,
        `<meta id="ogUrl" property="og:url" content="${escapeHtmlAttr(seo.url)}">`
    );

    // OG title / description
    html = html.replace(
        /<meta id="ogTitle"[^>]*>/,
        `<meta id="ogTitle" property="og:title" content="${escapeHtmlAttr(seo.title)}">`
    );
    html = html.replace(
        /<meta id="ogDescription"[^>]*>/,
        `<meta id="ogDescription" property="og:description" content="${escapeHtmlAttr(seo.desc)}">`
    );

    // Twitter title / description
    html = html.replace(
        /<meta id="twTitle"[^>]*>/,
        `<meta id="twTitle" name="twitter:title" content="${escapeHtmlAttr(seo.title)}">`
    );
    html = html.replace(
        /<meta id="twDescription"[^>]*>/,
        `<meta id="twDescription" name="twitter:description" content="${escapeHtmlAttr(seo.desc)}">`
    );

    // JSON-LD: inject right before </head>
    html = html.replace(
        /<\/head>/,
        `    ${jsonLd}\n</head>`
    );

    // H1 (#headerTitle)
    html = html.replace(
        /<h1 id="headerTitle">[\s\S]*?<\/h1>/,
        `<h1 id="headerTitle">${escapeHtmlText(seo.h1)}</h1>`
    );

    // Body content: visible SEO blocks
    if (bodyBlocks) {
        if (bodyBlocks.seoDesc) {
            html = html.replace(
                /<div class="seo-description hidden" id="seoDescription"><\/div>/,
                `<div class="seo-description" id="seoDescription">${bodyBlocks.seoDesc}</div>`
            );
        }
        if (bodyBlocks.seoFaq) {
            html = html.replace(
                /<section class="seo-faq hidden" id="seoFaq"([^>]*)><\/section>/,
                `<section class="seo-faq" id="seoFaq"$1>${bodyBlocks.seoFaq}</section>`
            );
        }
        if (bodyBlocks.seoSummary) {
            html = html.replace(
                /<div class="seo-summary hidden" id="seoSummary"><\/div>/,
                `<div class="seo-summary" id="seoSummary">${bodyBlocks.seoSummary}</div>`
            );
        }
        // Class landing (#seoClassLanding) — visible content for /paladin, /warrior, etc.
        if (bodyBlocks.classLanding) {
            html = html.replace(
                /<div class="seo-landing hidden" id="seoClassLanding"><\/div>/,
                `<div class="seo-landing" id="seoClassLanding">${bodyBlocks.classLanding}</div>`
            );
        }
        // Spec landing (#seoSpecLanding) — visible content for /paladin/retribution, etc.
        if (bodyBlocks.specLanding) {
            html = html.replace(
                /<div class="seo-landing hidden" id="seoSpecLanding"><\/div>/,
                `<div class="seo-landing" id="seoSpecLanding">${bodyBlocks.specLanding}</div>`
            );
        }
        // Static BiS summary (#bisStaticSummary) — prerendered top BIS per slot.
        if (bodyBlocks.staticBis) {
            html = html.replace(
                /<div class="bis-static-summary hidden" id="bisStaticSummary"><\/div>/,
                `<div class="bis-static-summary" id="bisStaticSummary">${bodyBlocks.staticBis}</div>`
            );
        }
    }

    return html;
}

// ─── Main ────────────────────────────────────────────────────────────

function parseSitemap(sitemapPath) {
    const xml = fs.readFileSync(sitemapPath, 'utf8');
    const urls = [];
    const re = /<loc>([^<]+)<\/loc>/g;
    let m;
    while ((m = re.exec(xml))) {
        const u = m[1].trim();
        if (u.startsWith(BASE_URL)) {
            const p = u.slice(BASE_URL.length) || '/';
            urls.push(p);
        }
    }
    return urls;
}

/** Build a { [className]: [specName, ...] } map of specs that have PvP pages,
 *  sourced from sitemap.xml so we never link to a non-existent /cls/spec/pvp URL.
 *  Resolves slug pairs via SPEC_SLUG_MAP and PVP_SPEC_OVERRIDES (for PvP-only
 *  specs like Druid Feral Combat that aren't in CLASS_META). */
function loadPvpSpecsFromSitemap(sitemapPath) {
    const xml = fs.readFileSync(sitemapPath, 'utf8');
    const byClass = {};
    const re = /<loc>([^<]+)<\/loc>/g;
    let m;
    while ((m = re.exec(xml))) {
        const u = m[1].trim();
        if (!u.startsWith(BASE_URL)) continue;
        const p = u.slice(BASE_URL.length).replace(/^\//, '').replace(/\/$/, '');
        const parts = p.split('/');
        if (parts.length !== 3 || parts[2] !== 'pvp') continue;
        const key = `${parts[0]}-${parts[1]}`;
        const entry = SPEC_SLUG_MAP[key] || PVP_SPEC_OVERRIDES[key];
        if (!entry) continue;
        if (!byClass[entry.cls]) byClass[entry.cls] = [];
        if (!byClass[entry.cls].includes(entry.spec)) byClass[entry.cls].push(entry.spec);
    }
    return byClass;
}

function urlToOutputPath(urlPath) {
    if (urlPath === '/') return path.join(ROOT, 'index.html');
    const clean = urlPath.replace(/^\//, '').replace(/\/$/, '');
    return path.join(ROOT, clean, 'index.html');
}

/** Bump every <lastmod> in sitemap.xml / sitemap-index.xml to today's date. */
function updateSitemapDates() {
    const today = new Date().toISOString().slice(0, 10);   // YYYY-MM-DD
    for (const file of ['sitemap.xml', 'sitemap-index.xml']) {
        const p = path.join(ROOT, file);
        if (!fs.existsSync(p)) continue;
        const before = fs.readFileSync(p, 'utf8');
        const after  = before.replace(/<lastmod>[^<]*<\/lastmod>/g, `<lastmod>${today}</lastmod>`);
        if (after !== before) {
            fs.writeFileSync(p, after);
            console.log(`✓ Updated <lastmod> dates in ${file} → ${today}`);
        }
    }
}

function main() {
    const args = process.argv.slice(2);
    const onlyIdx = args.indexOf('--only');
    const dryRun  = args.includes('--dry-run');
    const only    = onlyIdx >= 0 ? args[onlyIdx + 1] : null;

    if (!only && !dryRun) updateSitemapDates();

    const template = fs.readFileSync(TEMPLATE, 'utf8');
    const sitemapPath = path.join(ROOT, 'sitemap.xml');
    const pvpSpecsByClass = loadPvpSpecsFromSitemap(sitemapPath);

    let urls;
    if (only) {
        urls = [only];
    } else {
        urls = parseSitemap(sitemapPath);
    }

    let written = 0, skipped = 0, failed = 0;

    for (const urlPath of urls) {
        if (urlPath === '/') {
            // Skip the home page — template already serves it correctly
            skipped++;
            continue;
        }

        const route = parseRoute(urlPath);
        if (!route) {
            console.warn(`✗ Unknown route: ${urlPath}`);
            failed++;
            continue;
        }

        const fullUrl = BASE_URL + urlPath;
        const seo = seoForRoute(route, fullUrl);
        if (!seo) {
            console.warn(`✗ No SEO data for: ${urlPath}`);
            failed++;
            continue;
        }

        const jsonLd = buildJsonLd(route, seo);
        // Phase pages get description+FAQ+summary; PvP pages get a PvP-specific
        // description and summary (no FAQ, since arena gear has fewer canonical Q&A);
        // class/spec landing pages get their dedicated landing blocks.
        // Prototype: static BiS only on the prototype URL while we verify UX.
        const enableStaticBis = STATIC_BIS_PROTOTYPE_URL === null || urlPath === STATIC_BIS_PROTOTYPE_URL;
        const bodyBlocks = {
            seoDesc:      buildSeoDescriptionBlock(route, seo) || buildPvpDescriptionBlock(route, seo),
            seoFaq:       buildSeoFaqBlock(route, seo) || buildPvpFaqBlock(route),
            seoSummary:   buildSeoSummaryBlock(route) || buildPvpSummaryBlock(route),
            classLanding: buildClassLandingBlock(route, pvpSpecsByClass),
            specLanding:  buildSpecLandingBlock(route),
            staticBis:    enableStaticBis
                ? (buildStaticBisBlock(route) || buildPvpDataSummaryBlock(route))
                : null,
        };
        const html = rewriteHtml(template, seo, jsonLd, bodyBlocks);
        const outPath = urlToOutputPath(urlPath);

        if (dryRun) {
            console.log(`(dry) ${urlPath}\n  title: ${seo.title}\n  → ${path.relative(ROOT, outPath)}`);
            continue;
        }

        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, html);
        console.log(`✓ ${urlPath} → ${path.relative(ROOT, outPath)}`);
        written++;
    }

    console.log(`\nDone. Written: ${written}  Skipped: ${skipped}  Failed: ${failed}`);
}

main();
