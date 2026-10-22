const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runAccountCheckin } = require('../lib/providers/zzcat');
const core = (signed, score = 100) => ({ ok: true, data: { sessionUser: { username: 'test' }, profile: { checkedInToday: signed, score, name: 'test' }, billing: { private: 'never-copy' } } });
async function run(t, responses) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ path: url.pathname, method: options.method, cookie: options.headers.Cookie });
    const r = responses.shift(); assert.ok(r, 'unexpected request');
    assert.equal(url.pathname, r.path);
    if (r.error) throw new Error(r.error);
    return { ok: (r.status || 200) < 400, status: r.status || 200,
      headers: { getSetCookie: () => r.cookies || [] }, json: async () => r.data };
  });
  const result = await runAccountCheckin({ id: 'test', name: 'test', cookie: 'qp_session=private' });
  assert.equal(responses.length, 0);
  assert.ok(!JSON.stringify(result.summary).includes('private'));
  assert.ok(!JSON.stringify(result.summary).includes('never-copy'));
  return { ...result, calls };
}
const statusPath = '/api/miniapp/bootstrap/core';
test('ZzCat records an explicit web check-in reward and rotated session', async t => {
  const r = await run(t, [
    { path: statusPath, data: core(false), cookies: ['qp_session=rotated; Path=/; HttpOnly'] },
    { path: '/api/user/checkin', data: { ok: true, data: { awardedNow: true, reward: 20, newScore: 120, businessDay: '2026-10-22' } } }
  ]);
  assert.equal(r.account.cookie, 'qp_session=rotated');
  assert.equal(r.calls[1].cookie, 'qp_session=rotated');
  assert.equal(r.summary.checkin.points, 20);
  assert.equal(r.summary.checkin.balance, 120);
  assert.equal(r.summary.status.todaySigned, true);
});
test('ZzCat skips a day already checked in without a POST', async t => {
  const r = await run(t, [{ path: statusPath, data: core(true, 1428) }]);
  assert.equal(r.summary.checkin.already, true);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].method, 'GET');
});
test('ZzCat reports an expired session without attempting a check-in', async t => {
  const r = await run(t, [{ path: statusPath, status: 401, data: {} }]);
  assert.equal(r.summary.checkin.ok, false);
  assert.equal(r.summary.status.state, 'unauthorized');
});
test('ZzCat rejects incomplete user data', async t => {
  const r = await run(t, [{ path: statusPath, data: { ok: true, data: {} } }]);
  assert.equal(r.summary.checkin.ok, false);
});
test('ZzCat confirms a check-in after a lost POST response', async t => {
  const r = await run(t, [
    { path: statusPath, data: core(false) },
    { path: '/api/user/checkin', error: 'timeout' },
    { path: statusPath, data: core(true, 120) }
  ]);
  assert.equal(r.summary.checkin.already, true);
  assert.equal(r.summary.checkin.balance, 120);
});
test('ZzCat does not claim success from an ambiguous API response', async t => {
  const r = await run(t, [
    { path: statusPath, data: core(false) },
    { path: '/api/user/checkin', data: { ok: true, data: { newScore: 120 } } }
  ]);
  assert.equal(r.summary.checkin.ok, false);
});
test('ZzCat handles an idempotent concurrent check-in', async t => {
  const r = await run(t, [
    { path: statusPath, data: core(false) },
    { path: '/api/user/checkin', data: { ok: true, data: { awardedNow: false, reward: 20, newScore: 120 } } }
  ]);
  assert.equal(r.summary.checkin.already, true);
  assert.equal(r.summary.checkin.points, 0);
});
