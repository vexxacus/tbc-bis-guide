# UX Backlog — Retention & Engagement

Fokus: **få användare att stanna längre och komma tillbaka**, utan att offra det enkla flödet.

Prio: 🔴 Hög impact | 🟡 Medium | 🟢 Polish
Effort: S (≤1 dag) · M (1–3 dagar) · L (>3 dagar)

---

## 🔴 P1 — Recurring use (största retention-vinsten)

### 1. Track My Progress — "what do I have / what should I farm next" · M
Förvandla guiden från engångsbesök till veckovis companion.

- Kryssruta per slot: *"har jag detta item"*. State sparas i localStorage per spec+phase.
- Progress-bar i toppen av BiS-listan: `73% BiS complete (12/16 slots)`.
- Subtle highlight på slots där användaren saknar item.
- **Farm priority widget**: efter user bockat av ≥1 slot, visa *"Your top 3 upgrades"* sorterat efter accessibility (badge vendor > 5-man heroic > raid drop).
  - Kräver: lättviktig "source tier"-tagg per item (kan reuse befintlig source-data).
- Reset-knapp ("Clear my progress for this spec").

**Definition of done:** user kan bocka av items, se procentbar, och få en farm-prioriteringslista. State persistar mellan besök.

---

### 2. Resume Where You Left Off · S
Lågt arbete, hög psykologisk effekt — signalerar "den här sajten kommer ihåg mig".

- Spara senast besökta `class/spec/phase` i localStorage.
- På hemsidan (class-grid): visa en sticky banner överst: *"↩ Continue: Fury Warrior — Phase 4"* med en stor klickyta.
- Visas bara om last-visit < 30 dagar och inte redan på den sidan.

**Definition of done:** återvändande user behöver inte klicka sig genom hela funneln igen.

---

## 🔴 P1 — Sticky engagement (gör nuvarande features mer kraftfulla)

### 3. Delta-DPS på alternative items + "Try swapping & re-sim" CTA · M
Förvandla slot-listan från statisk guide till interaktiv sandlåda.

- För varje alternativ-item i en slot, visa relativ DPS-delta jämfört med default BiS: `+342 DPS` / `−118 DPS`.
  - Kräver: bakad sim-data eller snabb single-item-swap-sim. Börja med pre-beräknad data om realtid blir för dyrt.
- När user byter item i listan: visa en **persistent CTA-pill** högst upp: *"⚡ You changed 2 items — re-simulate?"* med en knapp som triggar sim.
- Subtle animation på CTA när den dyker upp (fade-in, ej blinkande).

**Definition of done:** användaren förstår omedelbart hur item-val påverkar DPS, och har en uppenbar nästa handling.

---

### 4. WCL-cohort inline + "How meta evolved" · M
Du har redan early/mid/late phase-datan (se [[wcl-time-gated-cohorts]]) — exponera den mer.

- **Inline badge på item-rader**: `82% of top Fury (P3 late)` direkt på item-namnet, inte bara i modalen.
- **"Meta evolution"-strip** under phase-switchern: small sparkline eller `Early 41% → Mid 67% → Late 82%` för det aktuella default-item i listan. Gör tydligt att top players ändrar gear under phase-livet.
- Klick på badge → modal med full cohort-breakdown.

**Definition of done:** user ser social proof direkt utan att klicka, och förstår att meta är levande.

---

## 🟡 P2 — Discovery & sharing

### 5. Phase-to-phase Upgrade Diff · M
"Vad ändras egentligen från P3 till P4?"

- Ny vy/sektion: *"Upgrades from previous phase"* — visar bara de slots som faktiskt ändras.
- Visuellt: gamla item → nytt item, med stat-delta.
- Linka från phase-tabs: *"📋 See what changes from P3"* som secondary action.
- Funkar både framåt (P3→P4) och bakåt (vad jag missade i förra fasen).

**Definition of done:** user kan på 5 sekunder se vad nya phasen kräver att de bytar — istället för att jämföra hela listor.

---

### 6. Share Build med mini-OG-bild · M
Idag är "Share Build" en kall länk. Gör den social.

- När user trycker Share Build, generera en server-side eller canvas-baserad OG-bild som visar:
  - Paperdoll-thumbnail med deras items
  - Class/spec/phase som rubrik
  - DPS-tal om sim har körts
  - Liten footer med URL
- Sätt `og:image` dynamiskt så Discord/Twitter-previews ser ut som en byggkort, inte som en generisk landningssida.
- Bonus: en `"View on Discord"`-rekommendation i toasten efter share.

**Definition of done:** delar man en link i Discord ser den ut som en proper build-card, inte en länk.

---

## 🟢 P3 — Cognitive load polish (förenkling)

### 7. Sub-header speglar var användaren är · S
Idag står det "Choose your class" även djupt i flödet.

- Dynamiskt: `class-grid` → "Choose your class"
- `spec-grid` → "Choose your spec for Fury Warrior" wait, fel — `spec-grid` är efter class. → "Choose your spec — Warrior"
- `phase-tabs` → "Pick a phase — Fury Warrior"
- `bis-list` → "Fury Warrior · Phase 4 BiS"

Triggas i samma logik som body-class/route-state byts.

**Definition of done:** sub-titeln berättar alltid var användaren är, ej vad de ska göra härnäst.

---

### 8. Collapse profession & PvP-filter i en filter-meny · S
Fem kontroller ovanför listan är för många.

- Sammanfoga `professionFilter` + PvP-toggle till en collapsed *"Filters ▾"*-knapp.
- Default-collapsed. Visar en liten badge med antalet aktiva filter (`Filters · 1 active`).
- Behåll phase-switcher och share-bar som de är — de är primära handlingar.

**Definition of done:** above-the-fold på BiS-listan känns lugnare, men inget är gömt för långt bort.

---

## Föreslagen ordning

1. **#2 Resume where you left off** (S, snabb win, gör resten av backloggen mer värdefull genom att öka return-rate)
2. **#7 Sub-header** (S, polishing-paket tillsammans med #8)
3. **#8 Collapse filters** (S)
4. **#1 Track my progress** (M, den största retention-vinsten — gör det när snabba wins är ute ur vägen)
5. **#4 WCL-cohort inline** (M, builds på data du redan har)
6. **#3 Delta-DPS + re-sim CTA** (M, kräver lite sim-arbete)
7. **#5 Phase-to-phase diff** (M)
8. **#6 OG-bild för share** (M, viral loop när basen är solid)

---

## Mått att följa per release

- **Return rate** (≥1 besök inom 7 dagar) — primär metric för #1 och #2.
- **Session duration** — primär för #3 och #4.
- **Share-clicks → inkommande besökare** — för #6.
- **Bounce på BiS-list** — för #7 och #8.
