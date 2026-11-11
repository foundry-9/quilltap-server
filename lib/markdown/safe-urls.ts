/**
 * URL protocol allowlist for rendered Markdown, shared by the server-side
 * HTML pipeline. Mirrors react-markdown's `defaultUrlTransform` (the client
 * rule) and additionally keeps `qtap://` document URIs, as the client does.
 * Dependency-free so it loads under Jest.
 *
 * @module markdown/safe-urls
 */

const SAFE_PROTOCOL = /^(https?|ircs?|mailto|xmpp)$/i;

/** Same rule as react-markdown's `defaultUrlTransform`: relative URLs and allowlisted protocols pass; anything else becomes ''. */
export function defaultUrlRule(value: string): string {
  const colon = value.indexOf(':');
  const questionMark = value.indexOf('?');
  const numberSign = value.indexOf('#');
  const slash = value.indexOf('/');

  if (
    colon === -1 ||
    (slash !== -1 && colon > slash) ||
    (questionMark !== -1 && colon > questionMark) ||
    (numberSign !== -1 && colon > numberSign) ||
    SAFE_PROTOCOL.test(value.slice(0, colon))
  ) {
    return value;
  }
  return '';
}

/** The client's transform: `qtap://` URIs pass, everything else takes the default rule. */
export function safeUrl(value: string): string {
  return value.toLowerCase().startsWith('qtap://') ? value : defaultUrlRule(value);
}

const URL_PROPERTIES = ['href', 'src', 'cite', 'action', 'formAction', 'poster', 'data', 'xLinkHref', 'longDesc', 'background'];

interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

function isInternal(href: string): boolean {
  return href.startsWith('/') && !href.startsWith('//');
}

function walk(node: HastNode): void {
  if (node.type === 'element' && node.properties) {
    const props = node.properties;
    for (const name of URL_PROPERTIES) {
      const v = props[name];
      if (typeof v === 'string') props[name] = safeUrl(v);
    }
    for (const name of Object.keys(props)) {
      if (/^on/i.test(name)) delete props[name];
    }
    if (node.tagName === 'a' && typeof props.href === 'string' && props.href !== '') {
      const href = props.href;
      const qtap = href.toLowerCase().startsWith('qtap://');
      props.rel = ['noopener', 'noreferrer'];
      if (!qtap && !isInternal(href) && !href.startsWith('#')) props.target = '_blank';
    }
  }
  if (node.children) for (const child of node.children) walk(child);
}

/** rehype plugin: apply the URL allowlist to every URL-bearing attribute and harden links. */
export function rehypeSafeUrls() {
  return (tree: HastNode) => {
    walk(tree);
  };
}
