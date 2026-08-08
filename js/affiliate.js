/* ═══════════════════════════════════════════════════════════════════════
   Affiliate module — NordVPN ("Ping Ward")
   ───────────────────────────────────────────────────────────────────────
   Fully self-contained. Touches no other app code (app.js / sim.js / gearscore
   etc. are untouched). Safe to remove by deleting this file + its <script> tag.

   Rules (see nordvpn-implementation-spec.md):
     • Never a modal / overlay / interstitial / sticky / sound / video.
     • Two low-friction placements are active (owner-approved):
         – Footer line: every page, at the very bottom (low profile).
         – "Utility" item-card: spec/gear pages only (incl. PvP), inserted right
           after the gear list and BEFORE the SEO FAQ. Never on the start /
           class-select or static pages.
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
        // Remove the whole area: item-card wrapper (header + slot), footer line,
        // or the legacy ad-slot — whichever this ✕ belongs to.
        const area = btn.closest('#affiliateItemCard, .affiliate-footer-line, .ad-slot');
        (area || btn.closest('.affiliate-slot'))?.remove();
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

    // ── Placement 1 — "Utility" item-card in the gear list ──────────
    // Inserted right after the gear list and BEFORE the SEO FAQ, with a proper
    // "Utility" category header (icon + "not a real slot" note) matching the
    // site's own .weapon-section-header style — as per the spec. Clearly
    // separated from real gear, always last of the gear section.
    function injectItemCard() {
        const KEY = 'ad-slot1';
        if (isDismissed(KEY)) return;

        // Anchor: put it before the FAQ if present, else before the SEO summary,
        // else fall back to the reserved #adSlot1. Whichever exists first.
        const faq  = document.getElementById('seoFaq');
        const anchor = faq || document.getElementById('seoSummary') || document.getElementById('adSlot1');
        if (!anchor || !anchor.parentNode) return;

        // Already injected? Just make sure it's visible.
        const existing = document.getElementById('affiliateItemCard');
        if (existing) { existing.style.display = ''; return; }

        const wrap = document.createElement('div');
        wrap.id = 'affiliateItemCard';
        wrap.innerHTML = `
            <div class="weapon-section-header">
                <span class="weapon-section-icon">🧰</span>
                <span class="weapon-section-title">Utility</span>
                <span class="weapon-section-note">not a real slot</span>
            </div>
            <div class="affiliate-slot" data-affiliate="nordvpn">
                <img src="${ICON}" alt="" class="affiliate-slot-icon" width="24" height="16" loading="lazy" decoding="async">
                <div class="affiliate-slot-text">
                    <span class="affiliate-slot-title">Ping Ward <span class="affiliate-slot-tag">Sponsored</span></span>
                    <span class="affiliate-slot-desc">${pickCopy()}</span>
                </div>
                <a href="${LINK}" target="_blank" rel="sponsored noopener" class="affiliate-slot-cta">NordVPN ↗</a>
                <button class="affiliate-slot-close" data-dismiss-affiliate="${KEY}" aria-label="Hide this permanently" title="Hide this">✕</button>
            </div>`;
        anchor.parentNode.insertBefore(wrap, anchor);
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

        // Item card: only spec/gear pages (incl. PvP: /{class}/{spec}/pvp).
        const card = document.getElementById('affiliateItemCard');
        if (!isSpecPage()) {
            // Honor "no prominent ad on the start / static pages" — hide if we
            // navigated back to a non-spec view within the SPA.
            if (card) card.style.display = 'none';
            return;
        }
        injectItemCard();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run, { once: true });
    } else {
        run();
    }
    // Back/forward within the SPA — re-evaluate (never duplicates: guarded above).
    window.addEventListener('popstate', run);
})();
