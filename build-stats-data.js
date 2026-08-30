#!/usr/bin/env node
/**
 * build-stats-data.js — aggregates existing repo data into a compact
 * js/stats-data.js consumed by the /stats page (js/stats-page.js).
 *
 * Sources (all already in the repo — no new scraping):
 *   js/wcl-data.js       → PvE item usage + spec representation per phase
 *   js/wcl-cohorts.js    → PvE meta evolution (Early/Mid/Late within a phase)
 *   pvp-history.json     → PvP meta evolution + spec share (21 weekly snapshots)
 *   js/pvp-data.js       → PvP item usage (latest snapshot)
 *   scraper/output/leaderboard-raw.json → Top Players (top 20 per class|spec|bracket)
 *
 * ⚠️ Update-cadence honesty (see STATS-PAGE-DESIGN.md §0): every timestamp
 * written to meta.sources is read from the source files — never Date.now().
 * The UI copy that talks about freshness is driven off these, so they must
 * never claim the data is fresher than it is.
 *
 * Output: js/stats-data.js  (global `const STATS_DATA = {...}`)
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;
const log = (...a) => console.log(...a);

// ── helpers ────────────────────────────────────────────────────────
function loadGlobal(file, varName) {
    const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const ctx = { window: {} };
    vm.createContext(ctx);
    vm.runInContext(code + `\n;this.__out = (typeof ${varName} !== 'undefined') ? ${varName} : (window.${varName} || null);`, ctx);
    return ctx.__out;
}
function readJson(file) {
    return JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
}
const round1 = n => Math.round(n * 10) / 10;
// Item "popularity" is a per-slot pick rate that CAN legitimately exceed
// 100% in the raw data when one item fills two slots (e.g. the same ring in
// both ring slots — "The 2 Ring"). A share shown to users must never read
// >100%, so clamp every pick-rate we surface. clampPct(113) → 100.
const clampPct = n => Math.max(0, Math.min(100, n));

log('▶ build-stats-data.js\n');

// ── load sources ───────────────────────────────────────────────────
log('Loading sources…');
const WCL = loadGlobal('js/wcl-data.js', 'WCL_DATA');
const COH = loadGlobal('js/wcl-cohorts.js', 'WCL_COHORTS');
const PVP = loadGlobal('js/pvp-data.js', 'PVP_DATA');
const HIST = readJson('pvp-history.json');
const LB = readJson('scraper/output/leaderboard-raw.json');
log('  ✓ all sources loaded\n');

const phases = Object.keys(WCL.phases).sort((a, b) => +a - +b); // ['1','2',...]
const phaseLabel = p => `P${p}`;

const STATS = {
    meta: {
        generatedAt: new Date().toISOString(),
        sources: {
            pve:         { file: 'wcl-data.js',        scrapedAt: WCL.meta.scrapedAt },
            pveCohorts:  { file: 'wcl-cohorts.js',     scrapedAt: COH.meta.scrapedAt },
            pvp:         { file: 'pvp-history.json',   latestSnapshot: HIST.dates[HIST.dates.length - 1] },
            pvpLatest:   { file: 'pvp-data.js',        analyzedAt: PVP.meta.analyzedAt },
            leaderboard: { file: 'leaderboard-raw.json', scrapedAt: LB.meta.scrapedAt }
        },
        phases: phases.map(p => ({ id: p, label: phaseLabel(p) })),
        latestPhase: phases[phases.length - 1],
        pvpDates: HIST.dates,
        brackets: LB.meta.brackets // ['2v2','3v3']
    }
};

// ════════════════════════════════════════════════════════════════════
// 1. ITEM USAGE — intentionally NOT duplicated here.
//    js/wcl-data.js (WCL_DATA) and js/pvp-data.js (PVP_DATA) are already
//    loaded on every page, so js/stats-page.js reads item-usage straight
//    from those globals. Duplicating them would add ~900 KB for nothing.
// ════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════
// 2. META EVOLUTION
//    PvE Early/Mid/Late is derived client-side from WCL_COHORTS (already
//    loaded), so only the PvP week-by-week series — sourced from
//    pvp-history.json, which is NOT shipped to the client — lives here.
// ════════════════════════════════════════════════════════════════════
log('Building metaEvolution (pvp only)…');
STATS.metaEvolution = { pvp: {} };
for (const specKey of new Set(HIST.dates.flatMap(d => Object.keys(HIST.snapshots[d] || {})))) {
    // Build per-slot item series across all dates.
    const slotItemSeries = {}; // slot -> id -> { name, quality, series[] }
    HIST.dates.forEach((date, di) => {
        const spec = HIST.snapshots[date]?.[specKey];
        if (!spec) return;
        for (const [slot, items] of Object.entries(spec.slots)) {
            slotItemSeries[slot] = slotItemSeries[slot] || {};
            for (const it of items) {
                const rec = slotItemSeries[slot][it.id] = slotItemSeries[slot][it.id] || {
                    name: it.name, quality: it.quality || 'epic', series: new Array(HIST.dates.length).fill(null)
                };
                rec.series[di] = it.popularity;
            }
        }
    });
    const slotsOut = {};
    for (const [slot, byId] of Object.entries(slotItemSeries)) {
        // Rank items by their latest non-null popularity, keep top 4.
        const arr = Object.entries(byId).map(([id, r]) => {
            const last = [...r.series].reverse().find(v => v != null) || 0;
            return { id: +id, name: r.name, quality: r.quality, series: r.series, _last: last };
        }).sort((a, b) => b._last - a._last).slice(0, 3);
        if (arr.length) slotsOut[slot] = arr.map(({ _last, ...rest }) => rest);
    }
    STATS.metaEvolution.pvp[specKey] = { dates: HIST.dates, slots: slotsOut };
}
log(`  ✓ pvp: ${Object.keys(STATS.metaEvolution.pvp).length} specs\n`);

// ════════════════════════════════════════════════════════════════════
// 3. SPEC META (representation, not power)
// ════════════════════════════════════════════════════════════════════
log('Building specMeta…');
STATS.specMeta = { pve: {}, pvp: {} };

// PvE: rank specs by totalPlayers within each phase.
for (const p of phases) {
    const specs = Object.entries(WCL.phases[p]).map(([key, s]) => {
        const [cls, spec] = key.split('|');
        return { class: cls, spec, totalPlayers: s.totalPlayers };
    });
    const total = specs.reduce((sum, s) => sum + s.totalPlayers, 0);
    specs.forEach(s => s.share = round1((s.totalPlayers / total) * 100));
    specs.sort((a, b) => b.totalPlayers - a.totalPlayers);
    STATS.specMeta.pve[p] = { totalPlayersAllSpecs: total, ranking: specs };
}

// PvP: spec share time-series across the 21 snapshots (single ladder, no bracket
// split in pvp-history — keyed by "all").
{
    const dates = HIST.dates;
    const specSet = new Set(dates.flatMap(d => Object.keys(HIST.snapshots[d] || {})));
    const perDateTotal = dates.map(d => {
        const snap = HIST.snapshots[d] || {};
        return Object.values(snap).reduce((sum, s) => sum + (s.playerCount || 0), 0);
    });
    const specs = [...specSet].map(key => {
        const [cls, spec] = key.split('|');
        const shareSeries = dates.map((d, i) => {
            const s = HIST.snapshots[d]?.[key];
            if (!s || !perDateTotal[i]) return null;
            return round1((s.playerCount / perDateTotal[i]) * 100);
        });
        const lastShare = [...shareSeries].reverse().find(v => v != null) || 0;
        return { class: cls, spec, shareSeries, _last: lastShare };
    }).sort((a, b) => b._last - a._last);
    STATS.specMeta.pvp['all'] = {
        dates,
        specs: specs.map(({ _last, ...rest }) => rest)
    };
}
log(`  ✓ pve: ${Object.keys(STATS.specMeta.pve).length} phases, pvp series with ${STATS.specMeta.pvp.all.specs.length} specs\n`);

// ════════════════════════════════════════════════════════════════════
// 4. OVERVIEW datasets
// ════════════════════════════════════════════════════════════════════
log('Building overview…');
STATS.overview = {};

// ── A. Class Stacking ──────────────────────────────────────────────
// PvE: per-class share (summed over specs), per phase. Track top spec.
const classStackPve = {}; // class -> { shares:[], topSpec }
{
    const perPhaseClassTotals = phases.map(p => {
        const byClass = {};
        for (const [key, s] of Object.entries(WCL.phases[p])) {
            const [cls, spec] = key.split('|');
            byClass[cls] = byClass[cls] || { total: 0, specTop: { name: '', n: 0 } };
            byClass[cls].total += s.totalPlayers;
            if (s.totalPlayers > byClass[cls].specTop.n) byClass[cls].specTop = { name: spec, n: s.totalPlayers };
        }
        return byClass;
    });
    const allClasses = new Set(perPhaseClassTotals.flatMap(o => Object.keys(o)));
    for (const cls of allClasses) {
        const shares = phases.map((p, i) => {
            const totals = perPhaseClassTotals[i];
            const grand = Object.values(totals).reduce((s, o) => s + o.total, 0);
            return totals[cls] ? round1((totals[cls].total / grand) * 100) : 0;
        });
        // Top spec of the class in the latest phase.
        const latest = perPhaseClassTotals[perPhaseClassTotals.length - 1][cls];
        classStackPve[cls] = { shares, topSpec: latest ? latest.specTop.name : '' };
    }
}
// PvP: per-class share per weekly snapshot.
const classStackPvp = {};
{
    const perDateClass = HIST.dates.map(d => {
        const snap = HIST.snapshots[d] || {};
        const byClass = {};
        for (const [key, s] of Object.entries(snap)) {
            const [cls, spec] = key.split('|');
            byClass[cls] = byClass[cls] || { total: 0, specTop: { name: '', n: 0 } };
            byClass[cls].total += s.playerCount || 0;
            if ((s.playerCount || 0) > byClass[cls].specTop.n) byClass[cls].specTop = { name: spec, n: s.playerCount || 0 };
        }
        return byClass;
    });
    const allClasses = new Set(perDateClass.flatMap(o => Object.keys(o)));
    for (const cls of allClasses) {
        const shares = HIST.dates.map((d, i) => {
            const totals = perDateClass[i];
            const grand = Object.values(totals).reduce((s, o) => s + o.total, 0);
            return totals[cls] && grand ? round1((totals[cls].total / grand) * 100) : 0;
        });
        const latest = perDateClass[perDateClass.length - 1][cls];
        classStackPvp[cls] = { shares, topSpec: latest ? latest.specTop.name : '' };
    }
}
STATS.overview.classStacking = {
    pve: { labels: phases.map(phaseLabel), classes: classStackPve },
    pvp: { labels: HIST.dates, classes: classStackPvp }
};

// ── B. Biggest Movers ──────────────────────────────────────────────
// Movers are measured in SHARE (% of the population), NOT raw player
// counts. Raw counts swing with how many logs/players were scraped that
// week/phase (e.g. P4→P5 total dropped 8466→5513), which would make every
// spec look like it "fell". Share deltas isolate real representation shifts.
const moversPve = [];
if (phases.length >= 2) {
    const prevP = phases[phases.length - 2], currP = phases[phases.length - 1];
    const prevTotal = Object.values(WCL.phases[prevP]).reduce((s, x) => s + x.totalPlayers, 0) || 1;
    const currTotal = Object.values(WCL.phases[currP]).reduce((s, x) => s + x.totalPlayers, 0) || 1;
    for (const key of Object.keys(WCL.phases[currP])) {
        const [cls, spec] = key.split('|');
        const prevN = WCL.phases[prevP][key]?.totalPlayers;
        const currN = WCL.phases[currP][key]?.totalPlayers;
        if (prevN && currN) {
            moversPve.push({
                class: cls, spec,
                prev: round1((prevN / prevTotal) * 100),
                curr: round1((currN / currTotal) * 100)
            });
        }
    }
}
// PvP: last two weekly snapshots, share-based.
const moversPvp = [];
{
    const dates = HIST.dates;
    if (dates.length >= 2) {
        const prevD = dates[dates.length - 2], currD = dates[dates.length - 1];
        const prevSnap = HIST.snapshots[prevD] || {}, currSnap = HIST.snapshots[currD] || {};
        const prevTotal = Object.values(prevSnap).reduce((s, x) => s + (x.playerCount || 0), 0) || 1;
        const currTotal = Object.values(currSnap).reduce((s, x) => s + (x.playerCount || 0), 0) || 1;
        for (const key of Object.keys(currSnap)) {
            const [cls, spec] = key.split('|');
            const prevN = prevSnap[key]?.playerCount;
            const currN = currSnap[key]?.playerCount;
            if (prevN && currN) {
                moversPvp.push({
                    class: cls, spec,
                    prev: round1((prevN / prevTotal) * 100),
                    curr: round1((currN / currTotal) * 100)
                });
            }
        }
    }
}
STATS.overview.movers = { pve: moversPve, pvp: moversPvp };

// ── C. Meta Concentration Index (Herfindahl-style) ─────────────────
// Data points backed by fewer than this many players are statistically
// meaningless for a distribution metric → emitted as null (a gap in the
// line + "insufficient data" on hover) rather than a misleading number.
const CONC_MIN_SAMPLE = 200;
function hhiFrom(entries /* [{key,count}] */) {
    const total = entries.reduce((s, e) => s + e.count, 0);
    if (total < CONC_MIN_SAMPLE) return { score: null, top3: [], sample: total };
    let sumSq = 0;
    for (const e of entries) { const share = e.count / total; sumSq += share * share; }
    // Normalised Herfindahl index → 0–100. 0 = perfectly even (wide-open
    // meta), 100 = a single spec dominates. Normalising against 1/N stops
    // the raw HHI from saturating at the top for a crowded field.
    const n = entries.length;
    const score = n <= 1 ? 100 : Math.max(0, Math.min(100, round1(((sumSq - 1 / n) / (1 - 1 / n)) * 100)));
    const top3 = entries.slice().sort((a, b) => b.count - a.count).slice(0, 3)
        .map(e => {
            const [cls, spec] = e.key.split('|');
            return [`${cls}/${spec}`, round1((e.count / total) * 100)];
        });
    return { score: Math.min(100, score), top3, sample: total };
}
const concPve = phases.map(p => {
    const entries = Object.entries(WCL.phases[p]).map(([key, s]) => ({ key, count: s.totalPlayers }));
    const { score, top3, sample } = hhiFrom(entries);
    return { date: phaseLabel(p), score, top3, sample };
});
const concPvp = HIST.dates.map(d => {
    const snap = HIST.snapshots[d] || {};
    const entries = Object.entries(snap).map(([key, s]) => ({ key, count: s.playerCount || 0 }));
    const { score, top3, sample } = hhiFrom(entries);
    return { date: d, score, top3, sample };
});
STATS.overview.concentration = { pve: concPve, pvp: concPvp };

