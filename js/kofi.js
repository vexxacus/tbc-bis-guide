/* ═══════════════════════════════════════════════════════════════════════
   Ko-fi module — "Buy me a coffee" footer line
   ───────────────────────────────────────────────────────────────────────
   Fully self-contained sibling to affiliate.js. Touches no other app code
   (app.js / sim.js / gearscore etc. are untouched). Safe to remove by
   deleting this file + its <script> tag.

   Rules:
     • Never a modal / overlay / interstitial / sticky / sound / video.
     • One low-profile placement: a footer line at the very bottom of every
       page (below all content, never competes with the gear flow).
     • Dismissable permanently via ✕ — reuses affiliate.js's global
       [data-dismiss-affiliate] listener + localStorage, so no duplicate
       dismiss logic here.
     • Injected once, statically — no layout blink on gear/sim state changes.
   ═══════════════════════════════════════════════════════════════════════ */
(() => {
    'use strict';

    // ── Master kill-switch ───────────────────────────────────────────
    // Set to false to hide the Ko-fi line site-wide. Bump the ?v= on the
    // <script> tag in index.html when flipping this.
    const KOFI_ENABLED = true;

    // ── Config ───────────────────────────────────────────────────────
    const KOFI_URL = 'https://ko-fi.com/vexxan';
    const ICON = '/img/kofi_symbol.svg';
    const KEY = 'kofi-footer';   // dismiss key (shared affiliate-dismissed-* namespace)

    function isDismissed() {
        try { return localStorage.getItem(`affiliate-dismissed-${KEY}`) === '1'; }
        catch (_) { return false; }
    }

    // ── Footer line (#siteFooter) ────────────────────────────────────
    function injectKofiLine() {
        if (isDismissed()) return;
        const footer = document.getElementById('siteFooter');
        if (!footer || footer.dataset.kofiReady === '1') return;

        const el = document.createElement('div');
        el.className = 'kofi-footer-line';
        el.innerHTML = `
            <img src="${ICON}" alt="Ko-fi" width="18" height="15" loading="lazy" decoding="async">
            <a href="${KOFI_URL}" target="_blank" rel="noopener">Enjoying the guide? Buy me a coffee</a>
            <button data-dismiss-affiliate="${KEY}" aria-label="Hide this permanently" title="Hide this">✕</button>`;
        footer.appendChild(el);
        footer.dataset.kofiReady = '1';
    }

    // ── Support pill in the share-build bar (BiS pages only) ─────────
    // The .share-build-bar is rendered by app.js on gear pages. We insert a
    // "Support" pill immediately after the "Share Build" button (before the
    // "Send your raid lead…" hint) without touching app.js. Guarded so it
    // only ever injects once.
    function injectSharePill() {
        const bar = document.getElementById('shareBuildBar');
        if (!bar || bar.dataset.kofiPillReady === '1') return;

        const pill = document.createElement('a');
        pill.className = 'kofi-share-btn';
        pill.href = KOFI_URL;
        pill.target = '_blank';
        pill.rel = 'noopener';
        pill.innerHTML = `
            <img src="${ICON}" alt="" width="16" height="13" loading="lazy" decoding="async">
            <span>Support</span>`;

        // Place it right after the Share Build button so the two sit together.
        const shareBtn = document.getElementById('shareBuildBtn');
        if (shareBtn && shareBtn.parentNode === bar) {
            shareBtn.insertAdjacentElement('afterend', pill);
        } else {
            bar.appendChild(pill);
        }
        bar.dataset.kofiPillReady = '1';
    }

    function run() {
        if (!KOFI_ENABLED) return;   // master kill-switch — render nothing.
        injectKofiLine();
        injectSharePill();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run, { once: true });
    } else {
        run();
    }

    // app.js navigates the SPA via history.pushState (no popstate fires), and
    // renders #shareBuildBar asynchronously. A MutationObserver on #app keeps
    // both placements reliable regardless of load timing or in-app navigation.
    const appRoot = document.getElementById('app') || document.body;
    if (appRoot && KOFI_ENABLED) {
        let scheduled = false;
        const schedule = () => {
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(() => { scheduled = false; run(); });
        };
        const obs = new MutationObserver(schedule);
        obs.observe(appRoot, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    }
    // Back/forward within the SPA — re-evaluate (guarded above, never duplicates).
    window.addEventListener('popstate', run);
})();
