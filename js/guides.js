/*
 * Shared guide-page content — the single source of truth for both the client
 * (js/app.js STATIC_PAGES) and the prerenderer (prerender.js), so the visible
 * page and the crawled HTML can never drift apart.
 *
 * Works in the browser (sets window.GUIDES) and in Node (module.exports).
 * Each guide: { title, description, bodyHtml }.
 *
 * To add a guide: add an entry here, add its slug to STATIC_SLUGS in
 * prerender.js, and add a <url> to sitemap.xml.
 */
(function (root) {
    const GUIDES = {
        gems: {
            title: 'TBC Classic Gems Guide — Meta Gems, Socket Colors & Best Gems by Stat',
            description: 'How sockets and meta gems work in TBC Classic, meta gem activation requirements, and the best red, yellow, and blue gems by stat (cut) for every role.',
            bodyHtml: `
                <h1>TBC Classic Gems Guide</h1>
                <p>Gems let you customize gear in <strong>World of Warcraft: The Burning Crusade Classic</strong> by slotting them into item sockets. This guide covers how sockets and meta gems work, how to read gem <strong>cuts</strong> and colors, and which gems to use — with the exact per-spec setup linked at the bottom.</p>

                <h2>How sockets work</h2>
                <ul>
                    <li><strong>Socket colors</strong> — sockets are <span class="gem-red">Red</span>, <span class="gem-yellow">Yellow</span>, or <span class="gem-blue">Blue</span>. A gem gives its full stats in <em>any</em> socket, regardless of color.</li>
                    <li><strong>Socket bonus</strong> — items grant a small bonus (e.g. +4 stamina) only if you match each socket's color. Chase it only when the bonus beats gemming purely for your best stat.</li>
                    <li><strong>Hybrid gems</strong> match two colors: <span class="gem-orange">Orange</span> = Red + Yellow, <span class="gem-purple">Purple</span> = Red + Blue, <span class="gem-green">Green</span> = Yellow + Blue.</li>
                </ul>

                <h2>Meta gems</h2>
                <p>Each gear set has one <strong>meta socket</strong> (usually the helm) that only accepts a meta gem. Meta gems have an <strong>activation requirement</strong> counting how many Red, Yellow, and Blue gems you have equipped — <em>every</em> gem of that color counts whether or not it matches its socket, and a hybrid gem counts for <em>both</em> its colors (an Orange gem = 1 Red + 1 Yellow toward the requirement).</p>
                <p>The most-used DPS meta gem is the <a href="https://www.wowhead.com/tbc/item=34220" data-wowhead="item=34220&domain=tbc" rel="external" target="_blank">Chaotic Skyfire Diamond</a> — <strong>+12 critical strike rating and +3% critical strike damage</strong> — which requires <strong>at least 2 Blue gems</strong> equipped. Tanks, healers, and mana-based casters use different meta gems; see the <a href="https://www.wowhead.com/tbc/guide/meta-gems-requirements-effects-jewelcrafting-burning-crusade-classic" rel="external" target="_blank">full meta gem list on Wowhead</a>.</p>

                <h2>Browse every TBC gem</h2>
                <p>Every gem in the game below — <strong>filter by quality, color, or stat</strong>, or switch to <strong>Top-used by spec</strong> to see what the best players actually socket (from our WarcraftLogs data). Hover any gem for its Wowhead tooltip.</p>
                <div class="gem-browser" id="gemBrowser">
                    <div class="gem-filters" id="gemFilters"></div>
                    <div class="gem-grid" id="gemGrid"></div>
                </div>

                <h2>The right gems for your spec</h2>
                <p>The best gems depend on your spec, phase, and which caps you still need (hit, etc.). Our per-spec Best in Slot pages list the recommended gems for each phase, based on what top-parsing players actually use:</p>
                <ul class="guide-links">
                    <li><a href="/warrior">Warrior</a> · <a href="/paladin">Paladin</a> · <a href="/hunter">Hunter</a> · <a href="/rogue">Rogue</a> · <a href="/priest">Priest</a></li>
                    <li><a href="/shaman">Shaman</a> · <a href="/mage">Mage</a> · <a href="/warlock">Warlock</a> · <a href="/druid">Druid</a></li>
                </ul>
                <p>See also our <a href="/enchants">TBC enchants guide</a>.</p>
            `
        },
        enchants: {
            title: 'TBC Classic Enchants Guide — Best Enchants by Slot for Every Role',
            description: 'Which gear slots can be enchanted in TBC Classic, where head and shoulder enchants come from, leg armors vs spellthread, and the best enchant choices by slot for physical DPS, casters, healers, and tanks.',
            bodyHtml: `
                <h1>TBC Classic Enchants Guide</h1>
                <p>Enchants are permanent stat upgrades applied to gear in <strong>The Burning Crusade Classic</strong>. This guide covers which slots can be enchanted, where head and shoulder enchants actually come from, and the common best enchant for each slot by role — with the exact per-spec choices linked at the bottom.</p>

                <h2>Which slots can be enchanted</h2>
                <p>You can enchant: <strong>head, shoulders, back, chest, wrist, hands, legs, feet, weapon, two-handed weapon, shield,</strong> and <strong>rings</strong> (ring enchants can only be applied by an Enchanter to their own rings). Hunters add a <strong>scope</strong> to ranged weapons. You <em>cannot</em> enchant neck, trinkets, off-hand held items, wands, thrown weapons, or relics.</p>

                <h2>Head &amp; shoulders come from reputation</h2>
                <p>These two are <strong>not</strong> from the Enchanting profession:</p>
                <ul>
                    <li><strong>Head</strong> — an <em>Arcanum</em> bought from various reputation vendors (the best ones usually at Revered/Exalted).</li>
                    <li><strong>Shoulders</strong> — an <em>inscription</em> from your chosen faction, <strong>Aldor</strong> or <strong>Scryers</strong>; the <em>Greater</em> versions unlock at Exalted.</li>
                </ul>

                <h2>Legs: leg armor vs spellthread</h2>
                <p>The leg slot uses a crafted item rather than a profession-locked enchant — anyone can apply them:</p>
                <ul>
                    <li><strong>Physical DPS / tanks</strong> — leg armor (<a href="https://www.wowhead.com/tbc/spell=35490" data-wowhead="spell=35490&domain=tbc" rel="external" target="_blank">Nethercobra Leg Armor</a> for DPS, <a href="https://www.wowhead.com/tbc/spell=35495" data-wowhead="spell=35495&domain=tbc" rel="external" target="_blank">Nethercleft Leg Armor</a> for tanks), from Leatherworking.</li>
                    <li><strong>Casters / healers</strong> — spellthread (<a href="https://www.wowhead.com/tbc/spell=31370" data-wowhead="spell=31370&domain=tbc" rel="external" target="_blank">Golden Spellthread</a>, or <a href="https://www.wowhead.com/tbc/spell=31372" data-wowhead="spell=31372&domain=tbc" rel="external" target="_blank">Runic Spellthread</a> at level 70), from Tailoring.</li>
                </ul>

                <h2>Browse every enchant</h2>
                <p>Every recommended TBC enchant below — <strong>filter by slot or stat</strong>, or switch to <strong>Recommended by spec</strong> to see the suggested enchant for each slot, for any class and spec. Hover any enchant for its Wowhead tooltip.</p>
                <div class="gem-browser" id="enchBrowser">
                    <div class="gem-filters" id="enchFilters"></div>
                    <div class="gem-grid" id="enchGrid"></div>
                </div>

                <h2>The right enchants for your spec</h2>
                <p>Our per-spec Best in Slot pages list the recommended enchant for every slot, by phase:</p>
                <ul class="guide-links">
                    <li><a href="/warrior">Warrior</a> · <a href="/paladin">Paladin</a> · <a href="/hunter">Hunter</a> · <a href="/rogue">Rogue</a> · <a href="/priest">Priest</a></li>
                    <li><a href="/shaman">Shaman</a> · <a href="/mage">Mage</a> · <a href="/warlock">Warlock</a> · <a href="/druid">Druid</a></li>
                </ul>
                <p>See also our <a href="/gems">TBC gems guide</a>.</p>
            `
        },
        attunements: {
            title: 'TBC Classic Attunement Guide — Raid & Heroic Dungeon Keys by Phase',
            description: 'Every TBC Classic raid and heroic attunement, ordered by phase: heroic dungeon keys, Karazhan, Serpentshrine Cavern, Tempest Keep, Mount Hyjal, and Black Temple — what each one requires.',
            bodyHtml: `
                <h1>TBC Classic Attunement Guide</h1>
                <p>Many raids and all heroic dungeons in <strong>The Burning Crusade Classic</strong> require an <strong>attunement</strong> — a quest chain or key you complete before you can enter. This guide lists what each one needs, ordered by raid phase.</p>

                <h2>Heroic dungeon keys</h2>
                <p>Each dungeon hub has a faction. Reach <strong>Revered</strong> with that faction and buy the heroic key from its Quartermaster. Heroic keys are a prerequisite for several raid attunements, so work on reputation early.</p>

                <h2>Phase 1 — Karazhan, Gruul's Lair, Magtheridon</h2>
                <ul>
                    <li><strong>Karazhan</strong> — requires <em>The Master's Key</em>, a long quest chain that sends you through several dungeons (including Black Morass). Everyone in the raid needs it.</li>
                    <li><strong>Gruul's Lair</strong> and <strong>Magtheridon's Lair</strong> — no attunement; just level 70.</li>
                </ul>

                <h2>Phase 2 — Serpentshrine Cavern &amp; Tempest Keep</h2>
                <ul>
                    <li><strong>Serpentshrine Cavern (SSC)</strong> — requires the Karazhan attunement and a Coilfang Reservoir quest chain (including heroic clears).</li>
                    <li><strong>Tempest Keep: The Eye (TK)</strong> — the <em>Trial of the Naaru</em> chain, which requires heroic keys and the lengthy <em>Cipher of Damnation</em> questline in Shadowmoon Valley first.</li>
                </ul>
                <p>Note: Blizzard removed the SSC and TK attunements in the original patch 2.4, so depending on the current phase these may no longer be required.</p>

                <h2>Phase 3 — Mount Hyjal &amp; Black Temple</h2>
                <ul>
                    <li><strong>Mount Hyjal</strong> — <em>The Vials of Eternity</em>: defeat <strong>Lady Vashj</strong> (SSC) and <strong>Kael'thas</strong> (TK) to obtain their vials.</li>
                    <li><strong>Black Temple</strong> — the longest chain: all heroic keys, Karazhan, Trial of the Naaru, SSC + TK, Hyjal, then the Black Temple chain (<em>A Distraction for Akama</em> / Medallion of Karabor).</li>
                </ul>

                <p>Full step-by-step walkthroughs are on the <a href="https://www.wowhead.com/tbc/guide/attunement-dungeons-raids-burning-crusade-classic" rel="external" target="_blank">Wowhead attunement guide</a>. Once you're raiding, grab your phase's gear:</p>
                <ul class="guide-links">
                    <li>Best in Slot by phase: <a href="/warrior">Warrior</a> · <a href="/mage">Mage</a> · <a href="/paladin">Paladin</a> · <a href="/priest">Priest</a> · <a href="/hunter">Hunter</a> · <a href="/rogue">Rogue</a> · <a href="/shaman">Shaman</a> · <a href="/warlock">Warlock</a> · <a href="/druid">Druid</a></li>
                </ul>
            `
        },
        'stat-priority': {
            title: 'TBC Classic Stat Priority — Caps & Stat Weights by Role',
            description: 'How stat priority works in TBC Classic: the key caps (hit, expertise, defense), why caps come first, and the general stat priority for physical DPS, casters, healers, and tanks — with per-spec lists linked.',
            bodyHtml: `
                <h1>TBC Classic Stat Priority</h1>
                <p>Stat priority tells you which stats to stack — and which <strong>caps</strong> to hit first — when choosing gear, gems, and enchants in <strong>The Burning Crusade Classic</strong>. The exact order varies by spec and phase, but the principles below apply to every class.</p>

                <h2>Caps come first</h2>
                <p>A few stats stop helping once you reach a threshold; reaching these <em>caps</em> usually beats raw throughput stats:</p>
                <ul>
                    <li><strong>Hit cap</strong> — enough Hit rating so your attacks/spells never miss the boss. Below the cap, Hit is often your most valuable stat; above it, Hit is worthless. (Casters and melee have different caps, and some talents lower them.)</li>
                    <li><strong>Expertise</strong> (melee) — reduces the chance for the boss to dodge/parry your attacks; valuable until your attacks can no longer be dodged.</li>
                    <li><strong>Defense / uncrittable</strong> (tanks) — enough Defense (plus resilience) so raid bosses can't land critical hits on you. This is the #1 tank priority before stacking effective health or avoidance.</li>
                </ul>

                <h2>General priority by role</h2>
                <table class="guide-table">
                    <thead><tr><th>Role</th><th>Typical priority</th></tr></thead>
                    <tbody>
                        <tr><td>Physical DPS</td><td>Hit (to cap) → Expertise (to cap) → primary stat (Strength/Agility) &amp; Attack Power → Crit → Haste</td></tr>
                        <tr><td>Caster DPS</td><td>Hit (to cap) → Spell Damage / Spell Power → Crit → Haste (spec-dependent)</td></tr>
                        <tr><td>Healer</td><td>Healing / Spell Power → Crit and/or Mana per 5 → Intellect / Spirit (spec-dependent)</td></tr>
                        <tr><td>Tank</td><td>Defense (uncrittable) → Stamina → Avoidance (Dodge/Parry) → Threat (Hit, Expertise, AP)</td></tr>
                    </tbody>
                </table>
                <p>These are starting points — set bonuses, talents, and fight needs shift the order. For exact stat weights and caps, see detailed class guides on <a href="https://www.wowhead.com/tbc/guides" rel="external" target="_blank">Wowhead</a>.</p>

                <h2>Your spec's gear, gems &amp; enchants</h2>
                <p>Our Best in Slot pages already apply each spec's stat priority to the recommended gear, gems, and enchants per phase — and the built-in stat tool shows your totals:</p>
                <ul class="guide-links">
                    <li><a href="/warrior">Warrior</a> · <a href="/paladin">Paladin</a> · <a href="/hunter">Hunter</a> · <a href="/rogue">Rogue</a> · <a href="/priest">Priest</a></li>
                    <li><a href="/shaman">Shaman</a> · <a href="/mage">Mage</a> · <a href="/warlock">Warlock</a> · <a href="/druid">Druid</a></li>
                </ul>
                <p>See also: <a href="/gems">gems guide</a> · <a href="/enchants">enchants guide</a>.</p>
            `
        }
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = GUIDES;
    else root.GUIDES = GUIDES;
})(typeof self !== 'undefined' ? self : this);