// ── D. Cross-Phase Survivors ───────────────────────────────────────
const SURVIVOR_THRESHOLD = 40;
function buildSurvivors(kind) {
    // kind: 'pve' uses WCL phases; 'pvp' uses sampled weekly snapshots.
    const itemMap = {}; // id -> { name, slot, quality, series: [[label, pop]] }
    if (kind === 'pve') {
        for (const p of phases) {
            for (const spec of Object.values(WCL.phases[p])) {
                for (const [slot, items] of Object.entries(spec.slots)) {
                    for (const it of items) {
                        if (it.popularity < SURVIVOR_THRESHOLD) continue;
                        const rec = itemMap[it.id] = itemMap[it.id] || { name: it.name, slot, quality: it.quality || 'epic', byLabel: {} };
                        // keep the highest popularity seen in this phase
                        const label = phaseLabel(p);
                        rec.byLabel[label] = Math.max(rec.byLabel[label] || 0, it.popularity);
                    }
                }
            }
        }
        // convert to ordered series by phase
        return finalizeSurvivors(itemMap, phases.map(phaseLabel));
    } else {
        // sample 6 evenly-spaced weeks for a compact "longest-running" view
        const dates = HIST.dates;
        const sampleIdx = sampleIndices(dates.length, 6);
        const sampleLabels = sampleIdx.map(i => dates[i]);
        sampleIdx.forEach(i => {
            const snap = HIST.snapshots[dates[i]] || {};
            for (const spec of Object.values(snap)) {
                for (const [slot, items] of Object.entries(spec.slots)) {
                    for (const it of items) {
                        if (it.popularity < SURVIVOR_THRESHOLD) continue;
                        const rec = itemMap[it.id] = itemMap[it.id] || { name: it.name, slot, quality: it.quality || 'epic', byLabel: {} };
                        rec.byLabel[dates[i]] = Math.max(rec.byLabel[dates[i]] || 0, it.popularity);
                    }
                }
            }
        });
        return finalizeSurvivors(itemMap, sampleLabels);
    }
}
function sampleIndices(len, want) {
    if (len <= want) return [...Array(len).keys()];
    const out = [];
    for (let i = 0; i < want; i++) out.push(Math.round((i / (want - 1)) * (len - 1)));
    return [...new Set(out)];
}
function finalizeSurvivors(itemMap, orderedLabels) {
    const rows = Object.values(itemMap).map(rec => {
        const series = orderedLabels.filter(l => rec.byLabel[l] != null).map(l => [l, rec.byLabel[l]]);
        return { name: rec.name, slot: rec.slot, quality: rec.quality, series };
    }).filter(r => r.series.length >= 1)
        .sort((a, b) => (b.series.length - a.series.length) ||
            (avg(b.series) - avg(a.series)))
        .slice(0, 30);
    return rows;
}
const avg = series => series.reduce((s, [, v]) => s + v, 0) / (series.length || 1);
STATS.overview.survivors = {
    pve: buildSurvivors('pve'),
    pvp: buildSurvivors('pvp')
};
// Collect distinct slots for the survivor slot filter.
STATS.overview.survivors.slots = [...new Set([
    ...STATS.overview.survivors.pve.map(r => r.slot),
    ...STATS.overview.survivors.pvp.map(r => r.slot)
])].sort();
// unitTotals: how many periods define the "of N" denominator per mode.
STATS.overview.survivors.totals = { pve: phases.length, pvp: 6 };
log(`  ✓ movers pve:${moversPve.length}/pvp:${moversPvp.length}, survivors pve:${STATS.overview.survivors.pve.length}/pvp:${STATS.overview.survivors.pvp.length}\n`);

