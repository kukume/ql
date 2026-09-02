/**
 * NodeLoc 签到
 * cron: 13 5 * * *
 * const $ = new Env("NodeLoc签到");
 *
 * export NODELOC="cookie#csrf"
 * 或 JSON：[{"cookie":"...","csrf":"..."}]
 */

const { Env, loadAccounts, request, runAccounts } = require('./utils');

const $ = new Env('NodeLoc签到');

async function sign(account) {
  const cookie = account.cookie;
  const csrf = account.csrf;
  if (!cookie || !csrf) throw new Error('请填写 cookie#csrf');
  const res = await request('https://www.nodeloc.com/checkin', {
    method: 'POST',
    cookie,
    headers: {
      accept: 'application/json',
      'x-csrf-token': csrf,
    },
  });
  if (res.json?.errors) throw new Error(res.json.errors[0] || '签到失败');
  const points = res.json?.points;
  return points != null ? `签到成功，积分 ${points}` : '签到成功';
}

(async () => {
  const accounts = await loadAccounts(['NODELOC', 'NODELOC_COOKIE'], ['cookie', 'csrf']);
  await runAccounts($?.name || 'NodeLoc', accounts, sign);
})().catch((e) => {
  console.log(`❌ ${e.message || e}`);
  process.exit(1);
});
