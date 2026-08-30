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
        class: '',          // '' = nothing drilled into yet
        spec: '',
        phase: null,        // string phase id, e.g. '3'
        bracket: '2v2',
        tab: 'overview',
        _pickerOpen: false  // spec-picker "Change" expanded? (selected mode)
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

    // ── Line-chart series palette (shared by every ECharts line chart) ──
    // Charts themselves are built with Apache ECharts via window.ChartHelpers
    // (see CHART-UPGRADE-GUIDE.md) — hand-rolled SVG is no longer used.
    const CHART_COLORS = ['#a97e38', '#7c5cff', '#3d8fc9', '#4cd97b', '#ef4d4d'];

    // ════════════════════════════════════════════════════════════════
    // Shell HTML — mirrors stats-page-mockup.html (minus its own header /
    // footer / mockup banner; the app's global header + footer wrap this).
    // Panels are filled by the render functions below.
    // ════════════════════════════════════════════════════════════════
    function renderStatsPageShell() {
        const data = D();
        const phases = data ? data.meta.phases : [{ id: '1', label: 'P1' }];
        const brackets = data ? data.meta.brackets : ['2v2', '3v3'];

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
                <p class="page-freshness" id="statsFreshness"></p>
            </div>

            <div class="global-mode-wrap">
                <div class="global-mode-row">
                    <div class="mode-toggle mode-toggle-hero" id="globalModeToggle">
                        <button class="active" data-mode="pve">⚔️ PvE</button>
                        <button data-mode="pvp">🏆 PvP</button>
                    </div>
                    <a class="kofi-share-btn stats-kofi-btn" href="https://ko-fi.com/vexxan" target="_blank" rel="noopener">
                        <img src="/img/kofi_symbol.svg" alt="" width="16" height="13" loading="lazy" decoding="async">
                        <span>Buy me a coffee</span>
                    </a>
                </div>
                <span class="global-mode-hint">Sets the mode for the whole page — highlights, charts and tabs below all follow this.</span>
            </div>

            <div class="highlight-strip" id="highlightStrip"></div>

            <div class="filter-bar">
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
        syncUrl();
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

    // ════════════════════════════════════════════════════════════════
    // All-Time — records that span every phase / snapshot recorded so far.
    //   PvE: most-used gear for the picked spec + most dominant specs ever.
    //   PvP: highest-rated specs ever + most-used arena gear all-time.
    // Reads STATS_DATA.allTime. See mockup #panel-alltime.
    // ════════════════════════════════════════════════════════════════
    function atItem(rank, name, sub, value) {
        return `
        <div class="alltime-item">
            <div class="at-rank">${rank}</div>
            <div class="at-main"><div class="at-name">${name}</div><div class="at-sub">${sub}</div></div>
            <div class="at-value">${esc(value)}</div>
        </div>`;
    }
    function phasePills(phaseNums) {
        return (phaseNums || []).map(p => `<span class="phase-pill">P${p}</span>`).join('');
    }
    function renderAllTime(panel) {
        const data = D();
        if (!data || !data.allTime) { panel.innerHTML = soon('All-Time'); return; }
        const at = data.allTime;

        // ── PvE ──────────────────────────────────────────────────────
        let pveGearCard = '';
        if (S.class) {
            const specs = specsForClass('pve', S.class, S.phase);
            const spec = (S.spec && specs.includes(S.spec)) ? S.spec : specs[0];
            const key = spec ? `${S.class}|${spec}` : null;
            const rec = key && at.pve[key];
            if (rec && rec.mostUsedItems.length) {
                const rows = rec.mostUsedItems.slice(0, 5).map((it, i) => {
                    const n = it.phasesSeenIn.length;
                    const sub = `${phasePills(it.phasesSeenIn)}seen in ${n} phase${n === 1 ? '' : 's'}`;
                    const name = `<a class="at-name-link" href="${whLink(it.id)}" target="_blank" rel="noopener">${esc(it.name)}</a>`;
                    return atItem(i + 1, name, sub, `avg ${it.avgPopularity}%`);
                }).join('');
                pveGearCard = `<div class="alltime-card"><h3>🏅 Most used gear — ${esc(spec)} ${esc(S.class)}</h3>${rows}</div>`;
            }
        }
        if (!pveGearCard) {
            pveGearCard = `<div class="alltime-card"><h3>🏅 Most used gear — all-time</h3><p class="empty-note" style="margin:0;">Pick a class and spec above to see its longest-standing BiS gear across every phase.</p></div>`;
        }
        const totalPhases = data.meta.phases.length;
        const specRows = (at.pveSpecs || []).slice(0, 5).map((s, i) => {
            const color = CLASS_COLORS[s.class] || 'var(--text-muted)';
            let sub;
            if (s.leads > 0) sub = `led the pick-rate in ${s.leads} of ${totalPhases} phase${totalPhases === 1 ? '' : 's'}`;
            else sub = 'never led, but always ranked';
            const name = `<span style="color:${color};">${esc(s.spec)} ${esc(s.class)}</span>`;
            return atItem(i + 1, name, sub, `avg ${s.avgShare}%`);
        }).join('');
        const pveSpecCard = specRows ? `<div class="alltime-card"><h3>👑 Most dominant spec — all phases</h3>${specRows}</div>` : '';

        // ── PvP ──────────────────────────────────────────────────────
        const ratedRows = (at.pvp.highestRatedSpecs || []).slice(0, 5).map((s, i) => {
            const color = CLASS_COLORS[s.class] || 'var(--text-muted)';
            const name = `<span style="color:${color};">${esc(s.spec)} ${esc(s.class)} — ${esc(s.bracket)}</span>`;
            return atItem(i + 1, name, `peak on ${esc(s.dateOfPeak)}`, s.peakRating.toLocaleString('en-US'));
        }).join('');
        const pvpRatedCard = ratedRows ? `<div class="alltime-card"><h3>⚡ Highest rated specs ever recorded</h3>${ratedRows}</div>` : '';

        const gearRows = (at.pvp.mostUsedGear || []).slice(0, 5).map((it, i) => {
            const name = `<a class="at-name-link" href="${whLink(it.id)}" target="_blank" rel="noopener">${esc(it.name)}</a>`;
            return atItem(i + 1, name, `tracked since ${esc(it.since)}`, `avg ${it.avgPopularity}%`);
        }).join('');
        const pvpGearCard = gearRows ? `<div class="alltime-card"><h3>🏅 Most used arena gear — all-time</h3>${gearRows}</div>` : '';

        panel.innerHTML = `
            <div class="section-label">Across every ${S.mode === 'pvp' ? 'weekly snapshot' : 'phase'} recorded so far</div>
            <div class="alltime-grid">
                <div class="pve-only">${pveGearCard}${pveSpecCard}</div>
                <div class="pvp-only">${pvpRatedCard}${pvpGearCard}</div>
            </div>`;
    }

    // ════════════════════════════════════════════════════════════════
    // Top Players — PvP-only arena ladder, top-20 per class|spec|bracket.
    // Reads STATS_DATA.topPlayers (already aggregated in build-stats-data).
    // See STATS-PAGE-DESIGN.md §3 / mockup #panel-players.
    // ════════════════════════════════════════════════════════════════
    function renderPlayers(panel) {
        const data = D();
        if (!data || !data.topPlayers) { panel.innerHTML = soon('Top Players'); return; }
        if (S.mode !== 'pvp') {
            panel.innerHTML = `<p class="empty-note">Top Players is a PvP-only view — switch to 🏆 PvP mode above.</p>`;
            return;
        }
        const bar = specPickerBarHtml('players');
        const finish = html => { panel.innerHTML = bar + html; wireSpecPicker(panel, 'players'); };
        if (!S.class || !S.spec) {
            finish(`<p class="empty-note">Pick a class and spec above — or click into one from the Overview charts — to see the top of the arena ladder.</p>`);
            return;
        }
        const specs = specsForClass('pvp', S.class, S.phase);
        if (!specs.length || !specs.includes(S.spec)) {
            finish(`<p class="empty-note">No arena ladder data recorded for ${esc(S.spec || S.class)} yet.</p>`);
            return;
        }

        const key = `${S.class}|${S.spec}|${S.bracket}`;
        const group = data.topPlayers[key];
        if (!group || !group.players.length) {
            finish(`<p class="empty-note">No ${esc(S.bracket)} ladder entries for ${esc(S.spec)} ${esc(S.class)} in this snapshot.</p>`);
            return;
        }

        const players = group.players;
        const maxWr = Math.max(...players.map(p => p.winrate || 0), 1);
        const rows = players.map(p => {
            const rankCls = p.rank <= 3 ? ` rank-${p.rank}` : '';
            const wr = p.winrate != null ? Math.round(p.winrate) : null;
            const wrPct = wr != null ? Math.round((p.winrate / maxWr) * 100) : 0;
            const region = p.region ? p.region.toUpperCase() : '';
            const meta = [p.server, p.race, region].filter(Boolean).join(' · ');
            return `
            <div class="lb-row${rankCls}">
                <div class="lb-rank">${p.rank}</div>
                <div class="lb-player">
                    <div class="lb-name">${esc(p.name)}</div>
                    <div class="lb-meta">${esc(meta)}</div>
                </div>
                <div class="lb-rating">${p.rating != null ? p.rating.toLocaleString('en-US') : '—'}</div>
                <div class="lb-winrate">
                    <div class="lb-winrate-track"><div class="lb-winrate-fill" style="width:${wrPct}%;"></div></div>
                    <div class="lb-winrate-num">${wr != null ? wr + '% WR' : '—'}</div>
                </div>
            </div>`;
        }).join('');

        const scraped = group.scrapedAt ? group.scrapedAt.slice(0, 10) : null;
        finish(`
            <div class="pvp-only">
                <div class="section-label">Top ${players.length} — ${esc(S.spec)} ${esc(S.class)} · ${esc(S.bracket)} · EU+US combined</div>
                <div class="lb-table">${rows}</div>
                ${scraped ? `<p class="chart-note">Arena ladder from Ironforge.pro, scraped ${esc(scraped)}. Ratings and win-rates reflect that snapshot — the ladder refreshes weekly.</p>` : ''}
            </div>`);
    }

    // ════════════════════════════════════════════════════════════════
    // Overview — 4 interactive ECharts (CHART-UPGRADE-GUIDE.md §2, §4).
    // A fast "pulse check" dashboard that always follows the global mode.
    //   A. Class Stacking      — stacked columns (PvE) / stacked area (PvP)
    //   B. Biggest Movers      — diverging bar around a zero line
    //   C. Meta Concentration  — single-series line (Herfindahl index)
    //   D. Cross-Phase Survivors — horizontal bar, click → mini-line ⛶
    // Charts are built via window.ChartHelpers (shared ECharts layer).
    // ════════════════════════════════════════════════════════════════
    function renderOverview(panel) {
        const data = D();
        const CH = window.ChartHelpers;
        if (!data || !data.overview || !CH) { panel.innerHTML = soon('Overview charts'); return; }

        const mode = S.mode;
        const isPvp = mode === 'pvp';
        // Per-mode survivor slot filter state.
        if (!S._ovSlot) S._ovSlot = 'all';
        const slots = (data.overview.survivors.slots || []);

        panel.innerHTML = `
            <p class="overview-intro">A fast pulse check — these four charts always follow the ${isPvp ? '🏆 PvP' : '⚔️ PvE'} mode toggle above. Hover for exact numbers, click a legend entry to isolate a series, and press ⛶ to expand any chart to fullscreen.</p>
            <div class="overview-grid">
                ${overviewCard('ovStack', '🧬 Class Stacking', (isPvp ? 'Share of the arena ladder per class, week by week' : "Share of logged raiders per class, phase by phase") + ' · click a class → its item usage', 'ov-full', 'stack')}
                ${overviewCard('ovMovers', '📈 Biggest Movers', (isPvp ? 'This snapshot vs. the previous one' : 'Latest phase vs. the one before') + ' · click a bar → item usage', 'ov-half', 'movers')}
                ${overviewCard('ovConc', '🌡️ How Solved Is The Meta?', 'Higher = a few specs dominate. Lower = wide open.', 'ov-half', 'conc')}
                <div class="ov-card ov-full">
                    <div class="chart-head">
                        <div><h3>🏆 Cross-Phase Survivors</h3><span class="chart-sub">Gear that stayed BiS-tier across ${isPvp ? 'multiple weeks' : 'multiple phases'} — click a bar to see its popularity trend</span></div>
                        <div class="chart-head-actions">
                            <select class="ov-slot-select" id="ovSurvivorSlot">
                                <option value="all"${S._ovSlot === 'all' ? ' selected' : ''}>All slots</option>
                                ${slots.map(s => `<option value="${esc(s)}"${S._ovSlot === s ? ' selected' : ''}>${esc(s)}</option>`).join('')}
                            </select>
                            <button class="chart-expand-btn" data-fs="survivors">⛶ Fullscreen</button>
                        </div>
                    </div>
                    <div class="chart-canvas chart-canvas-tall" id="ovSurvivors"></div>
                </div>
            </div>`;

        // ── Build the four option factories (closures capture `data`/`mode`) ──
        const stackOpt = () => stackOption(data, mode, CH);
        const moversOpt = () => moversOption(data, mode, CH);
        const concOpt = () => concentrationOption(data, mode, CH);
        const survivorRows = () => survivorData(data, mode, S._ovSlot);
        const survivorsOpt = () => survivorsOption(survivorRows(), CH);

        CH.initChart('ovConc', concOpt);
        CH.initChart('ovSurvivors', survivorsOpt, inst => {
            inst.off('click');
            inst.on('click', params => {
                const rows = survivorRows();
                const row = rows[params.dataIndex];
                if (row) openSurvivorTrend(row, CH);
            });
        });

        // ── Drill-down: click an aggregated mark → goToSpec (NAV §2) ──
        // Class Stacking: click a segment/area → that class's top spec.
        // (Legend clicks still isolate visually — that's a separate event.)
        CH.initChart('ovStack', stackOpt, inst => {
            inst.off('click');
            inst.on('click', params => {
                if (params.componentType !== 'series') return;
                const cls = params.seriesName;
                const rec = data.overview.classStacking[mode].classes[cls];
                const spec = rec && rec.topSpec;
                if (cls && spec) goToSpec(cls, spec);
            });
        });
        // Biggest Movers: click a bar → that spec.
        CH.initChart('ovMovers', moversOpt, inst => {
            inst.off('click');
            inst.on('click', params => {
                const row = moversData(data, mode)[params.dataIndex];
                if (row && row.cls && row.spec) goToSpec(row.cls, row.spec);
            });
        });

        // ── Wire fullscreen buttons + slot filter ────────────────────
        panel.querySelectorAll('.chart-expand-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                switch (btn.dataset.fs) {
                    case 'stack':     CH.openFullscreen('Class Stacking', stackOpt); break;
                    case 'movers':    CH.openFullscreen('Biggest Movers', moversOpt); break;
                    case 'conc':      CH.openFullscreen('How Solved Is The Meta?', concOpt); break;
                    case 'survivors': CH.openFullscreen('Cross-Phase Survivors', survivorsOpt); break;
                }
            });
        });
        const slotSel = panel.querySelector('#ovSurvivorSlot');
        if (slotSel) slotSel.addEventListener('change', e => {
            S._ovSlot = e.target.value;
            CH.initChart('ovSurvivors', () => survivorsOption(survivorData(data, mode, S._ovSlot), CH), inst => {
                inst.off('click');
                inst.on('click', params => {
                    const rows = survivorData(data, mode, S._ovSlot);
                    const row = rows[params.dataIndex];
                    if (row) openSurvivorTrend(row, CH);
                });
            });
        });
    }

    // A card shell whose canvas is filled by an ECharts instance.
    function overviewCard(canvasId, title, sub, spanClass, fsKey) {
        return `
            <div class="ov-card ${spanClass}">
                <div class="chart-head">
                    <div><h3>${title}</h3><span class="chart-sub">${esc(sub)}</span></div>
                    <div class="chart-head-actions">
                        <button class="chart-expand-btn" data-fs="${fsKey}">⛶ Fullscreen</button>
                    </div>
                </div>
                <div class="chart-canvas" id="${canvasId}"></div>
            </div>`;
    }

    // ── A. Class Stacking ────────────────────────────────────────────
    function stackOption(data, mode, CH) {
        const src = data.overview.classStacking[mode];
        const labels = src.labels;
        const classes = CH.CLASS_ORDER.filter(c => src.classes[c]);
        const isPvp = mode === 'pvp';
        const series = classes.map((cls, i) => ({
            name: cls,
            type: isPvp ? 'line' : 'bar',
            stack: 'total',
            data: src.classes[cls].shares,
            ...(isPvp ? {
                smooth: true, symbol: 'none', lineStyle: { width: 0 },
                areaStyle: { color: CH.CLASS_COLORS[cls], opacity: 0.85 },
                emphasis: { focus: 'series' }, cursor: 'pointer'
            } : {
                barMaxWidth: 26,
                itemStyle: {
                    color: CH.CLASS_COLORS[cls], borderColor: CH.SURFACE, borderWidth: 2,
                    borderRadius: i === classes.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]
                },
                emphasis: { focus: 'series' }, cursor: 'pointer'
            }),
            animationDelay: i * 50
        }));
        return {
            backgroundColor: 'transparent',
            color: classes.map(c => CH.CLASS_COLORS[c]),
            grid: { left: 38, right: 12, top: 34, bottom: 56 },
            legend: CH.baseLegend('rect'),
            xAxis: CH.baseCategoryAxis(labels, !isPvp),
            yAxis: CH.baseValueAxis({ max: 100, formatter: '{value}%' }),
            tooltip: CH.baseTooltip('shadow', '%'),
            toolbox: CH.baseToolbox(),
            dataZoom: [{ type: 'inside' }],
            animationEasing: 'cubicOut', animationDuration: 900,
            series
        };
    }

    // ── B. Biggest Movers (diverging bar around zero) ────────────────
    function moversData(data, mode) {
        const raw = data.overview.movers[mode] || [];
        // Δ in raw player counts → sort by absolute movement, keep the top 12.
        return raw.map(m => ({ name: `${m.spec} ${m.class}`, cls: m.class, spec: m.spec, delta: m.curr - m.prev }))
            .filter(m => m.delta !== 0)
            .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
            .slice(0, 12)
            .sort((a, b) => a.delta - b.delta); // ascending so bars read bottom-negative → top-positive
    }
    function moversOption(data, mode, CH) {
        const rows = moversData(data, mode);
        return {
            backgroundColor: 'transparent',
            grid: { left: 8, right: 20, top: 10, bottom: 24, containLabel: true },
            xAxis: {
                type: 'value',
                splitLine: { lineStyle: { color: CH.SPLIT_LINE } },
                axisLabel: { color: CH.TEXT_SECONDARY, fontSize: 11 }
            },
            yAxis: {
                type: 'category',
                data: rows.map(r => r.name),
                axisLine: { lineStyle: { color: CH.AXIS_LINE } },
                axisTick: { show: false },
                axisLabel: { color: CH.TEXT_SECONDARY, fontSize: 11 }
            },
            tooltip: {
                trigger: 'item', className: 'ec-tooltip',
                formatter: p => {
                    const sign = p.value > 0 ? '+' : '';
                    const col = p.value >= 0 ? '#4cd97b' : '#ef4d4d';
                    return `<div style="font-size:12px;color:#e6edf3;"><span style="display:inline-block;width:10px;height:2px;background:${col};border-radius:2px;margin-right:6px;vertical-align:middle;"></span><strong>${sign}${p.value}</strong> <span style="color:#8b949e;">${escHtml(p.name)}</span></div>`;
                }
            },
            series: [{
                type: 'bar', data: rows.map(r => r.delta), barMaxWidth: 18,
                cursor: 'pointer',
                itemStyle: {
                    color: p => p.value >= 0 ? '#4cd97b' : '#ef4d4d',
                    borderRadius: 3
                },
                markLine: {
                    silent: true, symbol: 'none',
                    lineStyle: { color: 'rgba(255,255,255,.25)', type: 'solid', width: 1 },
                    data: [{ xAxis: 0 }], label: { show: false }
                },
                animationDelay: (i) => i * 40
            }],
            animationEasing: 'cubicOut', animationDuration: 800
        };
    }

    // ── C. Meta Concentration Index (single-series line) ─────────────
    function concentrationOption(data, mode, CH) {
        const src = data.overview.concentration[mode] || [];
        const labels = src.map(p => p.date);
        const values = src.map(p => p.score);
        return {
            backgroundColor: 'transparent',
            grid: { left: 38, right: 16, top: 34, bottom: 30 },
            xAxis: CH.baseCategoryAxis(labels, false),
            yAxis: CH.baseValueAxis({ formatter: '{value}' }),
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'line', lineStyle: { color: 'rgba(255,255,255,.25)' } },
                className: 'ec-tooltip',
                formatter: params => {
                    const p = params[0];
                    const rec = src[p.dataIndex];
                    const top = (rec && rec.top3 || []).map(([n, pct]) =>
                        `<div style="font-size:11px;color:#8b949e;padding:1px 0;">${escHtml(n)} — <strong style="color:#e6edf3;">${pct}%</strong></div>`).join('');
                    return `<div style="font-weight:700;font-size:12px;color:#e6edf3;margin-bottom:4px;">${escHtml(p.axisValueLabel)}</div>
                        <div style="font-size:12px;color:#e6edf3;margin-bottom:4px;">Index <strong style="color:#a97e38;">${p.value}</strong></div>${top}`;
                }
            },
            toolbox: CH.baseToolbox(),
            dataZoom: [{ type: 'inside' }],
            series: [{
                type: 'line', data: values, smooth: true, symbol: 'circle', symbolSize: 8,
                lineStyle: { width: 2, color: '#a97e38' },
                itemStyle: { color: '#a97e38', borderColor: CH.SURFACE, borderWidth: 2 },
                areaStyle: { color: '#a97e38', opacity: 0.1 },
                emphasis: { focus: 'series', lineStyle: { width: 3 } }
            }],
            animationEasing: 'cubicOut', animationDuration: 1000
        };
    }

    // ── D. Cross-Phase Survivors ─────────────────────────────────────
    function survivorData(data, mode, slotFilter) {
        let rows = data.overview.survivors[mode] || [];
        if (slotFilter && slotFilter !== 'all') rows = rows.filter(r => r.slot === slotFilter);
        // Rank by how many periods it survived, then by average popularity.
        return rows.slice(0, 14).map(r => ({
            name: r.name, slot: r.slot, quality: r.quality,
            periods: r.series.length,
            series: r.series,
            avg: Math.round(r.series.reduce((s, [, v]) => s + v, 0) / (r.series.length || 1))
        }));
    }
    const QUALITY_HEX = { poor: '#9d9d9d', common: '#ffffff', uncommon: '#1eff00', rare: '#0070dd', epic: '#a335ee', legendary: '#ff8000' };
    function survivorsOption(rows, CH) {
        // Reverse so the strongest survivor sits at the top of a horizontal bar.
        const ordered = rows.slice().reverse();
        return {
            backgroundColor: 'transparent',
            grid: { left: 8, right: 28, top: 8, bottom: 20, containLabel: true },
            xAxis: {
                type: 'value', minInterval: 1,
                splitLine: { lineStyle: { color: CH.SPLIT_LINE } },
                axisLabel: { color: CH.TEXT_SECONDARY, fontSize: 11 }
            },
            yAxis: {
                type: 'category', data: ordered.map(r => r.name),
                axisLine: { lineStyle: { color: CH.AXIS_LINE } },
                axisTick: { show: false },
                axisLabel: { color: CH.TEXT_SECONDARY, fontSize: 11, width: 150, overflow: 'truncate' }
            },
            tooltip: {
                trigger: 'item', className: 'ec-tooltip',
                formatter: p => {
                    const r = ordered[p.dataIndex];
                    return `<div style="font-size:12px;color:#e6edf3;font-weight:700;margin-bottom:3px;">${escHtml(r.name)}</div>
                        <div style="font-size:11px;color:#8b949e;">${escHtml(r.slot)} · survived <strong style="color:#e6edf3;">${r.periods}</strong> periods · avg <strong style="color:#e6edf3;">${r.avg}%</strong></div>
                        <div style="font-size:11px;color:#a97e38;margin-top:3px;">Click to see its popularity trend →</div>`;
                }
            },
            series: [{
                type: 'bar', data: ordered.map(r => r.periods), barMaxWidth: 16,
                itemStyle: { color: p => QUALITY_HEX[ordered[p.dataIndex].quality] || '#a335ee', borderRadius: [0, 3, 3, 0] },
                animationDelay: (i) => i * 30
            }],
            animationEasing: 'cubicOut', animationDuration: 800
        };
    }
    // Fullscreen mini-line for one survivor's popularity over time.
    function openSurvivorTrend(row, CH) {
        CH.openFullscreen(`${row.name} — popularity over time`, () => ({
            backgroundColor: 'transparent',
            grid: { left: 38, right: 20, top: 20, bottom: 40 },
            xAxis: CH.baseCategoryAxis(row.series.map(([l]) => l), false),
            yAxis: CH.baseValueAxis({ max: 100, formatter: '{value}%' }),
            tooltip: CH.baseTooltip('line', '%'),
            series: [{
                name: row.name, type: 'line', data: row.series.map(([, v]) => v),
                smooth: true, symbol: 'circle', symbolSize: 9,
                lineStyle: { width: 2, color: '#3d8fc9' },
                itemStyle: { color: '#3d8fc9', borderColor: CH.SURFACE, borderWidth: 2 },
                areaStyle: { color: '#3d8fc9', opacity: 0.1 }
            }],
            animationDuration: 700
        }));
    }
    const escHtml = s => esc(s);

    // ── Shared multi-series line chart (Spec Meta + Meta Evolution) ──
    // series: [{ name, color, data:[num|null] }], xLabels: []. Returns an
    // ECharts option following CHART-UPGRADE-GUIDE §4 (2px lines, ≥8px
    // ringed markers, 10% area, legend only when 2+ series).
    function multiLineOption(series, xLabels, opts) {
        opts = opts || {};
        const CH = window.ChartHelpers;
        const multi = series.length > 1;
        const ecSeries = series.map(s => ({
            name: s.name,
            type: 'line',
            data: s.data,
            smooth: true,
            connectNulls: true,
            symbol: 'circle',
            symbolSize: 8,
            lineStyle: { width: 2, color: s.color },
            itemStyle: { color: s.color, borderColor: CH.SURFACE, borderWidth: 2 },
            areaStyle: multi ? undefined : { color: s.color, opacity: 0.1 },
            emphasis: { focus: 'series', lineStyle: { width: 3 } }
        }));
        return {
            backgroundColor: 'transparent',
            color: series.map(s => s.color),
            grid: { left: 40, right: 18, top: 34, bottom: multi ? 56 : 30 },
            legend: multi ? CH.baseLegend('line') : { show: false },
            xAxis: CH.baseCategoryAxis(xLabels, false),
            yAxis: CH.baseValueAxis({ formatter: '{value}%', min: opts.min, max: opts.max }),
            tooltip: CH.baseTooltip('line', '%'),
            toolbox: CH.baseToolbox(),
            dataZoom: [{ type: 'inside' }],
            animationEasing: 'cubicOut', animationDuration: 1000,
            series: ecSeries
        };
    }

    // Render a titled chart-card whose canvas is filled by an ECharts
    // multi-line instance, with a working ⛶ fullscreen button. `id` must
    // be unique on the page. Returns the card HTML; call wireLineChart()
    // after the panel's innerHTML is set to actually init the chart.
    let _lineChartRegistry = [];
    function lineChartCard(id, title, sub, series, xLabels, note, opts) {
        _lineChartRegistry.push({ id, title, series, xLabels, opts: opts || {} });
        return `
            <div class="chart-card">
                <div class="chart-head">
                    <div><h3>${esc(title)}</h3><span class="chart-sub">${esc(sub)}</span></div>
                    <div class="chart-head-actions"><button class="chart-expand-btn" data-line-fs="${id}">⛶ Fullscreen</button></div>
                </div>
                <div class="chart-canvas" id="${id}"></div>
                ${note ? `<p class="chart-note">${note}</p>` : ''}
            </div>`;
    }
    // Init every line-chart card queued since the last call, and wire their
    // fullscreen buttons. Call once after panel.innerHTML is set.
    function wireLineCharts(panel) {
        const CH = window.ChartHelpers;
        if (!CH) return;
        const queued = _lineChartRegistry;
        _lineChartRegistry = [];
        queued.forEach(q => {
            const optFn = () => multiLineOption(q.series, q.xLabels, q.opts);
            CH.initChart(q.id, optFn);
            const btn = panel.querySelector(`[data-line-fs="${q.id}"]`);
            if (btn) btn.addEventListener('click', () => CH.openFullscreen(q.title, optFn));
        });
    }

    // ════════════════════════════════════════════════════════════════
    // Meta Evolution — how a slot's item popularity shifts over time.
    // PvE: Early/Mid/Late within a phase (WCL_COHORTS). PvP: week-by-week
    // (STATS_DATA.metaEvolution.pvp). See STATS-PAGE-DESIGN.md §5.
    // ════════════════════════════════════════════════════════════════
    function renderEvolution(panel) {
        const bar = specPickerBarHtml('evolution');
        panel.innerHTML = bar + `<div id="evoBody"></div>`;
        wireSpecPicker(panel, 'evolution');
        const body = panel.querySelector('#evoBody');
        if (!S.class || !S.spec) {
            body.innerHTML = `<p class="empty-note">Pick a class and spec above — or click into one from the Overview charts — to see how its gear meta shifted over time.</p>`;
            return;
        }
        const specs = specsForClass(S.mode, S.class, S.phase);
        if (!specs.length || !specs.includes(S.spec)) {
            body.innerHTML = `<p class="empty-note">No data recorded for ${esc(S.spec || S.class)} in this ${S.mode === 'pve' ? 'phase' : 'bracket'} yet.</p>`;
            return;
        }
        const specKey = `${S.class}|${S.spec}`;
        if (S.mode === 'pve') renderEvolutionPve(panel, body, specKey);
        else renderEvolutionPvp(panel, body, specKey);
    }

    function evoSlotSelect(slots, current) {
        const opts = slots.map(s => `<option value="${esc(s)}"${s === current ? ' selected' : ''}>${esc(s)}</option>`).join('');
        return `<select class="ov-slot-select" id="evoSlotSelect">${opts}</select>`;
    }

    function renderEvolutionPve(panel, body, specKey) {
        const coh = (typeof WCL_COHORTS !== 'undefined') ? WCL_COHORTS : null;
        const spec = coh && coh.phases[S.phase] && coh.phases[S.phase][specKey];
        if (!spec) {
            body.innerHTML = `<div class="pve-only"><p class="empty-note">No cohort data for ${esc(S.spec)} ${esc(S.class)} in Phase ${esc(S.phase)} yet.</p></div>`;
            return;
        }
        const stages = ['early', 'mid', 'late'];
        const late = spec.late || spec.mid || spec.early;
        const slots = Object.keys(late.slots).sort(slotSort);
        if (!S.metaEvoSlot || !slots.includes(S.metaEvoSlot)) S.metaEvoSlot = slots[0];
        const slot = S.metaEvoSlot;

        const stageItems = {};
        stages.forEach(st => {
            stageItems[st] = {};
            const sd = spec[st];
            if (sd && sd.slots[slot]) sd.slots[slot].forEach(it => stageItems[st][it.id] = it.popularity);
        });
        const topItems = (late.slots[slot] || []).slice().sort((a, b) => b.popularity - a.popularity).slice(0, 3);
        const series = topItems.map((it, i) => ({
            name: it.name,
            color: CHART_COLORS[i],
            data: stages.map(st => stageItems[st][it.id] != null ? stageItems[st][it.id] : null)
        }));

        body.innerHTML = `
            <div class="pve-only">
                <div class="section-label">How the meta shifted this phase</div>
                <div class="evo-toolbar">${evoSlotSelect(slots, slot)}</div>
                ${lineChartCard('evoPve', `${slot} slot — ${S.spec} ${S.class}`,
                    `Early → Mid → Late, Phase ${S.phase}`, series, ['Early', 'Mid', 'Late'],
                    `Early/Mid/Late split the phase's logs into equal-count thirds by parse date — it captures how gearing shifted <em>within</em> the phase as more raiders cleared content.`)}
            </div>`;
        wireLineCharts(body);
        wireEvoSlotSelect(panel);
    }

    function renderEvolutionPvp(panel, body, specKey) {
        const data = D();
        const evo = data && data.metaEvolution && data.metaEvolution.pvp[specKey];
        if (!evo) {
            body.innerHTML = `<div class="pvp-only"><p class="empty-note">No weekly arena history for ${esc(S.spec)} ${esc(S.class)} yet.</p></div>`;
            return;
        }
        const slots = Object.keys(evo.slots).sort(slotSort);
        if (!S.metaEvoSlot || !slots.includes(S.metaEvoSlot)) S.metaEvoSlot = slots[0];
        const slot = S.metaEvoSlot;
        const items = (evo.slots[slot] || []).slice(0, 3);
        const series = items.map((it, i) => ({
            name: it.name,
            color: CHART_COLORS[i],
            data: it.series.map(v => v != null ? v : null)
        }));

        body.innerHTML = `
            <div class="pvp-only">
                <div class="section-label">How the meta shifted, week by week</div>
                <div class="evo-toolbar">${evoSlotSelect(slots, slot)}</div>
                ${lineChartCard('evoPvp', `${slot} slot — ${S.spec} ${S.class} (arena)`,
                    `${evo.dates[0]} → ${evo.dates[evo.dates.length - 1]}, weekly`, series, evo.dates,
                    `The arena crowd re-gears within weeks, not phases — so crossovers show up here much faster than in the raid-log (PvE) version.`)}
            </div>`;
        wireLineCharts(body);
        wireEvoSlotSelect(panel);
    }

    function wireEvoSlotSelect(panel) {
        const sel = panel.querySelector('#evoSlotSelect');
        if (sel) sel.addEventListener('change', e => {
            S.metaEvoSlot = e.target.value;
            renderEvolution(panel);
        });
    }

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
                <div class="tier-row tier-clickable${i === 0 ? ' rank-1' : ''}" data-class="${esc(r.class)}" data-spec="${esc(r.spec)}">
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
                <div class="tier-row tier-clickable${i === 0 ? ' rank-1' : ''}" data-class="${esc(r.class)}" data-spec="${esc(r.spec)}">
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
        panel.querySelectorAll('.tier-clickable').forEach(row => {
            row.addEventListener('click', () => {
                const cls = row.getAttribute('data-class');
                const spec = row.getAttribute('data-spec');
                if (cls && spec) goToSpec(cls, spec);
            });
        });
        wireLineCharts(panel);
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
                name: `${spec} ${cls}`,
                color: CHART_COLORS[i],
                data: phaseIds.map(pid => {
                    const v = shareByPhaseSpec[`${pid}|${key}`];
                    return v != null ? v : null;
                })
            };
        });
        return `<div class="section-label">How it's shifted — across the phases (PvE)</div>` +
            lineChartCard('specTrendPve', 'Spec share, phase by phase',
            `Phase ${phaseIds[0]} → ${phaseIds[phaseIds.length - 1]}`,
            series, phaseIds.map(p => 'P' + p),
            `Only ${phaseIds.length} data points total, so read this as a broad trend — PvP mode gives you a week-by-week pulse instead.`);
    }

    // PvP spec-share trend across the 21 weekly snapshots (top 3 specs).
    function renderSpecTrendPvp(data, ranked) {
        const dates = data.specMeta.pvp.all.dates;
        const top = ranked.slice(0, 3);
        const series = top.map((r, i) => ({
            name: `${r.spec} ${r.class}`,
            color: CHART_COLORS[i],
            data: r.series.map(v => v != null ? v : null)
        }));
        return `<div class="section-label">How it's shifted — last ${dates.length} weeks (PvP, top of the ladder)</div>` +
            lineChartCard('specTrendPvp', 'Spec share of the top of the ladder',
            `${dates[0]} → ${dates[dates.length - 1]}`,
            series, dates,
            `${dates.length} real weekly snapshots — a steady multi-week climb is a genuine trend, not noise.`);
    }

    // ════════════════════════════════════════════════════════════════
    // Shared spec-picker bar (NAV-REVISION-GUIDE.md §1–§4).
    // ONE component + ONE shared state (S.class / S.spec), mounted at the
    // top of Item Usage, Meta Evolution and Top Players. No longer a global
    // filter row — "aggregerat först, grotta ned sig sen".
    //   • empty mode  → prompt + class/spec chips (nothing drilled into yet)
    //   • selected mode → "← Overview" + breadcrumb + "Change ▾"
    // ════════════════════════════════════════════════════════════════
    const CONTEXT_LABEL = { usage: 'item usage', evolution: 'meta evolution', players: 'the arena ladder' };

    function specPickerBarHtml(contextKey) {
        const ctx = CONTEXT_LABEL[contextKey] || 'the details';
        const hasSel = !!(S.class && S.spec);
        const showChips = !hasSel || S._pickerOpen;

        // Class chip row (no "All" option — this is a drill-in, not a filter).
        const classChips = CLASS_ORDER.map(cls => {
            const rgb = CLASS_RGB[cls];
            return `<button class="class-chip${cls === S.class ? ' active' : ''}" data-pick-class="${cls}" style="--chip-rgb:${rgb};"><span class="cc-dot" style="background:var(--${cls.toLowerCase()});">${CLASS_ABBR[cls]}</span>${cls}</button>`;
        }).join('');

        // Spec sub-menu for the currently picked class.
        let specChips = '';
        if (S.class) {
            const specs = specsForClass(S.mode, S.class, S.phase);
            const rgb = CLASS_RGB[S.class] || '139,148,158';
            specChips = specs.map(sp =>
                `<button class="class-chip spec-chip${sp === S.spec ? ' active' : ''}" data-pick-spec="${esc(sp)}" style="--chip-rgb:${rgb};">${esc(sp)}</button>`
            ).join('');
        }

        const dotBg = S.class ? `var(--${S.class.toLowerCase()})` : '#8b949e';
        const crumb = hasSel
            ? `<div class="spec-picker-current">
                    <button class="spec-picker-back" data-picker-back title="Back to Overview">← Overview</button>
                    <span class="spec-picker-crumb"><span class="spec-picker-dot" style="background:${dotBg};"></span><strong>${esc(S.spec)} ${esc(S.class)}</strong></span>
                    <button class="spec-picker-change" data-picker-change>${S._pickerOpen ? 'Done' : 'Change ▾'}</button>
                </div>`
            : `<div class="spec-picker-empty"><span>Pick a class to see its ${esc(ctx)}:</span></div>`;

        return `
            <div class="spec-picker-bar" id="specPickerBar">
                ${crumb}
                <div class="chip-scroll${showChips ? '' : ' hidden'}">
                    <div class="chip-row">${classChips}</div>
                    ${S.class ? `<div class="chip-row spec-sub">${specChips}</div>` : ''}
                </div>
            </div>`;
    }

    // Wire the picker inside a freshly-rendered panel. Delegated so it keeps
    // working after the panel re-renders.
    function wireSpecPicker(panel, contextKey) {
        const bar = panel.querySelector('#specPickerBar');
        if (!bar) return;
        bar.addEventListener('click', e => {
            const clsBtn = e.target.closest('[data-pick-class]');
            const specBtn = e.target.closest('[data-pick-spec]');
            const back = e.target.closest('[data-picker-back]');
            const change = e.target.closest('[data-picker-change]');
            if (clsBtn) {
                const cls = clsBtn.dataset.pickClass;
                S.class = cls;
                document.body.dataset.class = cls;
                const specs = specsForClass(S.mode, cls, S.phase);
                S.spec = specs.includes(S.spec) ? S.spec : (specs[0] || '');
                S._pickerOpen = true;           // keep open so a spec can be chosen
                renderActivePanel();
            } else if (specBtn) {
                S.spec = specBtn.dataset.pickSpec;
                S._pickerOpen = false;          // collapse back to breadcrumb
                syncUrl();
                renderActivePanel();
            } else if (back) {
                clearSelection();
                switchPanel('overview');
            } else if (change) {
                S._pickerOpen = !S._pickerOpen;
                renderActivePanel();
            }
        });
    }

    // Programmatic drill-in from an aggregated view (Step 2 uses this).
    function goToSpec(className, specName) {
        S.class = className;
        S.spec = specName;
        S._pickerOpen = false;
        if (className) document.body.dataset.class = className;
        switchPanel('usage');   // sets S.tab + syncs URL (class/spec/view)
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function clearSelection() {
        S.class = '';
        S.spec = '';
        S._pickerOpen = false;
        document.body.dataset.class = '';
        syncUrl();
    }

    // Keep class/spec in the URL only while drilled in (replaceState so we
    // don't spam back-history). NAV-REVISION-GUIDE.md §4.
    function syncUrl() {
        const q = new URLSearchParams(location.search);
        if (S.class) q.set('class', S.class.toLowerCase()); else q.delete('class');
        if (S.spec) q.set('spec', S.spec.toLowerCase()); else q.delete('spec');
        // Reflect the active tab so a drilled-in view is shareable/bookmarkable.
        // Overview is the default — keep it out of the URL to stay clean.
        if (S.tab && S.tab !== 'overview') q.set('view', S.tab); else q.delete('view');
        const qs = q.toString();
        try { history.replaceState(null, '', qs ? `${location.pathname}?${qs}` : location.pathname); } catch (_) { /* ignore */ }
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
        const bar = specPickerBarHtml('usage');
        const finish = html => { panel.innerHTML = bar + html; wireSpecPicker(panel, 'usage'); };
        if (!S.class || !S.spec) {
            finish(`<p class="empty-note">Pick a class and spec above — or click into one from the Overview charts — to see what its top players actually run.</p>`);
            return;
        }
        const specs = specsForClass(S.mode, S.class, S.phase);
        if (!specs.length || !specs.includes(S.spec)) {
            finish(`<p class="empty-note">No data recorded for ${esc(S.spec || S.class)} in this ${S.mode === 'pve' ? 'phase' : 'bracket'} yet.</p>`);
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
            finish(`<p class="empty-note">No gear data for ${esc(S.spec)} ${esc(S.class)} in this ${S.mode === 'pve' ? 'phase' : 'bracket'} yet.</p>`);
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
            finish(`<p class="empty-note">No gear data for this combination yet.</p>`);
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

        finish(`
            <div class="section-label">${esc(S.spec)} ${esc(S.class)} — ${esc(sub)}</div>
            <div class="usage-list">${list}</div>`);
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

        // A spec valid in one mode may not exist in the other — fall back to
        // the empty (un-drilled) state rather than showing a broken view.
        if (S.class && S.spec) {
            const specs = specsForClass(mode, S.class, S.phase);
            if (!specs.includes(S.spec)) clearSelection();
        }

        renderHighlights(mode);
        updateFreshnessCopy(mode);
        renderActivePanel();
    }

    // Freshness copy driven by STATS_DATA.meta.sources — never hardcode
    // "live"/"daily". PvP refreshes weekly; PvE only when a new phase lands.
    function updateFreshnessCopy(mode) {
        const el = document.getElementById('statsFreshness');
        const data = D();
        if (!el || !data || !data.meta) return;
        const src = data.meta.sources || {};
        let txt = '';
        if (mode === 'pvp') {
            const snap = src.pvp && src.pvp.latestSnapshot;
            txt = snap
                ? `🏆 Arena data as of ${snap}, updated weekly.`
                : `🏆 Arena data updated weekly.`;
        } else {
            const latest = data.meta.latestPhase;
            const scraped = src.pve && src.pve.scrapedAt ? src.pve.scrapedAt.slice(0, 10) : null;
            txt = latest
                ? `⚔️ Raid data from Phase ${latest}${scraped ? ` (logs as of ${scraped})` : ''} — refreshed each new phase, not daily.`
                : `⚔️ Raid data refreshed each new phase.`;
        }
        el.textContent = txt;
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

        // NOTE: class/spec are no longer a global filter row — they live in
        // the per-panel spec-picker bar (see specPickerBarHtml / wireSpecPicker).

        // Phase / bracket segmented controls
        const phaseSeg = document.getElementById('phaseSeg');
        if (phaseSeg) phaseSeg.addEventListener('click', e => {
            const btn = e.target.closest('button');
            if (!btn) return;
            [...phaseSeg.children].forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            S.phase = btn.dataset.phase;
            // A selected spec may not exist in the newly-picked phase.
            if (S.class && S.spec) {
                const specs = specsForClass(S.mode, S.class, S.phase);
                if (!specs.includes(S.spec)) clearSelection();
            }
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
        if (spec && S.class) {
            // Match case-insensitively against the specs that actually exist
            // for this class+mode, so ?spec=subtlety resolves to "Subtlety".
            const specs = specsForClass(S.mode, S.class, S.phase || (data && data.meta.latestPhase));
            const match = specs.find(s => s.toLowerCase() === spec.toLowerCase());
            if (match) S.spec = match;
        }
        const phase = q.get('phase');
        if (phase) S.phase = phase;
        const bracket = q.get('bracket');
        if (bracket) S.bracket = bracket;
        const view = q.get('view');
        const viewAlias = { 'all-time': 'alltime', alltime: 'alltime' };
        const normView = view ? (viewAlias[view] || view) : null;
        const validTabs = ['overview', 'usage', 'specmeta', 'evolution', 'players', 'alltime'];
        if (normView && validTabs.includes(normView)) S.tab = normView;
        // Default phase = latest.
        if (!S.phase && data) S.phase = data.meta.latestPhase;
        // class without a resolved spec = not fully drilled in → treat as none.
        if (S.class && !S.spec) S.class = '';
        if (S.class) document.body.dataset.class = S.class;
    }

    function syncControlsToState() {
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