// ════════════════════════════════════════════════════════════════════
// 5. TOP PLAYERS (top 20 per class|spec|bracket, EU+US combined)
// ════════════════════════════════════════════════════════════════════
log('Building topPlayers…');
STATS.topPlayers = {};
{
    const grouped = {}; // class|spec|bracket -> players[]
    for (const [lbKey, lb] of Object.entries(LB.leaderboards)) {
        for (const pl of lb.players) {
            const key = `${pl.class}|${pl.spec}|${pl.bracket}`;
            (grouped[key] = grouped[key] || []).push({
                name: pl.name, server: pl.server, region: pl.region,
                race: pl.race, faction: pl.faction, rating: pl.rating, winrate: pl.wr
            });
        }
    }
    for (const [key, players] of Object.entries(grouped)) {
        players.sort((a, b) => b.rating - a.rating);
        STATS.topPlayers[key] = {
            scrapedAt: LB.meta.scrapedAt,
            players: players.slice(0, 20).map((p, i) => ({ rank: i + 1, ...p }))
        };
    }
}
log(`  ✓ ${Object.keys(STATS.topPlayers).length} class|spec|bracket groups\n`);

// ════════════════════════════════════════════════════════════════════
// 6. ALL-TIME
// ════════════════════════════════════════════════════════════════════
log('Building allTime…');
STATS.allTime = { pve: {}, pvp: {} };

