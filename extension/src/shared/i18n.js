/*
 * Doc Highlighter — highlight local and web documents, stored on your device.
 * Copyright (C) 2026 cansuk
 *
 * This program is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option) any later
 * version. See the LICENSE file, or <https://www.gnu.org/licenses/>.
 */
/**
 * i18n helpers — a thin layer over Chrome's built-in chrome.i18n.
 *
 * The language comes from Chrome's UI LANGUAGE (chrome.i18n.getUILanguage()),
 * not from the page language or from a setting of ours. There is NO supported
 * runtime override API: if we ever want to let the user pick a language by hand,
 * chrome.i18n has to be dropped in favour of our own dictionary layer. Today's
 * requirement is "follow the browser", so chrome.i18n is enough.
 *
 * default_locale = en  ->  every language other than tr sees English.
 */

/** Look up a translation. Missing key returns the key itself, so gaps are visible. */
export function t(key, substitutions) {
  return chrome.i18n.getMessage(key, substitutions) || key;
}

/**
 * Localise the DOM.
 *
 *   data-i18n="key"              -> textContent
 *   data-i18n-html="key"         -> innerHTML  (when the message carries markup
 *                                   such as <code> or <strong>)
 *   data-i18n-attr="attr:key,…"  -> setAttribute
 *   <html data-i18n-title="key"> -> document.title
 *
 * On innerHTML: the only source is the bundled _locales files. User input and
 * remote content are NEVER passed here, so there is no XSS surface.
 */
export function localizeDom(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }

  for (const el of root.querySelectorAll('[data-i18n-html]')) {
    el.innerHTML = t(el.dataset.i18nHtml);
  }

  for (const el of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of el.dataset.i18nAttr.split(',')) {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    }
  }

  const titleKey = document.documentElement.dataset.i18nTitle;
  if (titleKey) document.title = t(titleKey);

  // Correct lang for screen readers and language-dependent typography.
  document.documentElement.lang = chrome.i18n.getUILanguage().split('-')[0];
}
