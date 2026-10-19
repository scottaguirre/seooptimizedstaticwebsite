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

/* THE RESOLVER IS INJECTED FROM HERE DOWN, and that is why this file can
 * now run on a deploy at all.
 *
 * These three used to resolve `example.com` for real. On any machine
 * without DNS — a container, a laptop on a hotel network — two of them
 * failed, so the suite was never added to deploy.sh, so the SSRF GUARD HAD
 * NO CHECK RUNNING AGAINST IT ON ANY DEPLOY. The file protecting us from an
 * attacker-reported hostname was the one file nothing verified.
 *
 * Whether Node's DNS works is not this project's code. What the guard does
 * with an answer is. */
const resolvesTo = (...addresses) => async () => addresses.map(address => ({ address }));
const neverResolves = async () => { throw new Error('ENOTFOUND'); };

await test('rejects a hostname that does not resolve', async () => {
  const result = await checkSiteUrl('https://whatever.example/', { lookup: neverResolves });
  assert.strictEqual(result.ok, false);
  assert.ok(/could not resolve/.test(result.reason), result.reason);
});

await test('accepts an ordinary public https URL', async () => {
  const result = await checkSiteUrl('https://example.com/', { lookup: resolvesTo('93.184.216.34') });
  assert.strictEqual(result.ok, true, `rejected: ${result.reason}`);
  assert.deepStrictEqual(result.addresses, ['93.184.216.34']);
});

await test('accepts an explicit :443', async () => {
  const result = await checkSiteUrl('https://example.com:443/', { lookup: resolvesTo('93.184.216.34') });
  assert.strictEqual(result.ok, true, `rejected: ${result.reason}`);
});

await test('AND A HOSTNAME THAT RESOLVES TO NOTHING IS REFUSED', async () => {
  /* Unreachable against real DNS, which is the point of injecting: a
   * lookup that succeeds with an empty list is a different branch from one
   * that throws, and it had never been exercised. */
  const result = await checkSiteUrl('https://example.com/', { lookup: resolvesTo() });

  assert.strictEqual(result.ok, false);
  assert.ok(/no addresses/.test(result.reason), result.reason);
});

await test('AND ONE PRIVATE ADDRESS AMONG PUBLIC ONES REFUSES THE LOT', async () => {
  /* THE ASSERTION THIS WHOLE FILE EXISTS FOR, and it could not be written
   * before: a hostname under an attacker's control resolving to both a
   * public address and 169.254.169.254 would otherwise be a coin toss
   * decided by whichever the connection happened to pick. You cannot ask
   * real DNS for that. */
  const result = await checkSiteUrl('https://example.com/', {
    lookup: resolvesTo('93.184.216.34', '169.254.169.254'),
  });

  assert.strictEqual(result.ok, false);
  assert.ok(/169\.254\.169\.254/.test(result.reason), result.reason);
});

await test('AND THE ORDER THEY ARRIVE IN DOES NOT MATTER', async () => {
  const result = await checkSiteUrl('https://example.com/', {
    lookup: resolvesTo('10.0.0.5', '93.184.216.34'),
  });

  assert.strictEqual(result.ok, false);
  assert.ok(/10\.0\.0\.5/.test(result.reason), result.reason);
});

console.log('\nAddress dispatch');

await test('a non-IP string is treated as private, not allowed through', () => {
  // isPrivateAddress is the last line of defence; anything it cannot classify
  // must fail closed.
  assert.strictEqual(isPrivateAddress('example.com'), true);
  assert.strictEqual(isPrivateAddress(''), true);
  assert.strictEqual(isPrivateAddress('999.999.999.999'), true);
});

/* =========================================================================
 * What the scheduler decides to knock about
 *
 * Needs a database, because findWork() is a query and the thing worth testing
 * is which campaigns it does and does not match. Skipped without MONGO_URI.
 * ====================================================================== */