// PvE: most used gear per class|spec across all phases (weighted by #phases seen).
{
    const bySpec = {}; // class|spec -> id -> { name, pops:[], phases:Set }
    for (const p of phases) {
        for (const [key, spec] of Object.entries(WCL.phases[p])) {
            const target = bySpec[key] = bySpec[key] || {};
            for (const items of Object.values(spec.slots)) {
                for (const it of items) {
                    const rec = target[it.id] = target[it.id] || { name: it.name, pops: [], phases: new Set() };
                    rec.pops.push(clampPct(it.popularity));
                    rec.phases.add(+p);
                }
            }
        }
    }
    for (const [key, items] of Object.entries(bySpec)) {
        const arr = Object.entries(items).map(([id, r]) => ({
            id: +id, name: r.name,
            avgPopularity: Math.round(r.pops.reduce((s, v) => s + v, 0) / r.pops.length),
            phasesSeenIn: [...r.phases].sort((a, b) => a - b)
        }));
        // weight: avg popularity * number of phases seen
        arr.sort((a, b) => (b.avgPopularity * b.phasesSeenIn.length) - (a.avgPopularity * a.phasesSeenIn.length));
        STATS.allTime.pve[key] = { mostUsedItems: arr.slice(0, 10) };
    }

    // Most dominant specs across phases (led pick-rate count).
    const leadCount = {}; // class|spec -> { leads, shares[] }
    for (const p of phases) {
        const ranking = STATS.specMeta.pve[p].ranking;
        ranking.forEach((s, idx) => {
            const key = `${s.class}|${s.spec}`;
            const rec = leadCount[key] = leadCount[key] || { leads: 0, shares: [] };
            rec.shares.push(s.share);
            if (idx === 0) rec.leads++;
        });
    }
    STATS.allTime.pveSpecs = Object.entries(leadCount).map(([key, r]) => {
        const [cls, spec] = key.split('|');
        return { class: cls, spec, leads: r.leads, avgShare: round1(r.shares.reduce((s, v) => s + v, 0) / r.shares.length) };
    }).sort((a, b) => (b.leads - a.leads) || (b.avgShare - a.avgShare)).slice(0, 10);

    // Aggregated PvE gear across ALL classes/specs/phases — the All-Time tab
    // is class-agnostic (NAV-REVISION-GUIDE.md §0), so this must never depend
    // on the drilled-in spec. Mirrors the PvP mostUsedGear aggregation.
    {
        const gear = {}; // id -> { name, pops:[], phases:Set }
        for (const p of phases) {
            for (const spec of Object.values(WCL.phases[p])) {
                for (const items of Object.values(spec.slots)) {
                    for (const it of items) {
                        const rec = gear[it.id] = gear[it.id] || { name: it.name, pops: [], phases: new Set() };
                        rec.pops.push(clampPct(it.popularity));
                        rec.phases.add(+p);
                    }
                }
            }
        }
        STATS.allTime.pveGear = Object.entries(gear).map(([id, r]) => ({
            id: +id, name: r.name,
            avgPopularity: Math.round(r.pops.reduce((s, v) => s + v, 0) / r.pops.length),
            phasesSeenIn: [...r.phases].sort((a, b) => a - b)
        })).sort((a, b) => (b.avgPopularity * b.phasesSeenIn.length) - (a.avgPopularity * a.phasesSeenIn.length)).slice(0, 10);
    }
}

