/* ══════════════════════════════════════════════════════════════════
   stats-page.js — rendering + interaction for the /stats page.
   Kept separate from the (huge) app.js. Registered as STATIC_PAGES.stats
   in app.js; app.js calls window.renderStatsPageShell() for the HTML and
   window.initStatsPage() on load.

   Data sources (all already loaded on the page):
     STATS_DATA  (js/stats-data.js)  — pvp history, top players, overview,
                                        specMeta, allTime, highlights
     WCL_DATA    (js/wcl-data.js)    — PvE item usage per phase
     WCL_COHORTS (js/wcl-cohorts.js) — PvE Early/Mid/Late meta evolution
     PVP_DATA    (js/pvp-data.js)    — PvP item usage (latest snapshot)

   Design ref: STATS-PAGE-DESIGN.md · mockup: stats-page-mockup.html
   ══════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    // ── Static reference tables ─────────────────────────────────────
    const CLASS_COLORS = {
        Warrior: '#C79C6E', Paladin: '#F58CBA', Hunter: '#ABD473', Rogue: '#FFF569',
        Priest: '#FFFFFF', Shaman: '#0070DE', Mage: '#69CCF0', Warlock: '#9482C9', Druid: '#FF7D0A'
    };
    const CLASS_RGB = {
        Warrior: '199,156,110', Paladin: '245,140,186', Hunter: '171,212,115', Rogue: '255,245,105',
        Priest: '220,225,240', Shaman: '0,112,222', Mage: '105,204,240', Warlock: '148,130,201', Druid: '255,125,10'
    };
    const CLASS_ABBR = {
        Warrior: 'WA', Paladin: 'PA', Hunter: 'HU', Rogue: 'RO', Priest: 'PR',
        Shaman: 'SH', Mage: 'MA', Warlock: 'WL', Druid: 'DR'
    };
    const CLASS_ORDER = ['Warrior', 'Paladin', 'Hunter', 'Rogue', 'Priest', 'Shaman', 'Mage', 'Warlock', 'Druid'];

    // ── Module state ────────────────────────────────────────────────
    const S = {
        mode: 'pve',        // 'pve' | 'pvp'
        class: '',          // '' = all
        spec: '',
        phase: null,        // string phase id, e.g. '3'
        bracket: '2v2',
        tab: 'overview'
    };

    const D = () => (typeof window !== 'undefined' && window.STATS_DATA) || null;
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    // ── Item helpers (reuse the site-wide ICONS / ITEM_QUALITY globals) ──
    const ICON_CDN = 'https://wow.zamimg.com/images/wow/icons/medium';
    const QUALITY_NAME = { 0: 'poor', 1: 'common', 2: 'uncommon', 3: 'rare', 4: 'epic', 5: 'legendary' };
    function iconUrl(id) {
        const name = (typeof ICONS !== 'undefined' && ICONS[id]) || 'inv_misc_questionmark';
        return `${ICON_CDN}/${name}.jpg`;
    }
    function qualityOf(id, fallback) {
        if (typeof ITEM_QUALITY !== 'undefined' && ITEM_QUALITY[id] != null) return QUALITY_NAME[ITEM_QUALITY[id]] || (fallback || 'epic');
        return fallback || 'epic';
    }
    const whLink = id => `https://www.wowhead.com/tbc/item=${id}`;
    // Popularity → tier label used in the mockup (gold/strong/viable/niche).
    function tierLabel(pop) {
        if (pop >= 70) return 'gold';
        if (pop >= 40) return 'strong';
        if (pop >= 15) return 'viable';
        return 'niche';
    }

    // ── Spec discovery from the loaded data globals ─────────────────
    // Returns ['Arms','Fury',…] available for a class in the current mode.
    function specsForClass(mode, cls, phase) {
        if (!cls) return [];
        const set = new Set();
        if (mode === 'pve') {
            const wcl = (typeof WCL_DATA !== 'undefined') ? WCL_DATA : null;
            if (wcl) {
                const phaseData = wcl.phases[phase] || {};
                for (const key of Object.keys(phaseData)) {
                    const [c, s] = key.split('|');
                    if (c === cls) set.add(s);
                }
            }
        } else {
            const pvp = (typeof PVP_DATA !== 'undefined') ? PVP_DATA : null;
            if (pvp) {
                for (const key of Object.keys(pvp.specs)) {
                    const [c, s] = key.split('|');
                    if (c === cls) set.add(s);
                }
            }
        }
        return [...set].sort();
    }

    // ── Shared SVG line-chart builder ───────────────────────────────
    // series: [{ label, color, points:[{x:0..1, v:number}|null] }], xLabels: []
    // Values are auto-scaled to the min/max across all series (with padding).
    const CHART_COLORS = ['var(--chart-a)', 'var(--chart-b)', 'var(--chart-c)', 'var(--accent-success)', 'var(--accent-danger)'];
    function lineChart(series, xLabels, opts) {
        opts = opts || {};
        const W = 320, H = 150, padL = 30, padR = 20, padT = 16, padB = 24;
        const allVals = series.flatMap(s => s.points.filter(p => p != null).map(p => p.v));
        if (!allVals.length) return '<p class="empty-note">Not enough data to chart yet.</p>';
        let lo = Math.min(...allVals), hi = Math.max(...allVals);
        if (opts.min != null) lo = opts.min;
        if (opts.max != null) hi = opts.max;
        if (hi === lo) { hi += 1; lo -= 1; }
        const pad = (hi - lo) * 0.15; lo -= pad; hi += pad;
        const n = xLabels.length;
        const xAt = i => padL + (n <= 1 ? 0 : (i / (n - 1)) * (W - padL - padR));
        const yAt = v => (H - padB) - ((v - lo) / (hi - lo)) * (H - padT - padB);

        let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="150" role="img" aria-label="${esc(opts.aria || 'Line chart')}">`;
        svg += `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${H - padB}" stroke="rgba(255,255,255,.08)"/>`;
        svg += `<line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="rgba(255,255,255,.08)"/>`;
        series.forEach(s => {
            let d = '', started = false;
            s.points.forEach((p, i) => {
                if (p == null) { started = false; return; }
                d += `${started ? 'L' : 'M'} ${xAt(i).toFixed(1)} ${yAt(p.v).toFixed(1)} `;
                started = true;
            });
            svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
            // end dot + label on last valid point
            let lastIdx = -1;
            for (let i = s.points.length - 1; i >= 0; i--) { if (s.points[i] != null) { lastIdx = i; break; } }
            if (lastIdx >= 0) {
                const p = s.points[lastIdx];
                svg += `<circle cx="${xAt(lastIdx).toFixed(1)}" cy="${yAt(p.v).toFixed(1)}" r="3.5" fill="${s.color}" stroke="#0c0e14" stroke-width="1.5"/>`;
            }
        });
        // x-axis labels (thin them out if crowded)
        const step = Math.ceil(n / 6);
        xLabels.forEach((lab, i) => {
            if (i % step !== 0 && i !== n - 1) return;
            svg += `<text x="${xAt(i).toFixed(1)}" y="${H - 8}" fill="#656d76" font-size="8" font-family="Inter, sans-serif" text-anchor="middle">${esc(lab)}</text>`;
        });
        svg += `</svg>`;
        return svg;
    }

    // ════════════════════════════════════════════════════════════════
    // Shell HTML — mirrors stats-page-mockup.html (minus its own header /
    // footer / mockup banner; the app's global header + footer wrap this).
    // Panels are filled by the render functions below.
    // ════════════════════════════════════════════════════════════════
    function renderStatsPageShell() {
        const data = D();
        const phases = data ? data.meta.phases : [{ id: '1', label: 'P1' }];
        const brackets = data ? data.meta.brackets : ['2v2', '3v3'];

        const classChips = ['', ...CLASS_ORDER].map(cls => {
            const active = cls === '' ? ' active' : '';
            const rgb = cls === '' ? '139,148,158' : CLASS_RGB[cls];
            const dot = cls === '' ? 'ALL' : CLASS_ABBR[cls];
            const dotBg = cls === '' ? '#8b949e' : `var(--${cls.toLowerCase()})`;
            const label = cls === '' ? 'All classes' : cls;
            return `<button class="class-chip${active}" data-class="${cls}" style="--chip-rgb:${rgb};"><span class="cc-dot" style="background:${dotBg};">${dot}</span>${label}</button>`;
        }).join('');

        const phaseButtons = phases.map((p, i) =>
            `<button class="${i === phases.length - 1 ? 'active' : ''}" data-phase="${p.id}">Phase ${p.id}</button>`
        ).join('');
        const bracketButtons = brackets.map((b, i) =>
            `<button class="${i === 0 ? 'active' : ''}" data-bracket="${b}">${b}</button>`
        ).join('');

        return `
        <div class="stats-page">
            <div class="page-intro">
                <div class="page-eyebrow">Stats &amp; Meta</div>
                <h1 class="page-title">What top players actually run</h1>
                <p class="page-desc">Item popularity, meta shifts through the phases, and today's arena leaderboards — pulled from the same WarcraftLogs and Ironforge.pro data that powers your BiS lists.</p>
            </div>

            <div class="global-mode-wrap">
                <div class="mode-toggle mode-toggle-hero" id="globalModeToggle">
                    <button class="active" data-mode="pve">⚔️ PvE</button>
                    <button data-mode="pvp">🏆 PvP</button>
                </div>
                <span class="global-mode-hint">Sets the mode for the whole page — highlights, charts and tabs below all follow this.</span>
            </div>

            <div class="highlight-strip" id="highlightStrip"></div>

            <div class="filter-bar">
                <div class="chip-row" id="classChips">${classChips}</div>
                <div class="chip-row hidden" id="specChips"></div>
                <div class="segmented" id="phaseSeg">${phaseButtons}</div>
                <div class="segmented hidden" id="bracketSeg">${bracketButtons}</div>
            </div>

            <div class="tab-bar" id="statsTabBar">
                <button class="tab-btn active" data-panel="overview">Overview</button>
                <button class="tab-btn" data-panel="usage">Item Usage</button>
                <button class="tab-btn" data-panel="specmeta">Spec Meta</button>
                <button class="tab-btn" data-panel="evolution">Meta Evolution</button>
                <button class="tab-btn" id="topPlayersTab" data-panel="players">Top Players</button>
                <button class="tab-btn" data-panel="alltime">All-Time</button>
            </div>

            <div class="panel active" id="panel-overview"></div>
            <div class="panel" id="panel-usage"></div>
            <div class="panel" id="panel-specmeta"></div>
            <div class="panel" id="panel-evolution"></div>
            <div class="panel" id="panel-players"></div>
            <div class="panel" id="panel-alltime"></div>
        </div>`;
    }

    // ════════════════════════════════════════════════════════════════
    // Tab switching
    // ════════════════════════════════════════════════════════════════
    function switchPanel(name) {
        S.tab = name;
        document.querySelectorAll('.stats-page .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.panel === name));
        document.querySelectorAll('.stats-page .panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + name));
        renderActivePanel();
    }

    // Render the currently active panel. Phase B: placeholders. Phase C
    // replaces each branch with a real renderer.
    function renderActivePanel() {
        const panel = document.getElementById('panel-' + S.tab);
        if (!panel) return;
        // Panels are (re)rendered lazily so mode/filter changes always
        // reflect current state.
        switch (S.tab) {
            case 'overview':   renderOverview(panel); break;
            case 'usage':      renderUsage(panel); break;
            case 'specmeta':   renderSpecMeta(panel); break;
            case 'evolution':  renderEvolution(panel); break;
            case 'players':    renderPlayers(panel); break;
            case 'alltime':    renderAllTime(panel); break;
        }
    }

    // ── Phase B placeholder renderers (filled in Phase C) ────────────
    const soon = label => `<p class="empty-note">🚧 ${label} — coming in the next build step.</p>`;
    function renderOverview(p)  { p.innerHTML = soon('Overview charts'); }
    function renderEvolution(p) { p.innerHTML = soon('Meta Evolution'); }
    function renderPlayers(p)   { p.innerHTML = soon('Top Players'); }
    function renderAllTime(p)   { p.innerHTML = soon('All-Time'); }

    // ════════════════════════════════════════════════════════════════
    // Spec Meta — representation tier list + how-it-shifted trend.
    // "Popularity, not power" — see STATS-PAGE-DESIGN.md §3b.
    // ════════════════════════════════════════════════════════════════
    const SPEC_LABEL = { spec: s => s }; // placeholder for any future relabeling
    function specDotStyle(cls) {
        const c = CLASS_COLORS[cls] || 'var(--text-muted)';
        return `background:${c}; color:${c};`;
    }
    // Trend arrow by comparing the last two available data points.
    function trendOf(series) {
        const vals = series.filter(v => v != null);
        if (vals.length < 2) return { cls: 'flat', arrow: '–' };
        const delta = vals[vals.length - 1] - vals[vals.length - 2];
        if (delta > 0.3) return { cls: 'up', arrow: '▲' };
        if (delta < -0.3) return { cls: 'down', arrow: '▼' };
        return { cls: 'flat', arrow: '–' };
    }

    function renderSpecMeta(panel) {
        const data = D();
        if (!data || !data.specMeta) { panel.innerHTML = soon('Spec Meta'); return; }

        const caveat = `
            <div class="caveat-note">
                <span>ℹ️</span>
                <span><strong>Popularity, not power.</strong> These rankings show how many logged/ranked players run each spec — not measured DPS or a "best spec" verdict. A spec optimizers flock to is usually strong, but treat this as pick-rate, same as archon.gg's popularity column.</span>
            </div>`;
        const pveCaveat = `
            <div class="caveat-note pve-only">
                <span>ℹ️</span>
                <span><strong>Mature sample, not day-one logs.</strong> PvE stats reflect a settled, high-volume sample. When a phase has just gone live, early logs are too sparse and skewed toward day-one speedrunners to be representative — so this data may lag brand-new content by several weeks.</span>
            </div>`;

        // ── PvE: tier by representation for the selected phase ────────
        const phase = S.phase || data.meta.latestPhase;
        const pve = data.specMeta.pve[phase];
        let pveHtml = '';
        if (pve) {
            // Build a share-lookup from the previous phase for trend arrows.
            const phaseIds = data.meta.phases.map(p => p.id);
            const prevPhase = phaseIds[phaseIds.indexOf(phase) - 1];
            const prevShare = {};
            if (prevPhase && data.specMeta.pve[prevPhase]) {
                data.specMeta.pve[prevPhase].ranking.forEach(r => prevShare[`${r.class}|${r.spec}`] = r.share);
            }
            const top = pve.ranking.slice(0, 12);
            const maxShare = top.length ? top[0].share : 1;
            const rows = top.map((r, i) => {
                const key = `${r.class}|${r.spec}`;
                const prev = prevShare[key];
                let tr = { cls: 'flat', arrow: '–' };
                if (prev != null) tr = trendOf([prev, r.share]);
                const color = CLASS_COLORS[r.class] || 'var(--text-muted)';
                const barW = Math.round((r.share / maxShare) * 100);
                return `
                <div class="tier-row${i === 0 ? ' rank-1' : ''}">
                    <div class="tier-rank">${i + 1}</div>
                    <div class="tier-dot" style="${specDotStyle(r.class)}"></div>
                    <div class="tier-main">
                        <div class="tier-name">${esc(r.spec)} <span class="tier-class">${esc(r.class)}</span></div>
                        <div class="tier-bar-track"><div class="tier-bar-fill" style="width:${barW}%;background:${color};"></div></div>
                    </div>
                    <div class="tier-pct">${r.share}%</div>
                    <div class="tier-trend ${tr.cls}">${tr.arrow}</div>
                </div>`;
            }).join('');
            pveHtml = `
                <div class="pve-only">
                    <div class="section-label">Tier by representation — Phase ${esc(phase)} (PvE, ${pve.totalPlayersAllSpecs.toLocaleString('en-US')} logged players)</div>
                    <div class="tier-list">${rows}</div>
                    ${renderSpecTrendPve(data, phase)}
                </div>`;
        }

        // ── PvP: tier from latest snapshot share + 21-week trend ──────
        const pvpSeries = data.specMeta.pvp.all;
        let pvpHtml = '';
        if (pvpSeries) {
            const lastIdx = pvpSeries.dates.length - 1;
            const ranked = pvpSeries.specs.map(s => {
                const last = [...s.shareSeries].reverse().find(v => v != null) || 0;
                return { class: s.class, spec: s.spec, share: last, series: s.shareSeries };
            }).sort((a, b) => b.share - a.share).slice(0, 12);
            const maxShare = ranked.length ? ranked[0].share : 1;
            const rows = ranked.map((r, i) => {
                const tr = trendOf(r.series);
                const color = CLASS_COLORS[r.class] || 'var(--text-muted)';
                const barW = Math.round((r.share / maxShare) * 100);
                return `
                <div class="tier-row${i === 0 ? ' rank-1' : ''}">
                    <div class="tier-rank">${i + 1}</div>
                    <div class="tier-dot" style="${specDotStyle(r.class)}"></div>
                    <div class="tier-main">
                        <div class="tier-name">${esc(r.spec)} <span class="tier-class">${esc(r.class)}</span></div>
                        <div class="tier-bar-track"><div class="tier-bar-fill" style="width:${barW}%;background:${color};"></div></div>
                    </div>
                    <div class="tier-pct">${r.share}%</div>
                    <div class="tier-trend ${tr.cls}">${tr.arrow}</div>
                </div>`;
            }).join('');
            pvpHtml = `
                <div class="pvp-only">
                    <div class="section-label">Tier by representation — arena ladder (PvP, ${pvpSeries.dates.length} weekly snapshots)</div>
                    <div class="tier-list">${rows}</div>
                    ${renderSpecTrendPvp(data, ranked)}
                </div>`;
        }

        panel.innerHTML = caveat + pveCaveat + pveHtml + pvpHtml;
    }

    // PvE spec-share trend across phases (top 3 specs of the selected phase).
    function renderSpecTrendPve(data, phase) {
        const phaseIds = data.meta.phases.map(p => p.id);
        const cur = data.specMeta.pve[phase];
        if (!cur) return '';
        const topSpecs = cur.ranking.slice(0, 3).map(r => `${r.class}|${r.spec}`);
        const shareByPhaseSpec = {};
        phaseIds.forEach(pid => {
            const pd = data.specMeta.pve[pid];
            if (!pd) return;
            pd.ranking.forEach(r => { shareByPhaseSpec[`${pid}|${r.class}|${r.spec}`] = r.share; });
        });
        const series = topSpecs.map((key, i) => {
            const [cls, spec] = key.split('|');
            return {
                label: `${spec} ${cls}`,
                color: CHART_COLORS[i],
                cls,
                points: phaseIds.map(pid => {
                    const v = shareByPhaseSpec[`${pid}|${key}`];
                    return v != null ? { v } : null;
                })
            };
        });
        const legend = series.map(s =>
            `<div class="legend-item"><span class="legend-dot" style="background:${s.color};"></span>${esc(s.label)}</div>`
        ).join('');
        return `
            <div class="section-label">How it's shifted — across the phases (PvE)</div>
            <div class="chart-card">
                <div class="chart-head"><h3>Spec share, phase by phase</h3><span class="chart-sub">Phase ${esc(phaseIds[0])} → ${esc(phaseIds[phaseIds.length - 1])}</span></div>
                <div class="chart-svg-wrap">${lineChart(series, phaseIds.map(p => 'P' + p), { aria: 'PvE spec share across phases' })}</div>
                <div class="chart-legend">${legend}</div>
                <p class="chart-note">Only ${phaseIds.length} data points total, so read this as a broad trend — PvP mode gives you a week-by-week pulse instead.</p>
            </div>`;
    }

    // PvP spec-share trend across the 21 weekly snapshots (top 3 specs).
    function renderSpecTrendPvp(data, ranked) {
        const dates = data.specMeta.pvp.all.dates;
        const top = ranked.slice(0, 3);
        const series = top.map((r, i) => ({
            label: `${r.spec} ${r.class}`,
            color: CHART_COLORS[i],
            cls: r.class,
            points: r.series.map(v => v != null ? { v } : null)
        }));
        const legend = series.map(s =>
            `<div class="legend-item"><span class="legend-dot" style="background:${s.color};"></span>${esc(s.label)}</div>`
        ).join('');
        return `
            <div class="section-label">How it's shifted — last ${dates.length} weeks (PvP, top of the ladder)</div>
            <div class="chart-card">
                <div class="chart-head"><h3>Spec share of the top of the ladder</h3><span class="chart-sub">${esc(dates[0])} → ${esc(dates[dates.length - 1])}</span></div>
                <div class="chart-svg-wrap">${lineChart(series, dates, { aria: 'PvP spec share across weekly snapshots' })}</div>
                <div class="chart-legend">${legend}</div>
                <p class="chart-note">21 real weekly snapshots — a steady multi-week climb is a genuine trend, not noise.</p>
            </div>`;
    }

    // ── Spec chip row (Mode → Class → Spec) ─────────────────────────
    // Shown once a class is picked. Tabs that need a specific spec
    // (Item Usage, Meta Evolution) read S.spec; others ignore it.
    function renderSpecChips() {
        const row = document.getElementById('specChips');
        if (!row) return;
        const specs = specsForClass(S.mode, S.class, S.phase);
        if (!S.class || !specs.length) {
            row.classList.add('hidden');
            row.innerHTML = '';
            return;
        }
        // Keep current spec if still valid, else default to first.
        if (!specs.includes(S.spec)) S.spec = specs[0];
        row.classList.remove('hidden');
        const rgb = CLASS_RGB[S.class] || '139,148,158';
        row.innerHTML = specs.map(sp =>
            `<button class="class-chip spec-chip${sp === S.spec ? ' active' : ''}" data-spec="${esc(sp)}" style="--chip-rgb:${rgb};">${esc(sp)}</button>`
        ).join('');
    }

    // ════════════════════════════════════════════════════════════════
    // Item Usage — slot-by-slot popularity bars (mirrors .usage-row in
    // the mockup). PvE reads WCL_DATA, PvP reads PVP_DATA.
    // ════════════════════════════════════════════════════════════════
    const SLOT_ORDER = ['Head', 'Neck', 'Shoulders', 'Back', 'Chest', 'Wrist', 'Hands',
        'Waist', 'Legs', 'Feet', 'Ring', 'Ring 2', 'Trinket', 'Trinket 2',
        'Main Hand', 'Off Hand', 'Two Hand', 'Weapon', 'Ranged', 'Relic'];
    function slotSort(a, b) {
        const ia = SLOT_ORDER.indexOf(a), ib = SLOT_ORDER.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    }

    function renderUsage(panel) {
        if (!S.class) {
            panel.innerHTML = `<p class="empty-note">Pick a class above to see what its top players actually run.</p>`;
            return;
        }
        const specs = specsForClass(S.mode, S.class, S.phase);
        if (!specs.length || !S.spec) {
            panel.innerHTML = `<p class="empty-note">No data recorded for ${esc(S.class)} in this ${S.mode === 'pve' ? 'phase' : 'bracket'} yet.</p>`;
            return;
        }
        const specKey = `${S.class}|${S.spec}`;
        let spec, sub, count;
        if (S.mode === 'pve') {
            const wcl = (typeof WCL_DATA !== 'undefined') ? WCL_DATA : null;
            spec = wcl && wcl.phases[S.phase] && wcl.phases[S.phase][specKey];
            count = spec ? spec.totalPlayers : 0;
            sub = `Phase ${S.phase} · ${count} players analyzed`;
        } else {
            const pvp = (typeof PVP_DATA !== 'undefined') ? PVP_DATA : null;
            spec = pvp && pvp.specs[specKey];
            count = spec ? spec.playerCount : 0;
            sub = `Arena ladder · ${count} players analyzed`;
        }
        if (!spec || !spec.slots) {
            panel.innerHTML = `<p class="empty-note">No gear data for ${esc(S.spec)} ${esc(S.class)} in this ${S.mode === 'pve' ? 'phase' : 'bracket'} yet.</p>`;
            return;
        }

        // Flatten to one "top item per slot" list, plus the runners-up.
        const slots = Object.keys(spec.slots).sort(slotSort);
        const rows = [];
        for (const slot of slots) {
            const items = (spec.slots[slot] || []).slice().sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
            items.forEach((it, idx) => rows.push({ ...it, slot, isTop: idx === 0 }));
        }
        if (!rows.length) {
            panel.innerHTML = `<p class="empty-note">No gear data for this combination yet.</p>`;
            return;
        }

        const list = rows.map(it => {
            const q = qualityOf(it.id, it.quality);
            const qClass = (q === 'epic' || q === 'rare' || q === 'legendary' || q === 'uncommon') ? q : 'epic';
            const pop = it.popularity || 0;
            return `
            <a class="usage-row${it.isTop ? ' is-top' : ''}" data-quality="${qClass}" href="${whLink(it.id)}" target="_blank" rel="noopener" data-wowhead="item=${it.id}&domain=tbc">
                <img class="usage-icon q-${qClass}" src="${iconUrl(it.id)}" alt="" loading="lazy" width="38" height="38">
                <div class="usage-main">
                    <div class="usage-name">${esc(it.name)}</div>
                    <div class="usage-slot">${esc(it.slot)}${it.isTop ? ' <span class="top-pick-badge">🥇 Top pick</span>' : ''}</div>
                    <div class="usage-bar-track"><div class="usage-bar-fill" style="width:${pop}%;"></div></div>
                </div>
                <div class="usage-pct"><div class="pct-num">${pop}%</div><div class="pct-sub">${tierLabel(pop)}</div></div>
            </a>`;
        }).join('');

        panel.innerHTML = `
            <div class="section-label">${esc(S.spec)} ${esc(S.class)} — ${esc(sub)}</div>
            <div class="usage-list">${list}</div>`;
    }

    // ── Highlights strip ────────────────────────────────────────────
    function renderHighlights(mode) {
        const strip = document.getElementById('highlightStrip');
        const data = D();
        if (!strip || !data || !data.highlights) return;
        strip.innerHTML = (data.highlights[mode] || []).map(t => `
            <div class="stat-tile ${t.cls}">
                <div class="stat-label">${esc(t.label)}</div>
                <div class="stat-num">${esc(t.num)}</div>
                <div class="stat-foot">${esc(t.foot)}</div>
            </div>`).join('');
    }

    // ════════════════════════════════════════════════════════════════
    // setGlobalMode — the single control point for the whole page.
    // See STATS-PAGE-DESIGN.md §3d.
    // ════════════════════════════════════════════════════════════════
    function setGlobalMode(mode) {
        S.mode = mode;
        document.body.dataset.mode = mode;
        document.querySelectorAll('#globalModeToggle button').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));

        const isPvp = mode === 'pvp';
        const phaseSeg = document.getElementById('phaseSeg');
        const bracketSeg = document.getElementById('bracketSeg');
        if (phaseSeg) phaseSeg.classList.toggle('hidden', isPvp);
        if (bracketSeg) bracketSeg.classList.toggle('hidden', !isPvp);

        const topTab = document.getElementById('topPlayersTab');
        if (topTab) {
            topTab.style.opacity = isPvp ? '1' : '.35';
            topTab.style.pointerEvents = isPvp ? 'auto' : 'none';
        }
        // Top Players is PvP-only — bounce to Overview if it was open in PvE.
        if (!isPvp && S.tab === 'players') { switchPanel('overview'); }

        renderHighlights(mode);
        renderSpecChips();
        renderActivePanel();
    }

    // ════════════════════════════════════════════════════════════════
    // Init — wires all event listeners. Called by app.js after the shell
    // HTML is injected.
    // ════════════════════════════════════════════════════════════════
    function initStatsPage() {
        applyQueryParams();

        // Global mode toggle
        const toggle = document.getElementById('globalModeToggle');
        if (toggle) toggle.addEventListener('click', e => {
            const btn = e.target.closest('button');
            if (btn) setGlobalMode(btn.dataset.mode);
        });

        // Class chips — also drive the class-tint atmosphere via body[data-class]
        const chips = document.getElementById('classChips');
        if (chips) chips.addEventListener('click', e => {
            const btn = e.target.closest('.class-chip');
            if (!btn) return;
            document.querySelectorAll('#classChips .class-chip').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            S.class = btn.dataset.class || '';
            S.spec = '';
            document.body.dataset.class = S.class || '';
            renderSpecChips();
            renderActivePanel();
        });

        // Spec chips (Mode → Class → Spec)
        const specChips = document.getElementById('specChips');
        if (specChips) specChips.addEventListener('click', e => {
            const btn = e.target.closest('.spec-chip');
            if (!btn) return;
            document.querySelectorAll('#specChips .spec-chip').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            S.spec = btn.dataset.spec || '';
            renderActivePanel();
        });

        // Phase / bracket segmented controls
        const phaseSeg = document.getElementById('phaseSeg');
        if (phaseSeg) phaseSeg.addEventListener('click', e => {
            const btn = e.target.closest('button');
            if (!btn) return;
            [...phaseSeg.children].forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            S.phase = btn.dataset.phase;
            renderSpecChips();
            renderActivePanel();
        });
        const bracketSeg = document.getElementById('bracketSeg');
        if (bracketSeg) bracketSeg.addEventListener('click', e => {
            const btn = e.target.closest('button');
            if (!btn) return;
            [...bracketSeg.children].forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            S.bracket = btn.dataset.bracket;
            renderActivePanel();
        });

        // Tabs
        const tabBar = document.getElementById('statsTabBar');
        if (tabBar) tabBar.addEventListener('click', e => {
            const btn = e.target.closest('.tab-btn');
            if (!btn || btn.style.pointerEvents === 'none') return;
            switchPanel(btn.dataset.panel);
        });

        // Reflect restored state into the controls, then render.
        syncControlsToState();
        setGlobalMode(S.mode);
        if (S.tab && S.tab !== 'overview') switchPanel(S.tab);
    }

    // ── Query-param parsing: /stats?mode=pvp&class=rogue&spec=subtlety... ──
    function applyQueryParams() {
        const q = new URLSearchParams(location.search);
        const data = D();
        const mode = q.get('mode');
        if (mode === 'pve' || mode === 'pvp') S.mode = mode;
        const cls = q.get('class');
        if (cls) {
            const match = CLASS_ORDER.find(c => c.toLowerCase() === cls.toLowerCase());
            if (match) S.class = match;
        }
        const spec = q.get('spec');
        if (spec) S.spec = spec;
        const phase = q.get('phase');
        if (phase) S.phase = phase;
        const bracket = q.get('bracket');
        if (bracket) S.bracket = bracket;
        const view = q.get('view');
        const validTabs = ['overview', 'usage', 'specmeta', 'evolution', 'players', 'alltime'];
        if (view && validTabs.includes(view)) S.tab = view;
        // Default phase = latest.
        if (!S.phase && data) S.phase = data.meta.latestPhase;
    }

    function syncControlsToState() {
        // Class chip
        document.querySelectorAll('.stats-page .class-chip').forEach(c =>
            c.classList.toggle('active', (c.dataset.class || '') === S.class));
        if (S.class) document.body.dataset.class = S.class;
        // Phase
        document.querySelectorAll('#phaseSeg button').forEach(b =>
            b.classList.toggle('active', b.dataset.phase === S.phase));
        // Bracket
        document.querySelectorAll('#bracketSeg button').forEach(b =>
            b.classList.toggle('active', b.dataset.bracket === S.bracket));
    }

    // ── Expose ──────────────────────────────────────────────────────
    window.renderStatsPageShell = renderStatsPageShell;
    window.initStatsPage = initStatsPage;

    // Shared helpers exposed for the Phase C renderers (kept on a namespace
    // so the module internals stay private but testable).
    window.StatsPage = {
        state: S,
        CLASS_COLORS, CLASS_RGB, CLASS_ABBR, CLASS_ORDER,
        esc,
        get data() { return D(); }
    };
})();
