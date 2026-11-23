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
 * Gallery mode (Calliope Live, Spec I Stage 3) is for Calliope's specimen
 * gallery, which draws every hook in every variant value and state:
 *
 *   window.__qtThemeProbe({ gallery: [{ className, instances: [{ key, selector }] }] })
 *
 * Instead of taking the first visible match on the page, it reads each
 * instance where the gallery put it — inside
 * `[data-specimen-for="<class>"] [data-specimen-instance="<key>"]
 * [data-specimen-stage]` — and measures the first element there matching the
 * instance's selector. Every article is made visible first (the gallery
 * renders them with `content-visibility: auto`), and every running
 * animation is held at its start. The result adds
 * `kind: "gallery"`, the stage's theme and mode, and `missing`: every
 * instance it could not find, which in the gallery should never happen.
 * Elements are keyed by the instance's selector, as on a live page.
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

  /** Make every specimen article render, so its stages can be measured. */
  function revealGallery() {
    var articles = document.querySelectorAll('[data-specimen-for]');
    for (var i = 0; i < articles.length; i++) articles[i].style.contentVisibility = 'visible';
    // Force the layout now rather than at the first measurement.
    void document.body.offsetHeight;
    return articles.length;
  }

  /**
   * Hold every running animation at its start, so an animated property (a
   * pulsing dot's opacity) reads the same on every run. Gallery mode only:
   * live-page results stay comparable with runs made before it.
   */
  function settleAnimations() {
    if (typeof document.getAnimations !== 'function') return 0;
    var all = document.getAnimations();
    for (var i = 0; i < all.length; i++) {
      all[i].pause();
      all[i].currentTime = 0;
    }
    return all.length;
  }

  function probeGallery(gallery, result) {
    result.kind = 'gallery';
    result.articles = revealGallery();
    result.animationsHeld = settleAnimations();
    result.stage = { theme: null, mode: null };
    result.missing = [];
    gallery.forEach(function (hook) {
      var article = document.querySelector('[data-specimen-for="' + escapeValue(hook.className) + '"]');
      hook.instances.forEach(function (instance) {
        var item = article && article.querySelector('[data-specimen-instance="' + escapeValue(instance.key) + '"]');
        var stage = item && item.querySelector('[data-specimen-stage]');
        var list = [];
        if (stage) {
          try {
            list = stage.querySelectorAll(instance.selector);
          } catch (e) {
            list = [];
          }
        }
        result.counts[instance.selector] = list.length;
        if (list.length === 0) {
          result.missing.push(instance.selector + (article ? (item ? '' : ' (no item ' + instance.key + ')') : ' (no article)'));
          return;
        }
        if (!result.stage.theme) {
          result.stage.theme = stage.getAttribute('data-theme');
          result.stage.mode = stage.getAttribute('data-specimen-stage');
        }
        // A specimen may hold several elements of the class; the first visible
        // one is the hooked element, else the first (a state that hides it).
        var chosen = null;
        for (var i = 0; i < list.length && !chosen; i++) if (visible(list[i])) chosen = list[i];
        result.elements[instance.selector] = measure(chosen || list[0]);
      });
    });
    return result;
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
    if (options && options.gallery) return probeGallery(options.gallery, result);
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
