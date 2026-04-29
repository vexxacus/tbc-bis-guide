# TBC BiS Guide — Backlog# TBC BiS Guide — Backlog



Prioritet: 🔴 Hög | 🟡 Medium | 🟢 Låg | ✅ KlarPrioritet: 🔴 Hög | 🟡 Medium | 🟢 Låg



------



## 🔴 Buggar & Fixar

| 1 | GitHub Actions: auto-refresh + deploy PvP-data | 🟡 | 📋 Failar varje gång på grund av autehtication |

| # | Uppgift | Prio | Status |

|---|---------|------|--------|

 🔴 | 📋 Todo || 2 | Thalassian Cloak — säger Kael men notes säger Mag | 🟡 | 📋 Todo |

 🔴 | 📋 Todo || 3 | Visa ranged hit för Hunters istället för melee hit | 🟡 | 📋 Todo |

 Måste gå igenom gems igen. Exempelvis visas spell haste gems för shamaner i p1 / p2, men de finns inte i den fasen. Tror jag inte. VIll dubbelkolla

| 3 | 2H-alternatives saknar mouseover tooltip (t.ex. MM Hunter) — borde gå att hovra även på non-BIS | 🔴 | 📋 Todo || 4 | Desktop layout — smalare/kortare sidor | 🟢 | 📋 Todo |

| 4 | Totem/Libram/Idol visas som "Ranged" — borde heta Relic eller liknande | 🟡 | 📋 Todo |Kan vi ha en tabb med highest simulated dps eller liknande per specc? Ta från WCL API?

| 5 | Neck kategoriseras som "Armor" — borde vara Jewelry/Accessories | 🟡 | 📋 Todo |Totem och librams står some range - kan vi ändra så det står rätt?

COMMUNITY-DRIVEN BACKLOGG? LÄMNA FEEDBACK?

KAN VI HÄMTA GEMS FRÅN WOWTBC.GG ISTÄLLET?!

| 6 | Thalassian Cloak — säger Kael men item-notes säger Mag | 🟡 | 📋 Todo |2h alternatives har ingen mouseover tooltip på exempelvis MM hunters. Borde ju kunna hoovra även om det inte är bis

Kan vi lägga in hela wowhead-item-lista som alternativ per specc och fas? WCL är alltid BIS, men items som inte används av parsers kan vara "ALT" eller liknande. Vad tror du?

---Alla summeringar om speccarna är fel nu när vi ändrat items.

Om man tar bort professions så ska vi inte dölja items som skapas av professions, men inte kräver profession för att använda. Exempelvis Wolfshead helm

## 🟡 UI & LayoutSka vi sätta widget "professions & pvp" precis under beskrivningen av specc / fas? Vad tycker du?

WCL top meta parses - kan vi där länka till speccen för den zonen?

| # | Uppgift | Prio | Status |Sim-disclaimer kaske räcker att ha som en (i) mousover jämte knappen? Så att den inte tar så mkt plats

|---|---------|------|--------|Neck borde vara listat under jewelry istället för armor

| 7 | Flytta "Professions & PvP"-widget precis under spec/fas-beskrivningen | 🟡 | 📋 Todo |Accessories kanske man ska döpa om jewelry till?

| 8 | Sim-disclaimer: gör till en (i)-ikon med mouseover istället för stor textblock | 🟡 | 📋 Todo || 9 | AdSense + disclaimer | 🟢 | 📋 Todo |

| 9 | Desktop layout — smalare/kortare sidor | 🟢 | 📋 Todo |P0.

| 10 | Döp om "Jewelry" till "Accessories" (eller tvärtom — välj ett konsekvent namn) | 🟢 | 📋 Todo |

---

---### 6. Bättre source-information ("Hur får jag detta item?")

- **Problem:** Source-info (drop location, crafting requirements etc.) syns bara i modalen, inte inline.

## 🟡 Nya Features- **Alternativ:**

  - **A) Inline under item-namn:** Visa t.ex. "Drops from Gruul — Gruul's Lair" i grå text under itemnamnet. Kompakt men informativt.

| # | Uppgift | Prio | Status |  - **B) Wowhead-länk direkt:** En liten 🔗-ikon som öppnar Wowhead-sidan. Wowhead har ALL info (mats, quest chains, etc.).

|---|---------|------|--------|  - **C) Hybrid:** Visa kort source inline + Wowhead-länk för detaljer.

| 11 | Visa ranged hit för Hunters istället för melee hit i stats-panelen | 🟡 | 📋 Todo |- **Rekommendation:** Alternativ C (hybrid). För profession-items typ "LW 375" kan vi visa "Leatherworking 375 — [View on Wowhead →]" inline.

