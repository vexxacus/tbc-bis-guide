# Design Backlog — Crisp & Atmosphere

Fokus: göra sajten **känna** sig som en gaming-produkt, inte en dev tool. Subtila lyft, ej redesign från scratch.

Prio: 🔴 Foundation | 🟡 Hero moments | 🟢 Polish
Effort: S (≤1 dag) · M (1–3 dagar) · L (>3 dagar)

Princip: **whisper-level immersion**. Användaren ska inte tänka "wow snyggt!" — de ska tänka "det här känns rätt".

---

## 🔴 Foundation — bygg om visuella språket först

Dessa måste göras före resten. De är förutsättningar för hero moments.

### D1. Färgsystem v2 — semantiska accents · S
Idag gör en enda gold-accent allt jobb. Lägg till semantiska roller.

```css
/* Replace GitHub-dark with warm-dark */
--bg-primary: #0c0e14;
--bg-secondary: #141822;
--bg-card: #1a1f2c;
--bg-card-hover: #232938;

/* Surface tiers — depth via gradient, not borders */
--surface-elev-1: linear-gradient(180deg, #1a1f2c 0%, #161a25 100%);
--surface-elev-2: linear-gradient(180deg, #232938 0%, #1c2230 100%);

/* Semantic accents — each role gets its own */
--accent-gold:   #e8b04a;  /* primary brand, BiS, gear */
--accent-arcane: #7c5cff;  /* sim, experimentation */
--accent-parse:  #ff8c42;  /* WCL, top players */
--accent-success: #4cd97b; /* progress, "I own this" */
--accent-danger: #ef4d4d;

/* Glow tokens */
--glow-gold:   0 0 24px rgba(232, 176, 74, 0.25);
--glow-arcane: 0 0 24px rgba(124, 92, 255, 0.30);
--glow-epic:   0 0 12px rgba(163, 53, 238, 0.45);
```

**DoD:** alla `--accent`-användningar uppdaterade till rätt semantisk variabel. Audit pass på CSS: ingen plats använder gold för något som inte är BiS/brand.

---

### D2. Typografisk hierarki — display-font på heroes · S
Inter på allt → Inter + Cinzel (eller Marcellus) på 4 platser.

- `.header-title h1`
- `.spec-name`
- `.phase-btn .phase-num` + `.ps-tab .ps-num`
- `.sim-dps-number` + `.gs-value`

```css
@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&display=swap');

.display {
  font-family: 'Cinzel', 'Inter', serif;
  letter-spacing: 0.02em;
}
```

**DoD:** display-font används på max 4 elementtyper. Inget body-text byts. Font preloads så ingen FOUT.

---

### D3. Minska beroendet av 1px borders · M
Borders signalerar "form input". Byt cards till **gradient surfaces + soft shadow** istället.

- `.class-card`, `.spec-card`, `.phase-btn`, `.sim-panel` → använd `--surface-elev-1` som bg, ta bort border eller gör den 1px med 0.5 alpha.
- Inner subtle highlight på toppkanten: `box-shadow: inset 0 1px 0 rgba(255,255,255,0.04)`.
- Hover lyfter: `transform: translateY(-2px)` + djupare shadow.

**DoD:** inga `border: 1px solid var(--border)` kvar på primära kort. Cards har visuell djup utan att skrika.

---

## 🟡 Hero moments — där designen ska "sjunga"

Efter foundation, lyft de 3 platser som är mest "wow-worthy".

### D4. Class-page atmosphere — klassfärgad immersion · S
När user är på `/warrior` ska sajten *känna* warrior-färg. Whisper-level, ej hammer.

```css
body[data-class="warrior"] {
  background:
    radial-gradient(ellipse at top, rgba(199,156,110,0.05), transparent 50%),
    var(--bg-primary);
}
/* repeat för alla 9 klasser */
```