// PvP: highest rated specs ever + most used arena gear all-time.
{
    const peak = {}; // class|spec|bracket -> { peakRating, dateOfPeak }
    // Peak rating per spec+bracket isn't in history (no bracket split); use
    // leaderboard-raw for peak rating and history for gear.
    for (const [lbKey, lb] of Object.entries(LB.leaderboards)) {
        for (const pl of lb.players) {
            const key = `${pl.class}|${pl.spec}|${pl.bracket}`;
            if (!peak[key] || pl.rating > peak[key].peakRating) {
                peak[key] = { class: pl.class, spec: pl.spec, bracket: pl.bracket, peakRating: pl.rating, dateOfPeak: LB.meta.scrapedAt.slice(0, 10) };
            }
        }
    }
    STATS.allTime.pvp.highestRatedSpecs = Object.values(peak)
        .sort((a, b) => b.peakRating - a.peakRating).slice(0, 10);

    // Most used arena gear across all snapshots.
    const gear = {}; // id -> { name, pops:[], firstDate }
    for (const d of HIST.dates) {
        const snap = HIST.snapshots[d] || {};
        for (const spec of Object.values(snap)) {
            for (const items of Object.values(spec.slots)) {
                for (const it of items) {
                    const rec = gear[it.id] = gear[it.id] || { name: it.name, pops: [], firstDate: d };
                    rec.pops.push(clampPct(it.popularity));
                }
            }
        }
    }
    STATS.allTime.pvp.mostUsedGear = Object.entries(gear).map(([id, r]) => ({
        id: +id, name: r.name,
        avgPopularity: Math.round(r.pops.reduce((s, v) => s + v, 0) / r.pops.length),
        since: r.firstDate
    })).sort((a, b) => b.avgPopularity - a.avgPopularity).slice(0, 10);
}
log(`  ✓ pve specs:${Object.keys(STATS.allTime.pve).length}, pvp peaks:${STATS.allTime.pvp.highestRatedSpecs.length}\n`);

