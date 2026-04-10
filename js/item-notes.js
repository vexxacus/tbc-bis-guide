/* Item Notes — gearing tips per item (loaded from item-notes.json at build time)
   Usage:  getItemNote(itemId, specKey)
   specKey is optional, e.g. "Druid-Balance". Falls back to global note. */

const ITEM_NOTES = (function () {
    let _data = null;
    let _loaded = false;

    // Try to load synchronously via XHR (works for local dev & simple hosting)
    try {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', '/item-notes.json', false); // synchronous
        xhr.send();
        if (xhr.status === 200) {
            _data = JSON.parse(xhr.responseText);
            _loaded = true;
        }
    } catch (e) {
        console.warn('Item notes not loaded:', e);
    }

    return {
        /**
         * Get a note for an item, optionally spec-specific.
         * @param {string|number} itemId
         * @param {string} [specKey] e.g. "Druid-Balance"
         * @returns {string|null}
         */
        get(itemId, specKey) {
            if (!_loaded || !_data) return null;
            const id = String(itemId);

            // 1) Spec-specific note takes priority
            if (specKey && _data.spec && _data.spec[specKey] && _data.spec[specKey][id]) {
                return _data.spec[specKey][id];
            }

            // 2) Global note
            if (_data.global && _data.global[id]) {
                return _data.global[id];
            }

            return null;
        },

        /** Check if notes are loaded */
        isLoaded() { return _loaded; }
    };
})();
