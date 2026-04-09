# TBC BiS Guide — Backlog

Prioritet: 🔴 Hög | 🟡 Medium | 🟢 Låg

---

# NUMMER 1 - MÅSTE SYNAS 2 ringar och 2 trinkets per specc som rekommendation, nu har vi bara en ring (med alts) och 1 trinket. SEN VILL JAG ATT VI BARA VISAR DEN VAPENTYP SOM ÄR REKOMMENDERAD PER SPEC, NÄR DET ÄR TYDLIGT. Exempelvis fury warrior har aldrig 2hander. Gäller både pve speccs och pvp speccs!

## ✅ Klart

### ~~3. Vissa epic items visas med blå (rare) färg~~ | # | Uppgift | Prioritet || 8 | ~~PvP BiS-data~~ → ersatt av #14 | 🟡 | ✅ Ersatt |
| 14 | ~~🏆 Weighted PvP BiS System~~ ([design](PVP-SYSTEM-DESIGN.md)) | 🔴 | ✅ Klart |
| 15 | GitHub Actions: auto-refresh + deploy PvP-data | 🟡 | 📋 Todo |
| 10 | ~~Profession Filter~~ | 🟡 | ✅ Klart |
| 11 | ~~Gem & Enchant-knappar + View Toggle~~ | 🟡 | ❌ Borttagen |
| 12 | "My Farm List" | 🟡 | 📋 Todo |
| 16 | ~~Item-kommentarer / Gearing-tips~~ | 🟡 | ✅ Klart |
| 17 | Meta gem fallback (saknade meta gems) | 🟡 | 📋 Todo |
| 7 | Kebab Warrior | 🟢 | ❓ Behöver spec |
| 9 | AdSense + disclaimer | 🟢 | 📋 Todo |

---

*Senast uppdaterad: 2026-04-05*---|---------|-----------|--------|
| 1 | ~~MH/2H build-separation~~ | 🔴 | ✅ Klart |
| 2 | ~~OH för dual-wielders~~ | 🔴 | ✅ Klart |
| 3 | ~~Fix blå/lila item-färger~~ | 🔴 | ✅ Klart |
| 13 | ~~Item-kvalitet epic/rare fortfarande fel~~ | 🔴 | ✅ Klart |
| 4 | ~~Tooltip på ikoner~~ | 🔴 | ✅ Klart |
| 14 | 🏆 Weighted PvP BiS System | 🔴 | ✅ Klart |
| 5 | ~~Fas-tabs i item-vyn~~ | 🟡 | ✅ Klart |
| 6 | Source-info inline + Wowhead-länk | 🟡 | 📋 Todo |
| 10 | ~~Profession Filter~~ | 🟡 | ✅ Klart |
| 11 | ~~Gem & Enchant-knappar + View Toggle~~ | 🟡 | ❌ Borttagen |
| 12 | "My Farm List" | 🟡 | 📋 Todo |
| 16 | ~~Item-kommentarer / Gearing-tips~~ | 🟡 | ✅ Klart |
| 17 | Meta gem fallback (saknade meta gems) | 🟡 | 📋 Todo |
| 7 | Kebab Warrior | 🟢 | ❓ Behöver spec |
| 9 | AdSense + disclaimer | 🟢 | 📋 Todo |

---

*Senast uppdaterad: 2026-04-05*26-04-04
- `qualityClass()` returnerar nu `q-epic` för alla BiS-items. Bara explicit "rare"/"uncommon" markeras blått.
- **⚠️ Fortfarande buggigt:** Vissa rare items visas felaktigt som epic (lila). T.ex. Beast Lord set-delar (blå/rare) visas som epic. Se bugg **#13** nedan.

### ~~4. Tooltip på item-ikoner (hover)~~ — FIXAT 2026-04-05
- Alla item-ikoner är nu wrappade i `<a>` med `data-wowhead` — hover visar full Wowhead tooltip.
- Hover-effekt: brightness + scale på ikonen.

### ~~1. Warriors MH + Two-Hand separation~~ — FIXAT 2026-04-05
- Dual-wield-specs (Arms, Fury, Rogue, Enh Shaman) visar nu separata sektioner: "⚔️ Dual-Wield" och "🗡️ Two-Handed" med tydliga headers.
- `Main Hand~Off Hand` items visas nu korrekt i **båda** MH och OH.
- Armour-slots renderas först, sedan vapen-sektioner, sedan Ranged/Relic sist.

### ~~2. Enhancement Shaman saknar OH-vapen~~ — FIXAT 2026-04-05
- Om en dual-wield spec har MH-data men ingen OH-data, klonas MH-listan automatiskt till OH med noten "Same options as Main Hand".
- Påverkar: Enhancement Shaman (alla faser), Arms Warrior P0.