// ════════════════════════════════════════════════════════════════════
// 7. HIGHLIGHTS (three tiles per mode, driven by real data)
// ════════════════════════════════════════════════════════════════════
log('Building highlights…');
{
    const latestP = phases[phases.length - 1];
    // PvE: most picked item across all specs in latest phase.
    let topItem = { name: '—', pop: 0, spec: '' };
    for (const [key, spec] of Object.entries(WCL.phases[latestP])) {
        for (const items of Object.values(spec.slots)) {
            for (const it of items) {
                const pop = clampPct(it.popularity);
                if (pop > topItem.pop) topItem = { name: it.name, pop, spec: key.replace('|', ' ') };
            }
        }
    }
    const topSpecPve = STATS.specMeta.pve[latestP].ranking[0];
    const totalPve = STATS.specMeta.pve[latestP].totalPlayersAllSpecs;

    // PvP: most picked item in latest snapshot + peak rating + players analyzed.
    const latestDate = HIST.dates[HIST.dates.length - 1];
    const latestSnap = HIST.snapshots[latestDate] || {};
    let topItemPvp = { name: '—', pop: 0 };
    for (const spec of Object.values(latestSnap)) {
        for (const items of Object.values(spec.slots)) {
            for (const it of items) { const pop = clampPct(it.popularity); if (pop > topItemPvp.pop) topItemPvp = { name: it.name, pop }; }
        }
    }
    const peakSpec = STATS.allTime.pvp.highestRatedSpecs[0];

    STATS.highlights = {
        pve: [
            { cls: '',          label: 'Most picked item', num: `${topItem.pop}%`, foot: `${topItem.name} · ${topItem.spec}` },
            { cls: 'is-arcane', label: 'Most played spec', num: `${topSpecPve.share}%`, foot: `${topSpecPve.spec} ${topSpecPve.class} · Phase ${latestP}` },
            { cls: 'is-gold',   label: 'Players analyzed', num: totalPve.toLocaleString('en-US'), foot: `Logged raiders, Phase ${latestP}` }
        ],
        pvp: [
            { cls: '',          label: 'Most picked item', num: `${topItemPvp.pop}%`, foot: topItemPvp.name },
            { cls: 'is-arcane', label: 'Peak rating (all-time)', num: `${peakSpec.peakRating}`, foot: `${peakSpec.spec} ${peakSpec.class} · ${peakSpec.bracket}` },
            { cls: 'is-gold',   label: 'Players analyzed', num: LB.meta.totalPlayers.toLocaleString('en-US'), foot: 'Across EU + US, arena ladder' }
        ]
    };
}
log('  ✓ highlights built\n');

