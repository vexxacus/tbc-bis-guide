/* ═══════════════════════════════════════════════════════════════════════
   Affiliate module — NordVPN ("Ping Ward")
   ───────────────────────────────────────────────────────────────────────
   Fully self-contained. Touches no other app code (app.js / sim.js / gearscore
   etc. are untouched). Safe to remove by deleting this file + its <script> tag.

   Rules (see nordvpn-implementation-spec.md):
     • Never a modal / overlay / interstitial / sticky / sound / video.
     • Two low-friction placements are active (owner-approved):
         – Footer line: every page, at the very bottom (low profile).
         – Ad-slot (#adSlot1): spec/gear pages only (incl. PvP), never the
           start / class-select or static pages.
     • Dismissable permanently via ✕ (stored in localStorage, per placement).
     • No layout blink on gear/sim state changes — injected once, statically.
   ═══════════════════════════════════════════════════════════════════════ */
(() => {
    'use strict';

    // ── Config ───────────────────────────────────────────────────────
    const LINK = 'https://go.adt242.com/t/t?a=1960529974&as=2095863399&t=2&tk=1&utm_source=tbc-bis-guide';
    const ICON = '/img/nordvpn-logo-icon.png';

    // Only the three sanctioned copy lines (no phishing/scam claims).
    const AFFILIATE_COPY = [
        "NordVPN — Trinket. Use: Hides your IP from network intruders. (No cooldown.)",
        "World-first racers get DDoS'd more than they get world-firsts. Just saying. — NordVPN",
        "Your gear is BiS. Is your connection? — NordVPN",
    ];

    const CLASS_SLUGS = new Set([
        'warrior', 'paladin', 'hunter', 'rogue', 'priest',
        'shaman', 'mage', 'warlock', 'druid',
    ]);

    // ── Dismiss helpers (shared by any future placement) ─────────────
    function isDismissed(key) {
        try { return localStorage.getItem(`affiliate-dismissed-${key}`) === '1'; }
        catch (_) { return false; }
    }
    function dismiss(key) {
        try { localStorage.setItem(`affiliate-dismissed-${key}`, '1'); } catch (_) {}
    }

    // Global one-time listener: any ✕ with [data-dismiss-affiliate] removes its
    // own ad area from the DOM and remembers the choice permanently.
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-dismiss-affiliate]');
        if (!btn) return;
        dismiss(btn.dataset.dismissAffiliate);
        btn.closest('.affiliate-slot, .affiliate-footer-line, .ad-slot')?.remove();
    });

    // ── Is this a spec/gear page? (never the start or static pages) ──
    function isSpecPage() {
        const parts = location.pathname.replace(/^\/|\/$/g, '').split('/').filter(Boolean);
        // Needs at least /{class}/{spec}. First segment must be a real class.
        return parts.length >= 2 && CLASS_SLUGS.has(parts[0].toLowerCase());
    }

    function pickCopy() {
        return AFFILIATE_COPY[Math.floor(Math.random() * AFFILIATE_COPY.length)];
    }

    // ── Placement 3 — the existing reserved ad-slot (#adSlot1) ───────
    // Lowest risk: it already lives last in the page flow, after the gear list
    // and SEO sections, before the footer. We fill it with the item-card style
    // markup and reveal it. One area per page — no other placement is shown.
    function injectAdSlot() {
        const KEY = 'ad-slot1';
        if (isDismissed(KEY)) return;
        const slot = document.getElementById('adSlot1');
        if (!slot) return;
        if (slot.dataset.affiliateReady === '1') {
            // Already built — just make sure it's visible again.
            slot.style.display = 'block';
            return;
        }
        slot.innerHTML = `
            <div class="affiliate-slot" data-affiliate="nordvpn">
                <img src="${ICON}" alt="" class="affiliate-slot-icon" width="24" height="16" loading="lazy" decoding="async">
                <div class="affiliate-slot-text">
                    <span class="affiliate-slot-title">Ping Ward <span class="affiliate-slot-tag">Sponsored</span></span>
                    <span class="affiliate-slot-desc">${pickCopy()}</span>
                </div>
                <a href="${LINK}" target="_blank" rel="sponsored noopener" class="affiliate-slot-cta">NordVPN ↗</a>
                <button class="affiliate-slot-close" data-dismiss-affiliate="${KEY}" aria-label="Hide this permanently" title="Hide this">✕</button>
            </div>`;
        slot.dataset.affiliateReady = '1';
        slot.style.display = 'block';
    }

    // ── Placement 2 — low-profile footer line (#siteFooter) ──────────
    // Injected once, appended inside the site footer at the very bottom of the
    // page flow. Low-profile by design (spec: "en smal rad längst ner på varje
    // sida"). Shown on all pages including the class-picker, since it sits below
    // everything and never competes with the first impression / gear flow.
    function injectFooterLine() {
        const KEY = 'footer';
        if (isDismissed(KEY)) return;
        const footer = document.getElementById('siteFooter');
        if (!footer || footer.dataset.affiliateFooterReady === '1') return;

        const el = document.createElement('div');
        el.className = 'affiliate-footer-line';
        el.innerHTML = `
            <img src="${ICON}" alt="" width="14" height="9" loading="lazy" decoding="async">
            <a href="${LINK}" target="_blank" rel="sponsored noopener">Even Illidan needed a good connection · NordVPN</a>
            <button data-dismiss-affiliate="${KEY}" aria-label="Hide this permanently" title="Hide this">✕</button>`;
        footer.appendChild(el);
        footer.dataset.affiliateFooterReady = '1';
    }

    function run() {
        // Footer line: every page (low-profile, sits below all content).
        injectFooterLine();

        // Ad-slot: only spec/gear pages (incl. PvP: /{class}/{spec}/pvp).
        const slot = document.getElementById('adSlot1');
        if (!isSpecPage()) {
            // Honor "no prominent ad on the start / static pages" — hide if we
            // navigated back to a non-spec view within the SPA.
            if (slot && slot.dataset.affiliateReady === '1') slot.style.display = 'none';
            return;
        }
        injectAdSlot();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run, { once: true });
    } else {
        run();
    }
    // Back/forward within the SPA — re-evaluate (never duplicates: guarded above).
    window.addEventListener('popstate', run);
})();