---

## 🐛 Buggar

### 13. Item-kvalitet (epic/rare) visas fortfarande fel
- **Problem:** Fixet i #3 gick för långt — nu visas ALLA BiS-items som epic (lila), även items som faktiskt är rare (blåa). Exempel: **Beast Lord**-settet (Dungeon Set 3) är rare-kvalitet men renderas med lila epic-färg.
- **Orsak:** `qualityClass()` antar att alla BiS-items är epic. Den borde istället hämta faktisk item quality från data/Wowhead.
- **Lösning:** Slå upp korrekt item quality per item-ID (antingen från vår data, eller via Wowhead API/tooltip data) istället för att hårdkoda alla BiS-items som epic.
- **Prioritet:** 🔴 Hög — felaktiga färger är visuellt förvirrande.
- **Uppskattad tid:** 1-2 timmar

---

##  Funktioner & UX-förbättringar

### ~~5. Fas-tabs i item-vyn (snabbnavigering)~~ — FIXAT 2026-04-05
- Sticky fas-tab-bar visas nu direkt i BiS-vyn (under headern) med horisontell scroll.
- Aktiv fas markeras med guld-border. Klick byter fas direkt utan att gå tillbaka.
- Back-knappen i BiS-vyn hoppar nu direkt till spec-val (skippar fas-steget).
- Gömms automatiskt för PvP-specs (som inte har faser) och specs med bara en fas.
- Gems/enchant-panel stängs automatiskt vid fas-byte.

### 6. Bättre source-information ("Hur får jag detta item?")
- **Problem:** Source-info (drop location, crafting requirements etc.) syns bara i modalen, inte inline.
- **Alternativ:**
  - **A) Inline under item-namn:** Visa t.ex. "Drops from Gruul — Gruul's Lair" i grå text under itemnamnet. Kompakt men informativt.
  - **B) Wowhead-länk direkt:** En liten 🔗-ikon som öppnar Wowhead-sidan. Wowhead har ALL info (mats, quest chains, etc.).
  - **C) Hybrid:** Visa kort source inline + Wowhead-länk för detaljer.
- **Rekommendation:** Alternativ C (hybrid). För profession-items typ "LW 375" kan vi visa "Leatherworking 375 — [View on Wowhead →]" inline.
- **Uppskattad tid:** 2-3 timmar

### 7. Kebab Warrior (Arms PvP-variant?)
- **Problem:** Ingen "Kebab Warrior"-spec finns. Oklart exakt vad som menas.
- **Fråga till användare:** Är detta en specifik Arms PvP-build? En meme-build? Dual-wield Fury tanking? Behöver spec-definition och BiS-lista.
- **Lösning:** Om det är en känd community-build, lägg till som custom spec med manuellt kurerad BiS-lista.

### ~~10. Profession Filter~~ — FIXAT 2026-04-05
- **Problem:** Vissa BiS-items kräver specifika professions (t.ex. Stormherald för Blacksmithing, Ring enchants för Enchanting). Användare utan dessa professions ser items de inte kan använda.
- **Lösning:** Chip-baserad toggle under GearScore-panelen. Varje profession som förekommer i BiS-listan visas som en klickbar chip med yrkes-ikon. Aktiva = gröna, inaktiva = grå + genomstruken text. Inaktiverade professions filtreras bort från BiS-listan → näst bästa alternativet visas istället.
- **Sparas i localStorage** för persistens mellan sessioner.
- Döljs automatiskt i PvP-läge (PvP-gear är aldrig profession-gated).

### ~~11. Gem & Enchant-knappar + View Toggle~~ — BORTTAGEN 2026-04-05
- Fyra knappar (☰ List, ⊞ Grid, 💎 Gems, ✨ Enchants) har tagits bort.
- Gems & enchants visas redan inline på varje item (gem-ikoner) och i modalen.
- Grid-vyn användes aldrig. List-vy är nu den enda vyn.

### 12. "My Farm List" — personlig jakt-lista
- **Problem:** Användare vill kunna markera vilka items de fortfarande saknar och få en sammanfattning av var de ska farma.
- **Lösning:**
  - Lägg till en checkbox/stjärna på varje item: "Jag saknar detta".
  - Appen sammanställer en "Farm List"-vy som grupperar saknade items per källa/dungeon/raid: *"Du behöver köra dessa 3 dungeons för att bli färdig: Shattered Halls (2 items), Shadow Labyrinth (1 item), Gruul's Lair (1 item)"*.
  - Spara listan i `localStorage` så den finns kvar mellan sessioner.