| 12 | Tabb med "Highest Simulated DPS" per spec — hämta från WCL API | 🟡 | 📋 Todo |- **Uppskattad tid:** 2-3 timmar

| 13 | WCL top meta — länka till specens WCL-sida för den zonen | 🟡 | 📋 Todo |

| 14 | Hela Wowhead-itemlistan som alternativ per spec/fas — WCL = BIS, övriga = "Alt" | 🟢 | 📋 Todo |

| 15 | P0 Pre-BiS: uppdatera med WCL-data eller behåll manuellt? | 🟢 | 📋 Todo |



---



## 🟢 Bättre Source-information---



**Problem:** Source-info (drop location, crafting requirements) syns bara i modalen, inte inline.## 🟢 Monetarisering & Juridik



**Alternativ:**### 9. Annonser & upphovsrätt

- **A) Inline under itemnamn:** Visa t.ex. "Drops from Gruul — Gruul's Lair" i grå text. Kompakt men informativt.- **Fråga:** Kan sidan tjäna pengar via Google AdSense?

- **B) Wowhead-länk direkt:** En 🔗-ikon som öppnar Wowhead-sidan.- **Svar — sammanfattning:**

- **C) Hybrid:** Kort source inline + Wowhead-länk för detaljer.

#### ✅ Vad vi KAN göra:

**Rekommendation:** Alternativ C. För profession-items: "LW 375 — [View on Wowhead →]"- Visa **Google AdSense-annonser** på sidan — ja, det är tillåtet.

- Länka till Wowhead (de uppmuntrar det, det driver trafik till dem).

---- Hotlinka ikoner från Wowheads CDN (wow.zamimg.com) — de tillåter det via sitt tooltip-API.

- Visa item-namn, stats, och BiS-rekommendationer — detta är **community-skapat innehåll** (guider/opinions), inte Blizzards rådata.

## 🟢 Infra & CI/CD

#### ⚠️ Gråzoner:

| # | Uppgift | Prio | Status |- **Blizzard IP:** WoW item-namn, ikoner och speldata ägs av Blizzard Entertainment. Blizzard tillåter fan sites under deras [Fan Content Policy](https://www.blizzard.com/en-us/legal/fancontentpolicy) MEN med begränsningar.

|---|---------|------|--------|- Fan Content Policy kräver: (1) icke-kommersiellt ELLER att Blizzard-innehåll inte är den primära dragningskraften, (2) tydlig disclaimer att det inte är associerat med Blizzard.

| 16 | GitHub Actions: auto-refresh + deploy PvP-data — failar p.g.a. authentication | 🟡 | 📋 Todo |- **Wowhead-data:** Vi använder deras tooltip-API och ikon-CDN. Deras ToS tillåter detta för fan sites men inte för direkt kommersiell konkurrens.



---#### 📋 Rekommendation:

1. Lägg till en **disclaimer** i footer: *"This site is not affiliated with Blizzard Entertainment. World of Warcraft and all related assets are trademarks of Blizzard Entertainment, Inc."*

## 🟢 Monetarisering & Juridik2. Håll **annonserna diskreta** (1-2 ad slots, inte dominerande).

3. AdSense-intäkter på en nischsajt som denna = realistiskt **$5-50/mån** beroende på trafik.

### AdSense & Upphovsrätt4. Överväg **affiliate-länkar** till WoW-relaterade produkter som alternativ/komplement.

5. Var beredd på att Blizzard KAN skicka en takedown — men det är extremt ovanligt för fan sites som inte säljer något direkt.

**✅ Vad vi KAN göra:**

- Google AdSense-annonser — tillåtet---
- Länka till Wowhead (de uppmuntrar det)
- Hotlinka ikoner från Wowheads CDN (wow.zamimg.com) via tooltip-API
- Visa itemnamn, stats, BiS-rekommendationer — community-skapat innehåll

**⚠️ Gråzoner:**
- **Blizzard IP:** WoW-data ägs av Blizzard. Fan sites tillåts under [Fan Content Policy](https://www.blizzard.com/en-us/legal/fancontentpolicy) med begränsningar: icke-kommersiellt ELLER att Blizzard-innehåll inte är primär dragningskraft + tydlig disclaimer.
- **Wowhead-data:** Tooltip-API och ikon-CDN tillåts för fan sites men inte kommersiell konkurrens.

**📋 Att göra:**
1. Footer-disclaimer: *"Not affiliated with Blizzard Entertainment. World of Warcraft® is a trademark of Blizzard Entertainment, Inc."*
2. Diskreta annonser (1–2 ad slots)
3. Realistisk intäkt: **$5–50/mån** beroende på trafik
4. Överväg affiliate-länkar som komplement
