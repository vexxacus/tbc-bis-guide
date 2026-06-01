# Juni-backlog

Saker att ta tag i 1 juni när Firebase-bandbreddskvoten nollställs.

Prioritet: 🔴 Hög | 🟡 Medium | 🟢 Låg

---

## 🔴 1. Flytta `lib.wasm` (25 MB) till gratis CDN

**Varför:** Filen är största enskilda asseten på Firebase. Lazy-loaded vid sim-användning men kostar 25 MB per ny sim-användare. Bidrog till att vi närmade oss 10 GB/mån-taket i maj.

**Vad vi redan testat och förkastat:**
- ❌ **Cloudflare R2** — Kräver betalkort även för gratisnivå
- ❌ **jsDelivr** — 20 MB-tak per fil (`File size exceeded the configured limit of 20 MB`)
- ❌ **statically.io** — HEAD-request OK men body-leverans stalls efter ~64 KB → 0 bytes. Bekräftade live med curl 2026-05-26. Troligen oannonserad gräns för stora filer.

**Nästa kandidat: Cloudflare Pages**
- Samma Cloudflare-konto som redan finns via GitHub-login
- **Inget betalkort krävs** (det är bara R2 som kräver det)
- Obegränsad bandbredd på gratistier
- Konfigurerbara headers via `_headers`-fil (kan sätta CORS + Content-Type explicit)
- Setup: Create Pages project → direct upload → URL `https://<projekt>.pages.dev/lib.wasm`

**Backup-kandidater om Pages inte funkar:**
- **GitHub Releases** — Ladda upp som release-asset på `vexxacus/tbc-bis-guide`. Caveat: serverar `Content-Type: application/octet-stream`, så vi måste byta från `WebAssembly.instantiateStreaming` till `WebAssembly.instantiate(await response.arrayBuffer())` i `sim_worker.js:644`. Funkar men lite långsammare init.
- **Netlify** — Gratis 100 GB/mån, GitHub-login, drag-and-drop deploy.

**Lärdom från statically.io-fiaskot:**
Innan vi deployar nästa CDN-attempt, **verifiera live**:
1. `curl -o /tmp/test.bin --max-time 30 <URL>/lib.wasm` — ska leverera hela 25 MB inom 30 sek
2. `curl -I <URL>/lib.wasm` — `content-type: application/wasm`, `access-control-allow-origin: *`
3. Öppna en lokal HTML-fil i webbläsaren som gör `WebAssembly.instantiateStreaming(fetch(<URL>))` → ska resolva utan CORS-fel
4. **Först därefter** ändra `sim_worker.js:644` + bump `sim.js?v=` + prerender + deploy

**Filer att röra (när det är dags):**
- [sim_worker.js:644](sim_worker.js#L644) — byt URL i `fetch(...)`
- [js/sim.js:505](js/sim.js#L505) — bump `?v=` i `WowSimBridge`-anrop
- [index.html](index.html) — bump `<script src="/js/sim.js?v=...">`
- Kör `node prerender.js` för att propagera

**Lämna `lib.wasm` kvar på Firebase i ~3 månader** efter migration som fallback för gamla cachade `sim_worker.js`-versioner. Sedan ta bort från deploy via `firebase.json` ignore.

---

## 🟡 2. PvP-meta tidsslider — "Se hur metan utvecklas vecka för vecka"

**Idé:** På PvP-sidorna (`/<class>/<spec>/pvp`), lägg till en slider högst upp där användaren kan dra för att se hur top-parsers utrustning har förändrats över tid. Vilka items dök upp när? Vad ramlade ut? När blev en build viral?

**Datatillgång — GOOD NEWS:** Vi sparar inte i GitHub Releases, men vi har lika bra: **PvP-datan auto-refreshas varje vecka via GitHub Actions** och commitas till git. Varje vecka = en separat commit på `js/pvp-data.js`. Just nu finns ~8 veckors historik (sedan 2026-04-20):

```
0e550b6  2026-05-24  chore: auto-refresh PvP BiS data
4fd3be5  2026-05-17  chore: auto-refresh PvP BiS data
0850c79  2026-05-10  chore: auto-refresh PvP BiS data
b4b51b4  2026-05-03  chore: auto-refresh PvP BiS data
af0592a  2026-04-30  chore: auto-refresh PvP BiS data
e419fb5  2026-04-25  feat: expand PvP data to 4265 players, 26 specs
9d5537e  2026-04-20  chore: auto-refresh PvP BiS data
099b2d1  initial commit
```

Varje commit är en hel snapshot — ingen extra infrastruktur behövs för att samla historik. Den finns redan.

**Implementationsapproach (förslag — välj en):**

### Variant A — Pre-build kombinerat dataset (enklast)
- Lägg till `build-pvp-history.js`-skript som läser `git log` för `js/pvp-data.js`
- För varje commit: extrahera data → bygg `pvp-history.json` med `{ "2026-05-24": {...weekly snapshot...}, ... }`
- Frontend laddar en enda fil
- **Pro:** Enkel, ingen networking
- **Con:** Bundle växer ~80 KB gzippad per vecka — efter 1 år ~4 MB. Hanterbart men inte oändligt.

### Variant B — Lazy fetch per vecka (skalar bättre)
- Frontend gör fetch mot `https://cdn.jsdelivr.net/gh/vexxacus/tbc-bis-guide@<commit>/js/pvp-data.js` när slidern flyttas
- Cacha i minnet efter första fetch
- **Pro:** Skalar oändligt, ingen bundle-tillväxt
- **Con:** Beroende av extern CDN för historisk data; per-vecka network call

### Variant C — Hybrid (rekommenderas)
- Skicka senaste 4 veckorna inline i pvp-data.js (vanligaste use case)
- Lazy-load äldre veckor via jsDelivr när slidern dras tillbaka
- Bästa av båda världar

**UI-skiss:**
```
┌─────────────────────────────────────────────────────┐
│  PvP Meta Evolution                                  │
│  ◄────●───────────────────────────────────────►      │
│       2026-04-20         2026-05-24 (latest)         │
│  Showing data from: 2026-04-30                       │
└─────────────────────────────────────────────────────┘
```

**Coola detaljer att göra senare:**
- Grön ram runt items som är **nya denna vecka** jämfört med förra
- "First seen [datum]"-badge på items vid hover
- Liten popularity-graf bredvid varje item som visar dess uppgång/nedgång i metan
- "Hot pick"-flagga på items vars popularitet ökat >20% mot förra veckan

**Komplexitet:** ~2-4 dagar arbete
- 0.5d: history-aggregation skript (Variant A) eller jsDelivr-fetch (B/C)
- 1d: slider-UI + state management
- 1d: diff highlighting + "first seen" badges
- 0.5d: testning, polering

**Filer att röra (när det är dags):**
- Ny: `build-pvp-history.js` (om Variant A eller C)
- Ny: `js/pvp-history.js` eller fetch-logik i `js/app.js`
- [js/app.js](js/app.js) — rendering av PvP-sidan, lägg till slider
- [css/app.css](css/app.css) — slider-styling + diff-highlighting
- [prerender.js](prerender.js) — uppdatera FAQ/description-block för att nämna "se meta över tid"