- **Design:** En ny flik/knapp "📋 My Farm List" i navbaren. Listan visar dungeons/raids sorterade efter antal saknade items.
- **Uppskattad tid:** 4-6 timmar

---

## 🟡 Data & Innehåll

### 8. ~~Bättre PvP BiS-data~~ → Ersatt av **#14 — Weighted PvP BiS System**
- ~~**Problem:** PvP-listan är baserad på PvE-data med Gladiator-items injicerade manuellt. Saknas en riktig PvP BiS-källa.~~
- **Se ny design:** Detta har vuxit till ett eget stort system. Se **[PVP-SYSTEM-DESIGN.md](PVP-SYSTEM-DESIGN.md)**.

### 14. 🏆 Weighted PvP BiS System — Datadrivet PvP-gearing
- **Scope:** Stort feature — egen design-doc: **[PVP-SYSTEM-DESIGN.md](PVP-SYSTEM-DESIGN.md)**
- **Status:** ✅ **IMPLEMENTERAT 2026-04-05**
  - ✅ Steg 1: Scraper-pipeline (fetch-leaderboard.js, fetch-gear.js) — 20k spelare, 620 med full gear
  - ✅ Steg 2: Frekvensanalys (analyze-gear.js) — 21 specs, popularity tiers, PvE flex, rating gates
  - ✅ Steg 3: Frontend-integration — multi-spec PvP, popularity badges (🥇🥈🥉), PvE flex (⚔️), rating gates (🔒)
  - ✅ Steg 4: Auto-refresh script (scraper/refresh-pvp-data.sh) — kör veckovis via cron
- **Nyckeldesign:** PvP skippar fas-steget helt — visar "Live Snapshot" av vad toppspelare kör just nu
- **Nyckelfeatures:**
  - 📊 **Popularity-baserade rekommendationer** — items taggade med 🥇🥈🥉 baserat på hur många toppspelare som kör dem
  - 🔒 **Rating-gate** — visar vilka items som kräver högre rating
  - ⚔️ **PvE Flex-detektering** — identifierar vilka slots som toppspelare fyller med PvE-gear
  - � **Arena gems & enchants** — top-använda gems/enchants med usage %
  - 📡 **Auto-scraping** — `./scraper/refresh-pvp-data.sh` för veckovis uppdatering
  - 🚫 **Ingen fas-steg** — PvP-data är "live snapshot", inte fasuppdelad

### 15. GitHub Actions: Auto-refresh + deploy PvP-data
- **Problem:** PvP-datan behöver uppdateras veckovis för att vara relevant. Just nu krävs manuell körning av `./scraper/refresh-pvp-data.sh`.
- **Lösning:** GitHub Actions workflow (`.github/workflows/pvp-refresh.yml`) som:
  1. Kör scraper-pipelinen varje vecka (sondag natt)
  2. Bygger om `js/pvp-data.js` med senaste datan
  3. Deployer automatiskt till Firebase Hosting
- **Status:** 📋 Workflow-fil skapad, men behöver konfigureras med GitHub Secrets (`FIREBASE_SERVICE_ACCOUNT`)
- **Uppskattad tid:** 1-2 timmar (mest config/testning)

### ~~16. Item-kommentarer / Gearing-tips per item~~ — FIXAT 2026-04-05
- **Problem:** Alternativa items listas utan kontext. Användaren vet inte *varför* ett item är ett bra alternativ eller *när* det bör väljas framför BiS.
- **Lösning:** Separat `item-notes.json` med globala + spec-specifika noter. Laddas via `js/item-notes.js`. Visas inline under item-namnet med 💬-ikon och guldtonad border-left.
- **Implementation:**
  1. `item-notes.json` — global notes (44 items) + spec-specifika overrides (17 notes, 11 specs)
  2. `js/item-notes.js` — synkron XHR-laddare med `ITEM_NOTES.get(itemId, specKey)` API
  3. `getNote(itemId)` helper i app.js — renderar `<div class="item-note">` med 💬-ikon
  4. Visas på både BIS-items och alt-items i `renderSlotGroup()`
  5. Spec-specifika noter (t.ex. "Beast Lord 2-set" för Hunter) prioriteras över globala
- **Stil:** Kursiv, liten text, guldtonad bakgrund + border-left. Smälter in utan att ta fokus.
- **Omfattning:** 61 noter seed:ade. Lätt att utöka — redigera bara `item-notes.json`.

---