- Set `data-class` attribute på `<body>` i route-logiken.
- Lägg också till en *klassfärgad ring* runt header-logoikonen när inne i en klass.
- Active phase-tab får class-color border istället för gold (alternativ — kan vara för mycket, testa).

**DoD:** byter du klass ändras background-tintens färg subtilt. Användaren märker det inte medvetet men sidan känns "rätt".

---

### D5. Item-quality blir visuellt episk · M
Idag: tunn färg-border på ikonen. Gör quality till en *känsla* på hela raden.

- Epic-rader: subtle radial gradient bakgrund (`rgba(163,53,238,0.04)`).
- Rare-rader: blue tint, samma princip.
- Legendary: gold tint + subtle shimmer-animation (5s cycle).
- Hover på epic+: aktivera `--glow-epic` på `box-shadow`.
- Respektera `prefers-reduced-motion` för shimmer.

```css
.slot-bis-item[data-quality="epic"] {
  background: radial-gradient(circle at 0% 50%, rgba(163,53,238,0.05), transparent 60%);
}
.slot-bis-item[data-quality="epic"]:hover {
  box-shadow: var(--glow-epic);
}
.slot-bis-item[data-quality="legendary"]::before {
  /* shimmer pass, subtle */
}
```

**DoD:** en blind A/B mellan listrad med 4 epics + 1 rare visar tydligt vilken som är vilken utan att läsa text.

---

### D6. Paperdoll får atmosphere · M
Idag: en grid. Gör den till sajtens visuella centrum.

- **Radial gradient bakom** (warm gold center → fade till bg).
- **Class-färgad ring** runt hela paperdoll-blocket som matchar aktuell klass.
- Inner shadow på containern → känns som ett *fönster in i karaktären*.
- Title "Your Gear" eller liknande i Cinzel ovanför.

**DoD:** paperdollen är den mest screenshot-vänliga delen av sajten. Folk vill posta den i Discord.

---

### D7. Sim-panel = "magisk arbetsbänk" · M
Sim är din mest unika feature. Den ska *se* magisk ut.

- Sim-CTA + DPS-number använder `--accent-arcane` (purple), ej gold.
- DPS-number i Cinzel, 2.5rem+, med `--glow-arcane`.
- Progress-bar har en *gradient sweep*-animation under körning, inte bara en växande bar.
- Sim-panel-bg får en *subtle arcane radial* i hörnet.

```css
.sim-dps-number {
  font-family: 'Cinzel', serif;
  font-size: 2.5rem;
  color: var(--accent-arcane);
  text-shadow: 0 0 16px rgba(124,92,255,0.4);
}
.sim-dps-fill {
  background: linear-gradient(90deg, #5a3fc7, #7c5cff, #5a3fc7);
  background-size: 200% 100%;
  animation: arcane-sweep 1.5s linear infinite;
}
@keyframes arcane-sweep {
  from { background-position: 0% 0; }
  to   { background-position: 200% 0; }
}
```

**DoD:** sim-sektionen ser visuellt distinkt ut från gear-listan. Nya användare vill trycka på knappen bara för att den är cool.

---

## 🟢 Polish — micro-interactions & finish

Sista lagret. Lite arbete, mycket "feel".

### D8. Spring-easing på interaktiva element · S
Byt `transition: 0.2s cubic-bezier(0.4,0,0.2,1)` till en spring.

```css
:root {
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --transition-spring: 0.22s var(--ease-spring);
}

.class-card, .spec-card, .phase-btn {
  transition: transform var(--transition-spring), box-shadow var(--transition-spring);
}
```

**DoD:** knappar känns "studsiga" på hover/active men ej överdrivet.

---

### D9. Slot-flash vid item-byte · S
När user byter item i en slot, blixt rad-gränsen gold 300ms.

```css
@keyframes slot-flash {
  0%   { box-shadow: 0 0 0 0 rgba(232,176,74,0); }
  30%  { box-shadow: 0 0 0 2px rgba(232,176,74,0.5); }
  100% { box-shadow: 0 0 0 0 rgba(232,176,74,0); }
}
.slot-just-changed { animation: slot-flash 0.4s ease-out; }
```

