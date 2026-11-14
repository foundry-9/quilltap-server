import { safeUrl, rehypeSafeUrls } from '@/lib/markdown/safe-urls';

type N = { type: string; tagName?: string; properties?: Record<string, unknown>; children?: N[] };
const a = (href: string): N => ({ type: 'element', tagName: 'a', properties: { href }, children: [] });

describe('safe URL rule (matches react-markdown defaultUrlTransform)', () => {
  const cases: Array<[string, string]> = [
    ['https://example.com/x', 'https://example.com/x'],
    ['HTTP://example.com', 'HTTP://example.com'],
    ['mailto:a@b.c', 'mailto:a@b.c'],
    ['/relative/path', '/relative/path'],
    ['relative', 'relative'],
    ['#anchor', '#anchor'],
    ['?q=a:b', '?q=a:b'],
    ['qtap://store/doc.md', 'qtap://store/doc.md'],
    ['javascript:alert(1)', ''],
    ['JAVASCRIPT:alert(1)', ''],
    ['vbscript:x', ''],
    ['data:text/html,<script>', ''],
    ['tel:123', ''],
  ];
  it.each(cases)('%s', (input, expected) => {
    expect(safeUrl(input)).toBe(expected);
  });

  it('strips URL attributes and handlers, hardens links', () => {
    const tree: N = {
      type: 'root',
      children: [
        a('javascript:alert(1)'),
        a('https://example.com'),
        a('/internal'),
        { type: 'element', tagName: 'img', properties: { src: 'javascript:x', onerror: 'alert(1)' }, children: [] },
      ],
    };
    rehypeSafeUrls()(tree);
    const [bad, ext, internal, img] = tree.children!;
    expect(bad.properties!.href).toBe('');
    expect(ext.properties).toMatchObject({ target: '_blank', rel: ['noopener', 'noreferrer'] });
    expect(internal.properties!.target).toBeUndefined();
    expect(img.properties!.src).toBe('');
    expect(img.properties!.onerror).toBeUndefined();
  });
});
