import { isNonPublicAddress, isLocalHostname, normalizeHost } from '@/lib/net/ip-classifier';

describe('isNonPublicAddress', () => {
  it.each([
    '127.0.0.1', '127.255.0.9', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '169.254.169.254', '100.64.0.1', '100.127.255.255', '0.0.0.0', '224.0.0.1', '255.255.255.255',
    '192.0.2.5', '198.18.0.1',
    '::', '::1', '[::1]', 'fe80::1', 'fe80::1%eth0', 'fc00::1', 'fd12:3456::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:a9fe:a9fe',
    '64:ff9b::7f00:1', '2002:7f00:1::1', '2001:db8::1', '::127.0.0.1',
    'not-an-ip',
  ])('refuses %s', (addr) => {
    expect(isNonPublicAddress(addr)).toBe(true);
  });

  it.each([
    '8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '100.63.255.255', '100.128.0.1',
    '2606:4700:4700::1111', '::ffff:8.8.8.8', '::ffff:808:808', '64:ff9b::808:808',
  ])('allows %s', (addr) => {
    expect(isNonPublicAddress(addr)).toBe(false);
  });
});

describe('host helpers', () => {
  it('strips brackets and zone', () => {
    expect(normalizeHost('[FE80::1%en0]')).toBe('fe80::1');
  });
  it('recognises local names', () => {
    expect(isLocalHostname('localhost')).toBe(true);
    expect(isLocalHostname('app.localhost.')).toBe(true);
    expect(isLocalHostname('example.com')).toBe(false);
  });
});