if (!process.env.MONGO_URI) {
  console.log('\n(skipping findWork tests — set MONGO_URI to run them)');
} else {
  console.log('\nfindWork');

  const mongoose = require('mongoose');
  const BlogCampaign = require('./models/BlogCampaign');
  const { findWork } = require('./utils/blogScheduler');

  await mongoose.connect(process.env.MONGO_URI);

  const site = new mongoose.Types.ObjectId();
  const user = new mongoose.Types.ObjectId();
  const made = [];

  const HOUR_AGO = () => new Date(Date.now() - 3600000);
  const NEXT_WEEK = () => new Date(Date.now() + 7 * 86400000);

  /** @param slots [status, publishAt] pairs */
  async function seed(status, slots) {
    const campaign = await BlogCampaign.create({
      user,
      site,
      name: 'scheduler test',
      targetPage: { url: 'https://example.com/x.html', keyword: 'mold mitigation' },
      status,
      slots: slots.map(([slotStatus, publishAt], i) => ({
        index: i,
        topic: `topic ${i}`,
        status: slotStatus,
        publishAt,
      })),
    });
    made.push(campaign._id);
    return campaign;
  }

  async function workFor(campaign) {
    const all = await findWork();
    const entry = all.get(String(site));
    if (!entry) return null;
    return entry.campaigns.includes(String(campaign._id)) ? entry : null;
  }

  async function clear() {
    await BlogCampaign.deleteMany({ site });
  }

  await test('a campaign being written is urgent', async () => {
    await clear();
    const c = await seed('writing', [['pending', NEXT_WEEK()]]);

    const entry = await workFor(c);
    assert.ok(entry, 'a batch in flight was not picked up — nobody would come and collect it');
    assert.strictEqual(entry.urgent, true,
      'the person who approved this is watching a progress bar; ten minutes is too long');
  });

  await test('posts written but not collected are urgent', async () => {
    await clear();
    const c = await seed('active', [['ready', NEXT_WEEK()]]);

    const entry = await workFor(c);
    assert.ok(entry, 'posts the customer has already paid for were left sitting on the server');
    assert.strictEqual(entry.urgent, true);
  });

  await test('a scheduled post past its date is picked up, but not urgently', async () => {
    await clear();
    const c = await seed('active', [['scheduled', HOUR_AGO()]]);

    const entry = await workFor(c);
    assert.ok(entry, 'WP-Cron missed this and nothing would ever have published it');
    assert.strictEqual(entry.urgent, false,
      'it is already an hour late — a slower cadence costs nothing and keeps the loop cheap');
  });

  await test('a scheduled post still in the future is left alone', async () => {
    await clear();
    const c = await seed('active', [['scheduled', NEXT_WEEK()]]);

    assert.strictEqual(await workFor(c), null,
      'pinging about a post that is not due yet would knock on every site every tick');
  });

  await test('the grace period keeps a just-passed post out of the sweep', async () => {
    await clear();
    const c = await seed('active', [['scheduled', new Date(Date.now() - 60000)]]);

    assert.strictEqual(await workFor(c), null,
      'one minute late is not late — WP-Cron has not had a chance, and the two clocks differ');
  });

  await test('a finished campaign is never knocked about', async () => {
    await clear();
    const c = await seed('completed', [['published', HOUR_AGO()]]);

    assert.strictEqual(await workFor(c), null);
  });

  await test('a paused campaign is never knocked about', async () => {
    await clear();
    const c = await seed('paused', [['scheduled', HOUR_AGO()]]);

    assert.strictEqual(await workFor(c), null,
      'pausing has to actually stop things, or it means nothing');
  });

  await test('a failed slot on its own is not work', async () => {
    await clear();
    const c = await seed('active', [['failed', HOUR_AGO()]]);

    assert.strictEqual(await workFor(c), null,
      'a failed slot needs a person to reopen it, not a ping');
  });

  await test('one urgent campaign makes the whole site urgent', async () => {
    await clear();
    await seed('active', [['scheduled', HOUR_AGO()]]);
    const urgent = await seed('writing', [['pending', NEXT_WEEK()]]);

    const entry = await workFor(urgent);
    assert.strictEqual(entry.urgent, true);
    assert.strictEqual(entry.campaigns.length, 2,
      'both campaigns should travel in the one ping — the plugin sorts out what to do');
  });

  await test('a scheduled slot and a late slot in different campaigns do not fake a match', async () => {
    await clear();

    // The $elemMatch case: one slot is scheduled, another is late, but no
    // single slot is both. Without $elemMatch Mongo would match this.
    const c = await seed('active', [
      ['scheduled', NEXT_WEEK()],
      ['published', HOUR_AGO()],
    ]);

    assert.strictEqual(await workFor(c), null,
      'the two conditions have to hold for the same slot, or every campaign matches');
  });

  await BlogCampaign.deleteMany({ _id: { $in: made } });
  await mongoose.disconnect();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

})();