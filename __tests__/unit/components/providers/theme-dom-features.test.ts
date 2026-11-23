/**
 * applyThemeToDom: mode, theme id, and the app-owned feature attributes
 * (Calliope Live, Spec A Stage 2.3).
 */

import { applyThemeToDom, THEME_FEATURE_ATTRIBUTES } from '@/components/providers/theme/theme-utils';

describe('applyThemeToDom', () => {
  const root = document.documentElement;

  afterEach(() => {
    for (const attribute of Object.values(THEME_FEATURE_ATTRIBUTES)) root.removeAttribute(attribute);
  });

  it('sets mode class, theme id and colour mode', () => {
    applyThemeToDom('dark', 'art-deco');
    expect(root.classList.contains('dark')).toBe(true);
    expect(root.classList.contains('light')).toBe(false);
    expect(root.getAttribute('data-theme')).toBe('art-deco');
    expect(root.getAttribute('data-color-mode')).toBe('dark');
  });

  it('falls back to the default theme id', () => {
    applyThemeToDom('light', null);
    expect(root.getAttribute('data-theme')).toBe('default');
    expect(root.classList.contains('light')).toBe(true);
  });

  it('switches on only the features asked for', () => {
    applyThemeToDom('light', 'v2', { pageBackground: true, focusRing: true });
    expect(root.hasAttribute('data-qt-page-background')).toBe(true);
    expect(root.hasAttribute('data-qt-focus-ring')).toBe(true);
    expect(root.hasAttribute('data-qt-scrollbar')).toBe(false);
  });

  it('clears features a later theme does not ask for', () => {
    applyThemeToDom('light', 'v2', { pageBackground: true, focusRing: true, scrollbar: true });
    applyThemeToDom('light', 'art-deco');
    for (const attribute of Object.values(THEME_FEATURE_ATTRIBUTES)) expect(root.hasAttribute(attribute)).toBe(false);
  });
});
