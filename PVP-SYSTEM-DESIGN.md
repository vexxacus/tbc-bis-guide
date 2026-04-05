# PvP BiS System — Teknisk Design

> "Weighted BiS" — datadriven PvP-gearing baserad på vad toppspelare faktiskt kör.

**Status:** 📋 Design-fas
**Prioritet:** 🔴 Hög
**Uppskattad tid:** 20-40 timmar (inkl. scraping, algoritm, UI)
**Senast uppdaterad:** 2026-04-04

---

## Översikt

Istället för manuellt kurerade PvP BiS-listor bygger vi ett **datadrivet system** som:

1. **Scrapar** vad toppspelare faktiskt har på sig (Ironforge.pro + SixtyUpgrades).
2. **Analyserar** popularitet per item med frekvensanalys.
3. **Viktar** rekommendationer baserat på rating-bracket, resilience-mål och spelstil.

---

## 1. Data Ingestion (Scraping-lagret)

Två separata scrapers som ger olika typer av "truth":

### 1a. SixtyUpgrades Scraper — "Static Truth"

| | |
|---|---|
| **Mål** | Hämta Item-IDs för specifika fasers BiS-listor |
| **Teknik** | Puppeteer / Playwright — ladda publika listor, extrahera JSON från interna state (`inventory`-objektet) |
| **Output** | Baseline BiS-lista per spec/fas: *"Detta anses vara BiS Phase 1"* |
| **Frekvens** | Kör vid fas-byte (manuell trigger) |

### 1b. Ironforge.pro Scraper — "Dynamic Truth"

| | |
|---|---|
| **Mål** | Hämta utrustning för Top 50–100 karaktärer per spec/bracket |
| **Teknik** | Scrapa leaderboard → följ länkar till Armory/profiler → extrahera equipped items |
| **Brackets** | 2v2, 3v3 (separat data per bracket) |
| **Output** | Lista med 100 karaktärers fulla gear för t.ex. "Resto Druid 3v3" |
| **Frekvens** | Daglig/veckovis cron-körning på server |

### ⚠️ Scraping-risker

- Ironforge.pro kan blockera botar → använd rate limiting, randomiserade delays, roterande user agents.
- Data kan vara inkonsekvent (spelare loggar ut i PvE-gear etc.) → filtrera outliers.
- **Kör ALDRIG scraping från klienten** — alltid server-side.

---

## 2. Normalisering & ID-Mapping

All data måste ner på **Item-ID-nivå** för att kunna jämföras.

```
Scrapad data  →  Item-ID  →  Lokal AtlasLoot .lua-databas (SSOT)
                                ↓
                          Stats: Resilience, Stamina, etc.
                          Quality: epic/rare
                          Source: PvP vendor / crafted / drop
```

- Använd vår befintliga `.lua`-databas (AtlasLoot) som **Single Source of Truth** för item metadata.
- Varje scrapat item mappas mot lokalt ID → berikas med stats (Resilience, Stamina, spell power etc.).
- Items som inte finns i vår DB flaggas för manuell review.

---

## 3. "The Weighted BiS Algorithm"

Hjärnan i systemet. Istället för en statisk lista kör vi **frekvensanalys** på vad toppspelare använder.

### Kärn-formel

$$P(\text{item}) = \frac{\text{Antal förekomster i Top } N}{\text{Totalt antal spelare i dataset}}$$

### Logik-steg

#### Steg 1: Frekvenskontroll

| Popularity | Tagg | Beskrivning |
|---|---|---|
| ≥ 70% | 🥇 **Gold Standard** | De facto BiS — nästan alla kör detta |
| 40–69% | 🥈 **Strong Pick** | Populärt val, solitt alternativ |
| 15–39% | 🥉 **Viable** | Fungerar, men inte consensus |
| 5–14% | ⚪ **Niche** | Situationellt / specifika comps |
| < 5% | ❌ **Outlier** | Ignoreras (threshold-filter) |

#### Steg 2: Rating-Gate

Identifiera vid vilken rating-bracket items dyker upp:

```
Om Merciless Gladiator's Shoulders bara syns hos spelare med 2000+ rating:
  → Tagga: min_rating: 2000
  → UI visar: "🔒 Requires 2000+ rating"
```