// ════════════════════════════════════════════════════════════════════
// VALIDATION — catch impossible percentages before they reach production.
// Every share/pick-rate we compute or surface must be 0–100. If a future
// data quirk pushes one past 100, fail the build loudly instead of quietly
// publishing a "136%"-style number (STATS-PAGE-BUGFIX-GUIDE.md §2).
// ════════════════════════════════════════════════════════════════════
log('Validating percentages…');
{
    const problems = [];
    const check = (label, v) => { if (typeof v === 'number' && v > 100.01) problems.push(`${label} = ${v}`); };

    // Spec-meta shares (PvE per phase + PvP series).
    for (const [p, o] of Object.entries(STATS.specMeta.pve)) o.ranking.forEach(s => check(`specMeta.pve[${p}] ${s.class}/${s.spec}.share`, s.share));
    STATS.specMeta.pvp.all.specs.forEach(s => (s.shareSeries || []).forEach(v => check(`specMeta.pvp ${s.class}/${s.spec}`, v)));
    // Class-stacking shares (both modes).
    for (const mode of ['pve', 'pvp']) for (const [cls, rec] of Object.entries(STATS.overview.classStacking[mode].classes)) rec.shares.forEach(v => check(`classStacking.${mode}[${cls}]`, v));
    // Concentration scores.
    for (const mode of ['pve', 'pvp']) STATS.overview.concentration[mode].forEach(pt => check(`concentration.${mode}[${pt.date}]`, pt.score));
    // Surfaced item pick-rates (highlights + all-time gear).
    STATS.highlights.pve.concat(STATS.highlights.pvp).forEach(t => { const m = /^(\d+(?:\.\d+)?)%$/.exec(t.num); if (m) check(`highlight "${t.label}"`, +m[1]); });
    (STATS.allTime.pveGear || []).forEach(it => check(`allTime.pveGear ${it.name}`, it.avgPopularity));
    (STATS.allTime.pvp.mostUsedGear || []).forEach(it => check(`allTime.pvp.mostUsedGear ${it.name}`, it.avgPopularity));

    if (problems.length) {
        console.error('\n✗ Percentage sanity-check FAILED — impossible values (>100%):');
        problems.forEach(p => console.error('   • ' + p));
        throw new Error(`build-stats-data: ${problems.length} percentage(s) exceed 100% — refusing to write stats-data.js`);
    }
    log(`  ✓ all surfaced percentages within 0–100%\n`);
}

