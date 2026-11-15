/**
 * Theme token registry — choices.
 *
 * A choice is an enumerated setting a theme picks one option of (Calliope
 * Live, Spec A decision 6). It is expressed as a `data-qt-<name>` attribute on
 * <html>; tokens that vary with it carry the non-default options' values in
 * `byChoice`, and the generator writes one `[data-theme][data-qt-<name>="<option>"]`
 * block per non-default option. The default option writes nothing: it is
 * simply the tokens' defaults. Layout variants will use the same mechanism.
 *
 * @module themes/registry/choices
 */

export interface ChoiceDef {
  /** Attribute suffix and theme document key: `data-qt-<name>`, `choices.<name>`. */
  name: string;
  label: string;
  description: string;
  options: readonly string[];
  /** The option the tokens' defaults describe; it emits no CSS. */
  default: string;
}

export const THEME_CHOICES: readonly ChoiceDef[] = [
  {
    name: 'density',
    label: 'Density',
    description:
      'How roomy the interface is: padding, avatar and control sizes, and sidebar and header dimensions. Compact is the default theme; comfortable is what every bundled theme has used.',
    options: ['compact', 'comfortable'],
    default: 'compact',
  },
];

export function getThemeChoice(name: string): ChoiceDef | undefined {
  return THEME_CHOICES.find((c) => c.name === name);
}
