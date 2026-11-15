/**
 * Theme probe — the page-side half (Calliope Live, Spec C 0.1).
 *
 * The theme snapshot (scripts/theme-snapshot.ts) sees only custom properties
 * on <html>. This records what rules do: for a fixed list of elements, a fixed
 * list of computed properties, including ::before, ::after and ::selection.
 *
 * Plain JavaScript with no dependencies, so it can be injected into any page
 * (the driver in ./run.ts does it with Playwright; it can as well be pasted
 * into a browser console). Installing it defines one global:
 *
 *   window.__qtThemeProbe({ hooks: [{ className, variants: [{ attribute, values }] }] })
 *
 * which returns a JSON-safe object:
 *
 *   {
 *     url, theme, mode, viewport,
 *     counts:   { "<selector>": <visible elements matched> },
 *     elements: { "<selector>": { self: {...}, before?: {...}, after?: {...}, selection?: {...} } }
 *   }
 *
 * Elements: `html`, `body`, then for every catalogued hook the first visible
 * element with its class, and the first visible element for each value of
 * each of its variant attributes (`.qt-x[data-role="user"]`). Counts are
 * recorded for every selector tried, so an element missing from a page reads
 * as "0 matched", never as "unchanged". Hidden elements (closed workspace
 * tabs, collapsed panels) are not counted.
 *
 * @module scripts/theme-probe/probe
 */
(function install() {
  'use strict';

  /** Computed properties recorded for every element. */
  var PROPERTIES = [
    'color',
    'background-color',
    'background-image',
    'background-size',
    'background-position',
    'background-attachment',
    'border-top-width',
    'border-right-width',
    'border-bottom-width',
    'border-left-width',
    'border-top-style',
    'border-right-style',
    'border-bottom-style',
    'border-left-style',
    'border-top-color',
    'border-right-color',
    'border-bottom-color',
    'border-left-color',
    'border-top-left-radius',
    'border-top-right-radius',
    'border-bottom-right-radius',
    'border-bottom-left-radius',
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
    'letter-spacing',
    'text-transform',
    'line-height',
    'padding-top',
    'padding-right',
    'padding-bottom',
    'padding-left',
    'row-gap',
    'column-gap',
    'box-shadow',
    'outline-color',
    'outline-style',
    'outline-width',
    'outline-offset',
    'opacity',
    'transition',
    'animation-name',
    'filter',
    'backdrop-filter',
    'scrollbar-width',
    'scrollbar-color',
    'color-scheme',
  ];

  /** Recorded for ::before / ::after, when the pseudo-element exists. */
  var PSEUDO_PROPERTIES = ['content'].concat(PROPERTIES);

  /** Recorded for ::selection. */
  var SELECTION_PROPERTIES = ['color', 'background-color'];

  function read(style, names) {
    var out = {};
    for (var i = 0; i < names.length; i++) out[names[i]] = style.getPropertyValue(names[i]);
    return out;
  }

  function visible(el) {
    if (typeof el.checkVisibility === 'function') {
      return el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true });
    }
    return el.getClientRects().length > 0;
  }

  function firstVisible(selector) {
    var list;
    try {
      list = document.querySelectorAll(selector);
    } catch (e) {
      return { count: -1, element: null };
    }
    var count = 0;
    var first = null;
    for (var i = 0; i < list.length; i++) {
      if (!visible(list[i])) continue;
      count++;
      if (!first) first = list[i];
    }
    return { count: count, element: first };
  }

  function measure(el) {
    var record = { self: read(getComputedStyle(el), PROPERTIES) };
    ['::before', '::after'].forEach(function (pseudo) {
      var style = getComputedStyle(el, pseudo);
      var content = style.getPropertyValue('content');
      if (content && content !== 'none' && content !== 'normal') {
        record[pseudo.slice(2)] = read(style, PSEUDO_PROPERTIES);
      }
    });
    record.selection = read(getComputedStyle(el, '::selection'), SELECTION_PROPERTIES);
    return record;
  }

  function escapeValue(v) {
    return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  window.__qtThemeProbe = function probe(options) {
    var hooks = (options && options.hooks) || [];
    var root = document.documentElement;
    var result = {
      url: location.pathname + location.search,
      theme: root.getAttribute('data-theme'),
      mode: root.getAttribute('data-color-mode'),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      counts: {},
      elements: {},
    };
    result.elements.html = measure(root);
    result.elements.body = measure(document.body);
    result.counts.html = 1;
    result.counts.body = 1;

    hooks.forEach(function (hook) {
      var base = '.' + hook.className;
      var found = firstVisible(base);
      result.counts[base] = found.count;
      if (found.element) result.elements[base] = measure(found.element);
      (hook.variants || []).forEach(function (variant) {
        var values = variant.values;
        if (values === 'open') {
          // An open set: probe the values present on the page, in document order.
          var seen = {};
          values = [];
          var all = document.querySelectorAll(base + '[' + variant.attribute + ']');
          for (var i = 0; i < all.length; i++) {
            var v = all[i].getAttribute(variant.attribute);
            if (!seen[v]) {
              seen[v] = true;
              values.push(v);
            }
          }
        }
        values.forEach(function (value) {
          var selector = base + '[' + variant.attribute + '="' + escapeValue(value) + '"]';
          var hit = firstVisible(selector);
          if (hit.count === 0) return;
          result.counts[selector] = hit.count;
          if (hit.element) result.elements[selector] = measure(hit.element);
        });
      });
      (hook.states || []).forEach(function (state) {
        var selector =
          state.kind === 'class'
            ? base + '.' + state.className
            : base + '[' + state.attribute + '="' + escapeValue(state.values[0]) + '"]';
        var hit = firstVisible(selector);
        if (hit.count === 0) return;
        result.counts[selector] = hit.count;
        if (hit.element) result.elements[selector] = measure(hit.element);
      });
    });

    // Headings carry theme treatment through bare h1–h3 selectors as well as
    // the .qt-heading-* classes; Stage 2.3 needs to see which ones are bare.
    ['h1', 'h2', 'h3'].forEach(function (tag) {
      var hit = firstVisible(tag);
      result.counts[tag] = hit.count;
      if (hit.element) result.elements[tag] = measure(hit.element);
    });
    return result;
  };
})();