Rating-breakpoints: `1500`, `1700`, `1850`, `2000`, `2200`

#### Steg 3: Hybrid-detektering

Analysera "Off-slots" — vilka slots byts oftast mot PvE-gear:

```
Om medel-Resilience = 350 och 4/5 PvP-set:
  → Identifiera vilka slots (Ring, Cloak, Trinket) som oftast är PvE-items
  → Tagga dessa som "PvE Flex Slot"
```

### Outlier-hantering

- **Threshold:** Items med < 5% usage → exkluderas automatiskt.
- **Reasoning:** Vissa toppspelare experimenterar eller saknar BiS. Brus ska inte skräpa ner listan.

---

## 4. Databas-schema

Färdigbehandlad data lagras i JSON (eller eventuellt SQLite framöver).

### Items-tabell

| Fält | Typ | Beskrivning |
|---|---|---|
| `itemId` | number | Wowhead/AtlasLoot Item-ID |
| `class` | string | `"Warrior"`, `"Druid"`, etc. |
| `spec` | string | `"Arms"`, `"Resto"`, etc. |
| `slot` | string | `"Weapon"`, `"Shoulder"`, `"Trinket"`, etc. |
| `popularity` | number | 0–100 (% av toppspelare som använder) |
| `avgRating` | string | `"1500+"`, `"2000+"`, etc. |
| `phase` | number | 1–5 |
| `bracket` | string | `"2v2"`, `"3v3"`, `"all"` |
| `isPvEFlex` | boolean | `true` om detta är en PvE-item i PvP-slot |
| `resilience` | number | Resilience-värde på itemet |
| `tier` | string | `"gold"`, `"strong"`, `"viable"`, `"niche"` |

### Exempel-data

```json
[
  {
    "itemId": 28442,
    "class": "Warrior",
    "spec": "Arms",
    "slot": "Weapon",
    "popularity": 92,
    "avgRating": "1500+",
    "phase": 1,
    "bracket": "all",
    "isPvEFlex": false,
    "resilience": 0,
    "tier": "gold"
  },
  {
    "itemId": 32051,
    "class": "Warrior",
    "spec": "Arms",
    "slot": "Shoulder",
    "popularity": 45,
    "avgRating": "2000+",
    "phase": 2,
    "bracket": "3v3",
    "isPvEFlex": false,
    "resilience": 22,
    "tier": "strong"
  }
]
```

---

## 5. Resilience-logik

### Soft Cap

I TBC PvP finns en Resilience "soft cap" beroende på fas:

| Fas | Soft Cap | Kommentar |
|---|---|---|
| P1 | ~250–300 | Begränsat PvP-gear tillgängligt |
| P2 | ~350–400 | S2 gear ger mer |
| P3+ | ~400–450 | Diminishing returns över detta |

### Spelstils-toggle (UI)

Användaren kan välja approach:

| Läge | Logik |
|---|---|
| **🛡️ Defensive PvP** | Maximera Resilience, prioritera full PvP-set. Rekommenderas för nybörjare. |
| **⚔️ Aggressive PvP** | Blanda in PvE-gear för mer damage i flex-slots (trinkets, rings, cloak). För erfarna spelare. |
| **⚖️ Balanced** (default) | Följ vad majoriteten av toppspelare kör (popularity-baserat). |

---

## 6. Arkitektur

```
┌─────────────────────────────────────────────────┐
│                   SERVER (Node.js)              │
│                                                 │
│  ┌──────────────┐    ┌───────────────────────┐  │
│  │ SixtyUpgrades │    │   Ironforge.pro       │  │
│  │   Scraper     │    │     Scraper           │  │
│  └──────┬───────┘    └──────────┬────────────┘  │
│         │                       │               │
│         ▼                       ▼               │
│  ┌──────────────────────────────────────────┐   │
│  │         Normalizer / ID-Mapper           │   │
│  │    (AtlasLoot .lua = Source of Truth)     │   │
│  └──────────────────┬───────────────────────┘   │
│                     │                           │
│                     ▼                           │
│  ┌──────────────────────────────────────────┐   │
│  │       Weighted BiS Algorithm             │   │
│  │  (frekvens + rating-gate + hybrid)       │   │
│  └──────────────────┬───────────────────────┘   │
│                     │                           │
│                     ▼                           │
│  ┌──────────────────────────────────────────┐   │
│  │         pvp-bis-data.json                │   │
│  │    (Färdigberäknad, publiceras dagligen)  │   │
│  └──────────────────────────────────────────┘   │
│                                                 │
└────────────────────────┬────────────────────────┘
                         │  CDN / Static hosting
                         ▼
┌─────────────────────────────────────────────────┐
│              KLIENT (Webb-app)                  │
│                                                 │
│  • Laddar pvp-bis-data.json vid start           │
│  • Rating-filter (slider/dropdown)              │
│  • Spelstils-toggle (Defensive/Aggressive)      │
│  • Popularity-badges (🥇🥈🥉)                   │
│  • PvE Flex Slot-markeringar                    │
│                                                 │
└─────────────────────────────────────────────────┘
```