// ════════════════════════════════════════════════════════════════════
// WRITE OUTPUT
// ════════════════════════════════════════════════════════════════════
const header = `// Auto-generated by build-stats-data.js — do not edit manually.\n// Generated: ${STATS.meta.generatedAt}\n// Sources: wcl-data.js, wcl-cohorts.js, pvp-history.json, pvp-data.js, leaderboard-raw.json\n`;
const outPath = path.join(ROOT, 'js', 'stats-data.js');
fs.writeFileSync(outPath, `${header}const STATS_DATA = ${JSON.stringify(STATS)};\nif (typeof window !== 'undefined') window.STATS_DATA = STATS_DATA;\n`);

const sizeKB = (fs.statSync(outPath).size / 1024).toFixed(1);
log('════════════════════════════════════════');
log(`✓ Wrote js/stats-data.js (${sizeKB} KB)`);
log(`  PvE phases:        ${phases.length}`);
log(`  Meta-evolution (pvp specs): ${Object.keys(STATS.metaEvolution.pvp).length}`);
log(`  Top-player groups: ${Object.keys(STATS.topPlayers).length}`);
log(`  Latest PvP snapshot: ${STATS.meta.sources.pvp.latestSnapshot}`);
log(`  Leaderboard scraped: ${STATS.meta.sources.leaderboard.scrapedAt}`);
log('════════════════════════════════════════');
