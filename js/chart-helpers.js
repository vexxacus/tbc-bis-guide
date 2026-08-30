/* ══════════════════════════════════════════════════════════════════
   chart-helpers.js — shared Apache ECharts layer for the /stats page.

   Follows CHART-UPGRADE-GUIDE.md §3: one place for the tooltip formatter,
   the fullscreen overlay, the colour constants, and the init/resize
   bookkeeping — so each individual chart in stats-page.js only has to
   build its data + return an ECharts option object.

   ECharts itself is loaded from Cloudflare's public CDN (cdnjs), lazily,
   ONLY when the stats page needs it — never bundled into the repo and
   never loaded sitewide (BiS-list pages must not pay a ~1 MB download
   they never use). Same principle as pvp-history.json off jsDelivr:
   heavy files live on a free CDN, off Firebase's egress quota.

   Apache-2.0 licensed → free for commercial use (ads/affiliate ok),
   unlike Highcharts which would need a paid licence for this site.
   ══════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    // ── ECharts CDN pin ─────────────────────────────────────────────
    // Version + SRI hash taken straight from https://cdnjs.com/libraries/echarts
    // (do NOT bump these by guessing — pull the real integrity hash from the
    //  cdnjs API for the exact version, e.g.
    //  curl 'https://api.cdnjs.com/libraries/echarts/<v>?fields=sri').
    const ECHARTS_VERSION = '6.1.0';
    const ECHARTS_SRC = `https://cdnjs.cloudflare.com/ajax/libs/echarts/${ECHARTS_VERSION}/echarts.min.js`;
    const ECHARTS_SRI = 'sha512-Uyq/AgtqFM4vT+unIGTDr4wMJDTUK9O5w2PXMQeBCSR8koqHpVz+qBmcQ+9Oeo5H+EmvT4pp/5QrsqhIbyjHTQ==';

    // ── Design tokens as literal hex (ECharts needs real colours) ───
    // Same source of truth as stats-page.js / STATS-PAGE-DESIGN.md §3c.
    // Stack order deliberately keeps the worst CVD pairs (Warrior/Druid,
    // Mage/Paladin) far apart — do NOT reorder without reading that section.
    const CLASS_COLORS = {
        Warrior: '#C79C6E', Rogue: '#FFF569', Priest: '#FFFFFF', Mage: '#69CCF0',
        Warlock: '#9482C9', Shaman: '#0070DE', Paladin: '#F58CBA', Hunter: '#ABD473', Druid: '#FF7D0A'
    };
    const CLASS_ORDER = ['Warrior', 'Rogue', 'Priest', 'Mage', 'Warlock', 'Shaman', 'Paladin', 'Hunter', 'Druid'];

    // Validated 3-series line palette (dataviz skill validate_palette.js:
    // OKLCH lightness band 0.48–0.67 dark mode, CVD ΔE ≥30, normal ΔE ≥30).
    const CHART_PALETTE = ['#a97e38', '#7c5cff', '#3d8fc9', '#4cd97b', '#ef4d4d'];
    const SURFACE = '#161a25';   // 2px ring / segment-gap colour
    const TEXT_PRIMARY = '#e6edf3';
    const TEXT_SECONDARY = '#8b949e';
    const AXIS_LINE = 'rgba(255,255,255,.08)';
    const SPLIT_LINE = 'rgba(255,255,255,.06)';

    // ── Shared tooltip formatter (CHART-UPGRADE-GUIDE §4) ───────────
    // Value leads, name follows, a short line/dot as the colour key
    // (never a filled box), rows sorted by value descending. ONE function,
    // reused by every chart — do not fork a per-chart variant.
    function axisTooltipFormatter(params) {
        const list = Array.isArray(params) ? params : [params];
        const sorted = [...list].sort((a, b) => (numeric(b.value) ?? -Infinity) - (numeric(a.value) ?? -Infinity));
        const rows = sorted.map(p => {
            const v = numeric(p.value);
            const shown = v == null ? '—' : (Number.isInteger(v) ? v : v.toFixed(1));
            const suffix = p.__unit || '%';
            return `<div style="display:flex;align-items:center;gap:7px;padding:2px 0;font-size:12px;">
                <span style="display:inline-block;width:10px;height:2px;background:${p.color};flex-shrink:0;border-radius:2px;"></span>
                <strong style="color:${TEXT_PRIMARY};">${shown}${v == null ? '' : suffix}</strong>
                <span style="color:${TEXT_SECONDARY};">${escapeHtml(p.seriesName || '')}</span>
            </div>`;
        }).join('');
        const heading = list[0] && (list[0].axisValueLabel != null ? list[0].axisValueLabel : list[0].name) || '';
        return `<div style="font-weight:700;font-size:12px;color:${TEXT_PRIMARY};margin-bottom:4px;">${escapeHtml(heading)}</div>${rows}`;
    }

    function numeric(v) {
        if (Array.isArray(v)) v = v[v.length - 1];  // [x, y] pairs → y
        if (v == null || v === '-') return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    }
    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    // ── Lazy CDN loader ─────────────────────────────────────────────
    // Returns a promise that resolves when `echarts` is on window, or
    // rejects if the CDN never loads (offline / adblocker / bad SRI).
    let _loadPromise = null;
    function ensureECharts() {
        if (typeof window.echarts !== 'undefined') return Promise.resolve(window.echarts);
        if (_loadPromise) return _loadPromise;
        _loadPromise = new Promise((resolve, reject) => {
            const existing = document.querySelector('script[data-echarts-cdn]');
            if (existing) {
                existing.addEventListener('load', () => resolve(window.echarts));
                existing.addEventListener('error', reject);
                return;
            }
            const s = document.createElement('script');
            s.src = ECHARTS_SRC;
            s.async = true;
            s.integrity = ECHARTS_SRI;
            s.crossOrigin = 'anonymous';
            s.setAttribute('data-echarts-cdn', '1');
            s.addEventListener('load', () => resolve(window.echarts));
            s.addEventListener('error', () => reject(new Error('ECharts failed to load from CDN')));
            document.head.appendChild(s);
        });
        return _loadPromise;
    }

    // ── Chart registry + init helper ────────────────────────────────
    // initChart does echarts.init + setOption + registers the instance so a
    // single window resize listener can .resize() them all. optionFn is kept
    // so the same option can be re-used in the fullscreen overlay.
    const _charts = new Map();   // containerId → { inst, optionFn }

    function loadFailedMarkup(msg) {
        return `<div class="chart-load-error">⚠️ ${escapeHtml(msg || 'Chart library failed to load — check your connection and reload.')}</div>`;
    }

    function initChart(containerId, optionFn) {
        const el = document.getElementById(containerId);
        if (!el) return;
        ensureECharts().then(ec => {
            if (!ec) { el.innerHTML = loadFailedMarkup(); return; }
            // Dispose any prior instance on this container (SPA re-render).
            const prev = _charts.get(containerId);
            if (prev && prev.inst) prev.inst.dispose();
            const inst = ec.init(el);
            inst.setOption(optionFn());
            _charts.set(containerId, { inst, optionFn });
        }).catch(() => { el.innerHTML = loadFailedMarkup(); });
    }

    // Dispose every registered chart (call when leaving the stats page so
    // instances don't leak across SPA navigation).
    function disposeAll() {
        _charts.forEach(c => { if (c.inst) c.inst.dispose(); });
        _charts.clear();
    }

    window.addEventListener('resize', () => {
        _charts.forEach(c => { if (c.inst) c.inst.resize(); });
        if (_fsChart) _fsChart.resize();
    });

    // ── Fullscreen overlay (built once, reused for any chart) ───────
    let _fsOverlay = null, _fsCanvas = null, _fsTitle = null, _fsChart = null;

    function initFullscreenOverlay() {
        if (_fsOverlay) return;
        const overlay = document.createElement('div');
        overlay.className = 'chart-fs-overlay';
        overlay.innerHTML = `
            <div class="chart-fs-panel">
                <div class="chart-fs-head">
                    <h3 class="chart-fs-title">Chart</h3>
                    <button class="chart-fs-close" type="button">✕ Close</button>
                </div>
                <div class="chart-fs-canvas"></div>
            </div>`;
        document.body.appendChild(overlay);
        _fsOverlay = overlay;
        _fsCanvas = overlay.querySelector('.chart-fs-canvas');
        _fsTitle = overlay.querySelector('.chart-fs-title');
        overlay.querySelector('.chart-fs-close').addEventListener('click', closeFullscreen);
        overlay.addEventListener('click', e => { if (e.target === overlay) closeFullscreen(); });
        document.addEventListener('keydown', e => { if (e.key === 'Escape') closeFullscreen(); });
    }

    // openFullscreen(title, optionFn) — used by each chart's ⛶ button.
    function openFullscreen(title, optionFn) {
        ensureECharts().then(ec => {
            if (!ec) return;
            initFullscreenOverlay();
            _fsTitle.textContent = title || 'Chart';
            _fsOverlay.classList.add('open');
            if (_fsChart) _fsChart.dispose();
            _fsChart = ec.init(_fsCanvas);
            _fsChart.setOption(optionFn());
            requestAnimationFrame(() => _fsChart.resize());
        });
    }

    function closeFullscreen() {
        if (_fsOverlay) _fsOverlay.classList.remove('open');
        if (_fsChart) { _fsChart.dispose(); _fsChart = null; }
    }

    // ── Common base option pieces so charts stay consistent ─────────
    // Spread these into an option and override per chart as needed.
    function baseAxisLine() {
        return { lineStyle: { color: AXIS_LINE } };
    }
    function baseCategoryAxis(data, boundaryGap) {
        return {
            type: 'category', data, boundaryGap: !!boundaryGap,
            axisLine: baseAxisLine(),
            axisTick: { show: false },
            axisLabel: { color: TEXT_SECONDARY, fontSize: 11 }
        };
    }
    function baseValueAxis(opts) {
        opts = opts || {};
        return {
            type: 'value',
            max: opts.max, min: opts.min,
            splitLine: { lineStyle: { color: SPLIT_LINE, type: 'solid' } },
            axisLabel: { color: TEXT_SECONDARY, fontSize: 11, formatter: opts.formatter || '{value}' }
        };
    }
    function baseLegend(icon) {
        return {
            bottom: 0, textStyle: { color: TEXT_SECONDARY, fontSize: 11 },
            itemWidth: icon === 'line' ? 16 : 10, itemHeight: icon === 'line' ? 2 : 10,
            icon: 'roundRect'
        };
    }
    function baseTooltip(pointerType, unit) {
        return {
            trigger: 'axis',
            axisPointer: pointerType === 'shadow'
                ? { type: 'shadow' }
                : { type: 'line', lineStyle: { color: 'rgba(255,255,255,.25)' } },
            className: 'ec-tooltip',
            formatter: params => {
                if (unit && Array.isArray(params)) params.forEach(p => { p.__unit = unit; });
                return axisTooltipFormatter(params);
            }
        };
    }
    function baseToolbox() {
        return {
            right: 8, top: 4, itemSize: 14,
            feature: {
                saveAsImage: { title: 'Save as image', backgroundColor: '#0c0e14' },
                dataZoom: { title: { zoom: 'Zoom', back: 'Reset zoom' } }
            },
            iconStyle: { borderColor: '#656d76' }
        };
    }

    // ── Expose ──────────────────────────────────────────────────────
    window.ChartHelpers = {
        ECHARTS_VERSION,
        CLASS_COLORS, CLASS_ORDER, CHART_PALETTE,
        SURFACE, TEXT_PRIMARY, TEXT_SECONDARY, AXIS_LINE, SPLIT_LINE,
        axisTooltipFormatter,
        ensureECharts, initChart, disposeAll,
        openFullscreen, initFullscreenOverlay,
        baseCategoryAxis, baseValueAxis, baseLegend, baseTooltip, baseToolbox
    };
})();