### Princip: Klienten scrapar ALDRIG

- All scraping sker server-side (Node.js cron-jobb).
- Klienten laddar ner en **färdig JSON-fil** — max en gång per dag.
- Håller appen snabb och undviker rate-limiting/blockering.

---

## 7. UI-features (Frontend)

### Rating-baserad BiS

- **Slider eller dropdown:** Användaren anger sin rating (eller "I don't have a rating yet").
- Items som kräver högre rating gråas ut med lås-ikon: `🔒 2000+ rating`.
- Under-text: *"Nå 1850 rating för att låsa upp: Merciless Gladiator's Shoulders"*

### Popularity-badges

Varje item visar sin popularity som visuell badge:

```
🥇 92% — Stormherald          (nästan alla kör detta)
🥈 45% — Gladiator's Cleaver  (starkt alternativ)
🥉 18% — Dragonmaw            (viable men ovanligt)
```

### Hybrid PvE/PvP-indikator

Items som är PvE-gear i PvP-context markeras tydligt:

```
⚔️ PvE Flex — Används av 60% av toppspelare i denna slot
🛡️ PvP Standard — Full Resilience-item
```

### Spelstils-toggles

```
[ 🛡️ Defensive ] [ ⚖️ Balanced ✓ ] [ ⚔️ Aggressive ]
```

---

## 8. Implementationsplan

### Fas A: Data Pipeline (Vecka 1–2)

- [ ] Bygg SixtyUpgrades scraper (Puppeteer)
- [ ] Bygg Ironforge.pro scraper (Puppeteer)
- [ ] Normaliserings-script (item-ID mapping mot .lua-data)
- [ ] Output: Rå JSON med alla items per spec/bracket

### Fas B: Algoritm (Vecka 2–3)

- [ ] Implementera frekvensanalys (popularity %)
- [ ] Rating-gate logik (min_rating per item)
- [ ] Hybrid-detektering (PvE flex slots)
- [ ] Outlier-filtering (< 5% threshold)
- [ ] Resilience soft-cap kalkylator
- [ ] Output: Färdig `pvp-bis-data.json`

### Fas C: Frontend Integration (Vecka 3–4)

- [ ] Rating-filter slider/dropdown
- [ ] Spelstils-toggle (Defensive / Balanced / Aggressive)
- [ ] Popularity-badges (🥇🥈🥉) på items
- [ ] PvE Flex Slot-markeringar
- [ ] Rating-gated items med lås-ikon

### Fas D: Automatisering (Vecka 4+)

- [ ] Cron-jobb för daglig/veckovis scraping
- [ ] Automatisk publicering av ny JSON till CDN
- [ ] Monitoring / alerting om scraping misslyckas

---

## 9. Öppna frågor

- [ ] Ska vi stödja **alla specs** från start, eller börja med 3–4 populära (Arms Warrior, Resto Druid, SL/SL Lock, Disc Priest)?
- [ ] Vilka **faser** ska vi börja med? Bara aktuell fas eller historisk data?
- [ ] Behöver vi hantera **comp-beroende** gearing? (T.ex. Warrior i RMP vs Warrior i WLD kör olika trinkets)
- [ ] Ska **2v2 och 3v3** viktas lika, eller ska 3v3 väga tyngre?
- [ ] Hur hanterar vi **seasonal resets** — rensa all data vid ny säsong?

---

*Skapat: 2026-04-04*