### 17. Meta gem fallback — saknade meta gems
- **Problem:** 80 av 150 spec/phases saknar meta gem i Lua-datan. Items med meta-socket visar då en tom socket-position.
- **Lösning:** Om en phase saknar meta gem, ärv från närmaste phase (först tidigare, sedan senare) som HAR meta gem för samma spec. T.ex. Druid Balance P1 saknar meta → ärv från P0 (Chaotic Skyfire Diamond).
- **Implementation:**
  1. I `renderBisList()`, om `metaGem` är null, sök i intilliggande phases
  2. Alternativt: fixa i `parse-lua-data.js` så meta gem alltid ärvs vid dataparsning
  3. Variant B är renare (fixar i datan istället för i renderingen)
- **Prioritet:** 🟡 Medium
- **Uppskattad tid:** 30–60 minuter
---


---

## 🟢 Monetarisering & Juridik

### 9. Annonser & upphovsrätt
- **Fråga:** Kan sidan tjäna pengar via Google AdSense?
- **Svar — sammanfattning:**

#### ✅ Vad vi KAN göra:
- Visa **Google AdSense-annonser** på sidan — ja, det är tillåtet.
- Länka till Wowhead (de uppmuntrar det, det driver trafik till dem).
- Hotlinka ikoner från Wowheads CDN (wow.zamimg.com) — de tillåter det via sitt tooltip-API.
- Visa item-namn, stats, och BiS-rekommendationer — detta är **community-skapat innehåll** (guider/opinions), inte Blizzards rådata.

#### ⚠️ Gråzoner:
- **Blizzard IP:** WoW item-namn, ikoner och speldata ägs av Blizzard Entertainment. Blizzard tillåter fan sites under deras [Fan Content Policy](https://www.blizzard.com/en-us/legal/fancontentpolicy) MEN med begränsningar.
- Fan Content Policy kräver: (1) icke-kommersiellt ELLER att Blizzard-innehåll inte är den primära dragningskraften, (2) tydlig disclaimer att det inte är associerat med Blizzard.
- **Wowhead-data:** Vi använder deras tooltip-API och ikon-CDN. Deras ToS tillåter detta för fan sites men inte för direkt kommersiell konkurrens.

#### 📋 Rekommendation:
1. Lägg till en **disclaimer** i footer: *"This site is not affiliated with Blizzard Entertainment. World of Warcraft and all related assets are trademarks of Blizzard Entertainment, Inc."*
2. Håll **annonserna diskreta** (1-2 ad slots, inte dominerande).
3. AdSense-intäkter på en nischsajt som denna = realistiskt **$5-50/mån** beroende på trafik.
4. Överväg **affiliate-länkar** till WoW-relaterade produkter som alternativ/komplement.
5. Var beredd på att Blizzard KAN skicka en takedown — men det är extremt ovanligt för fan sites som inte säljer något direkt.

---

## Prioritetsordning (rekommendation)

| # | Uppgift | Prioritet | Status |
|---|---------|-----------|--------|
| 1 | ~~MH/2H build-separation~~ | 🔴 | ✅ Klart |
| 2 | ~~OH för dual-wielders~~ | 🔴 | ✅ Klart |
| 3 | ~~Fix blå/lila item-färger~~ | 🔴 | ✅ Klart |
| 13 | ~~Item-kvalitet epic/rare fortfarande fel~~ | 🔴 | ✅ Klart |
| 4 | ~~Tooltip på ikoner~~ | 🔴 | ✅ Klart |
| 5 | ~~Fas-tabs i item-vyn~~ | 🟡 | ✅ Klart |
| 6 | Source-info inline + Wowhead-länk | 🟡 | 📋 Todo |
| 8 | ~~PvP BiS-data~~ → ersatt av #14 | 🟡 | ✅ Ersatt |
| 14 | ~~🏆 Weighted PvP BiS System~~ ([design](PVP-SYSTEM-DESIGN.md)) | 🔴 | ✅ Klart |
| 15 | GitHub Actions: auto-refresh + deploy PvP-data | 🟡 | 📋 Todo |
| 10 | ~~Profession Filter~~ | 🟡 | ✅ Klart |
| 11 | ~~Gem & Enchant-knappar + View Toggle~~ | 🟡 | ❌ Borttagen |
| 12 | "My Farm List" | 🟡 | 📋 Todo |
| 16 | ~~Item-kommentarer / Gearing-tips~~ | 🟡 | ✅ Klart |
| 17 | Meta gem fallback (saknade meta gems) | 🟡 | 📋 Todo |
| 7 | Kebab Warrior | 🟢 | ❓ Behöver spec |
| 9 | AdSense + disclaimer | 🟢 | 📋 Todo |

---

*Senast uppdaterad: 2026-04-05*
