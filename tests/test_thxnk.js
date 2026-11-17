const test = require('node:test');
const assert = require('node:assert/strict');
const thxnk = require('../lib/providers/thxnk');
const account = { id: 'test', username: 'test', password: 'private-password', baseUrl: 'https://thxnk.cc' };
function response(data, cookies = [], status = 200) {
  return { ok: status >= 200 && status < 300, status, headers: { getSetCookie: () => cookies }, json: async () => data };
}
const result = idempotent => ({ wallet: { currency: 'TOKEN', balance_minor: 125 },
  checkin: { checkin_date: '2026-11-04', reward_minor: 100 }, idempotent });
test('check-in logs in, sends CSRF and converts minor units; repeat returns zero reward', async t => {
  for (const already of [false, true]) {
    let calls = 0;
    t.mock.method(global, 'fetch', async (url, options) => {
      assert.equal(options.redirect, 'error');
      calls++;
      if (calls === 1) {
        assert.equal(url.pathname, '/api/v1/auth/login');
        assert.equal(JSON.parse(options.body).account_name, 'test');
        return response({ ok: true, data: { authenticated: true } }, ['next_session=session; HttpOnly', 'next_csrf=csrf; Path=/']);
      }
      assert.equal(url.pathname, '/api/v1/finance/checkins');
      assert.equal(options.headers['X-CSRF-Token'], 'csrf');
      assert.equal(options.headers.Cookie, 'next_session=session; next_csrf=csrf');
      return response({ ok: true, data: result(already) });
    });
    const out = await thxnk.runAccountCheckin(account);
    assert.equal(out.account.lastCheckin.ok, true);
    assert.equal(out.account.lastCheckin.points, already ? 0 : 1);
    assert.equal(out.account.lastStatus.points, 1.25);
    assert.equal(out.account.lastCheckin.currency, '只因');
    assert.equal(out.account.lastCheckin.already, already);
    assert.equal(out.account.cookie, undefined);
    assert.equal(calls, 2);
    t.mock.restoreAll();
  }
});
test('failed login never submits check-in and incomplete results never pass', async t => {
  let calls = 0;
  t.mock.method(global, 'fetch', async () => {
    calls++;
    return response({ ok: false, error: { message: '凭据错误' } }, [], 401);
  });
  const out = await thxnk.runAccountCheckin(account);
  assert.equal(out.account.lastCheckin.ok, false);
  assert.equal(calls, 1);
  assert.equal(out.account.lastCheckin.message, '凭据错误');
  assert.throws(() => thxnk.summarizeCheckin({}), /不明确/);
  assert.throws(() => thxnk.minorAmount('100'), /格式异常/);
});
test('wallet status considers only check-in credits, excluding activation or transfer', () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const data = { wallet: { currency: 'TOKEN', balance_minor: 100 }, ledger: { items: [
    { direction: 'debit', reference_type: 'media.emby_activation', reference_id: today }
  ] } };
  assert.equal(thxnk.summarizeStatus(data).todaySigned, false);
  data.ledger.items.push({ direction: 'credit', reference_type: 'finance.checkin', reference_id: today });
  assert.equal(thxnk.summarizeStatus(data).todaySigned, true);
});
