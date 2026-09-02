// test-blog-scheduler.js
//
// The SSRF guard, checked against the addresses an attacker would actually
// reach for. siteUrl is reported by the plugin, so it is attacker-controlled,
// and the scheduler makes an outbound request to it from inside our network.
//
//   node test-blog-scheduler.js

const assert = require('assert');
const {
  checkSiteUrl, isPrivateIPv4, isPrivateIPv6, isPrivateAddress,
} = require('./utils/blog/siteUrlGuard');

let passed = 0, failed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { console.log(`  ok    ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; });
}

(async () => {

console.log('\nIPv4 ranges');

const BLOCKED_V4 = [
  ['169.254.169.254', 'AWS/GCP/Azure instance metadata — the prize target'],
  ['127.0.0.1',       'loopback'],
  ['127.1.2.3',       'loopback, less obvious form'],
  ['10.0.0.5',        'private'],
  ['172.16.0.1',      'private, bottom of range'],
  ['172.31.255.254',  'private, top of range'],
  ['192.168.1.1',     'private'],
  ['0.0.0.0',         'this network'],
  ['100.64.0.1',      'carrier-grade NAT'],
  ['224.0.0.1',       'multicast'],
  ['255.255.255.255', 'broadcast'],
];

for (const [ip, why] of BLOCKED_V4) {
  await test(`blocks ${ip} (${why})`, () => {
    assert.strictEqual(isPrivateIPv4(ip), true);
  });
}

const ALLOWED_V4 = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.0.1', '172.32.0.1'];
for (const ip of ALLOWED_V4) {
  await test(`allows ${ip}`, () => {
    assert.strictEqual(isPrivateIPv4(ip), false);
  });
}

console.log('\nIPv6 ranges');

for (const [ip, why] of [
  ['::1',                  'loopback'],
  ['::',                   'unspecified'],
  ['fc00::1',              'unique local'],
  ['fd12:3456::1',         'unique local'],
  ['fe80::1',              'link-local'],
  ['ff02::1',              'multicast'],
  ['::ffff:169.254.169.254', 'metadata wearing an IPv6 hat'],
  ['::ffff:127.0.0.1',     'loopback, IPv4-mapped'],
  ['::ffff:10.0.0.1',      'private, IPv4-mapped'],
]) {
  await test(`blocks ${ip} (${why})`, () => {
    assert.strictEqual(isPrivateIPv6(ip), true);
  });
}

await test('allows 2606:4700:4700::1111', () => {
  assert.strictEqual(isPrivateIPv6('2606:4700:4700::1111'), false);
});

console.log('\nURLs');

for (const [url, why] of [
  ['http://169.254.169.254/latest/meta-data/', 'metadata by literal IP'],
  ['http://127.0.0.1:8080/',                   'loopback'],
  ['https://[::1]/',                           'loopback, bracketed IPv6'],
  ['http://10.0.0.5/',                         'private'],
  ['file:///etc/passwd',                       'file scheme'],
  ['gopher://example.com/',                    'gopher scheme'],
  ['ftp://example.com/',                       'ftp scheme'],
  ['http://example.com:6379/',                 'non-standard port (Redis)'],
  ['http://example.com:22/',                   'non-standard port (SSH)'],
  ['not a url at all',                         'unparseable'],
  ['',                                         'empty'],
]) {
  await test(`rejects ${url || '(empty)'} — ${why}`, async () => {
    const result = await checkSiteUrl(url);
    assert.strictEqual(result.ok, false, `should have been rejected: ${JSON.stringify(result)}`);
    assert.ok(result.reason, 'a reason should be given');
  });
}

await test('rejects a hostname that does not resolve', async () => {
  const result = await checkSiteUrl('https://this-host-does-not-exist-99a7f3.example/');
  assert.strictEqual(result.ok, false);
});

await test('accepts an ordinary public https URL', async () => {
  const result = await checkSiteUrl('https://example.com/');
  assert.strictEqual(result.ok, true, `rejected: ${result.reason}`);
  assert.ok(result.addresses.length > 0);
});

await test('accepts an explicit :443', async () => {
  const result = await checkSiteUrl('https://example.com:443/');
  assert.strictEqual(result.ok, true, `rejected: ${result.reason}`);
});

console.log('\nAddress dispatch');

await test('a non-IP string is treated as private, not allowed through', () => {
  // isPrivateAddress is the last line of defence; anything it cannot classify
  // must fail closed.
  assert.strictEqual(isPrivateAddress('example.com'), true);
  assert.strictEqual(isPrivateAddress(''), true);
  assert.strictEqual(isPrivateAddress('999.999.999.999'), true);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

})();