Triggas i JS efter alt-pick → add/remove class.

**DoD:** byter du item ser du *omedelbar* respons. Kopplar till UX-backlog #3 (re-sim CTA).

---

### D10. Sim-CTA pulse vid pending changes · S
När user ändrat items och sim är out-of-date, sim-knappen får subtle pulse.

```css
@keyframes sim-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(124,92,255,0.4); }
  50%      { box-shadow: 0 0 0 6px rgba(124,92,255,0); }
}
.sim-dps-btn.has-pending { animation: sim-pulse 1.6s ease-in-out infinite; }
```

Triggas i JS när items skiljer sig från senaste sim.

**DoD:** användaren ser passivt att "det finns något att simulera". Direct dependency av UX #3.

---

### D11. Reduce visual noise i above-the-fold · S
Audit pass: ta bort/dämpa visuellt brus över BiS-listans header.

- "Ad Space"-platshållaren — göm om ej aktiv (CSS `:empty` selector eller JS).
- Profession+PvP filter → collapse-meny (synkat med UX-backlog #8).
- Ctx-hint på BiS-vyn → mer subtil styling, snabbare auto-dismiss.

**DoD:** above-the-fold visar paperdoll + sim-CTA + primary actions — inget annat.

---

### D12. Footer + ad-slot rensning · S
Footer ser "engineer made this" ut. Dämpa.

- Större spacing.
- Footer-credits i lägre kontrast (text-muted, ej text-secondary).
- Ad-slot: tom box visar inget. Endast om annons faktiskt laddas.

**DoD:** footer känns som en stilla anförande, inte en debug-block.

---

## Föreslagen ordning

| Steg | Item | Effort | Varför nu |
|------|------|--------|-----------|
| 1 | **D1 Färgsystem v2** | S | Foundation — krävs av allt annat |
| 2 | **D2 Display-font** | S | Foundation — krävs av D6, D7 |
| 3 | **D8 Spring-easing** | S | Foundation — billig polish över hela appen |
| 4 | **D4 Class atmosphere** | S | Snabbast "wow" från användarperspektiv |
| 5 | **D5 Item quality visual** | M | Stor visuell impact på BiS-list (mest tittade ytan) |
| 6 | **D6 Paperdoll atmosphere** | M | Hero-moment, screenshotbar |
| 7 | **D7 Sim-panel arcane** | M | Hero-moment, kopplar till UX #3 |
| 8 | **D3 Border → surfaces** | M | Större refactor — gör efter D1/D2 |
| 9 | **D9 / D10** | S | Bind ihop med UX #3 när den landar |
| 10 | **D11 / D12** | S | Sista polish-pass |

---

## Korslänkning till UX-backloggen

- **D9 + D10** är beroende av [[UX-BACKLOG#3]] (delta-DPS + re-sim CTA).
- **D6 Paperdoll** vinner extra på [[UX-BACKLOG#6]] (OG-bild för share — vacker paperdoll = bättre share-bild).
- **D11 Reduce noise** överlappar [[UX-BACKLOG#8]] (collapse filters).

Gör D1 + D2 + D8 i ett pass — det är 3 små changes som lyfter hela appen på ~en eftermiddag.

---

## Trade-offs att vara medveten om

- **Performance:** glows och radial gradients kostar GPU. Använd endast på active states + hero-elements. Inte på alla slot-rader samtidigt.
- **Aging well:** Cinzel + glows är "i tiden". Inter + restraint åldras bättre. Maxa display-font på 4 platser, inte fler.
- **Accessibility:** alla animations behöver `prefers-reduced-motion` fallback. Pulse/shimmer kan trigga vestibulär stress.
- **Mobile:** mycket av detta är subtil — testa på faktisk mobil, ej bara devtools. Glows kan se hårdare ut på OLED.
