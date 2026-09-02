/**
 * NodeSeek 签到
 * cron: 25 2 * * *
 * const $ = new Env("NodeSeek签到");
 *
 * export NODESEEK_COOKIE="cookie"
 * export NODESEEK_RANDOM="true"   # true 随机奖励，false 固定奖励
 * 多账号用 & 或换行分隔；若账号需要不同模式可用 JSON：
 * [{"cookie":"...","random":true,"remarks":"主号"}]
 */

const { Env, env, parseAccounts, request, runAccounts } = require('./utils');

const $ = new Env('NodeSeek签到');

async function sign(account) {
  const cookie = account.cookie;
  if (!cookie) throw new Error('未填写 cookie');
  const random = String(account.random ?? env('NODESEEK_RANDOM', 'true')) !== 'false';
  const res = await request(`https://www.nodeseek.com/api/attendance?random=${random}`, {
    method: 'POST',
    cookie,
    headers: {
      origin: 'https://www.nodeseek.com',
      referer: 'https://www.nodeseek.com/board',
    },
  });
  if (res.status === 403) throw new Error('未通过 cloudflare 验证，请上传浏览器在 NodeSeek 上的全部 cookie');
  const json = res.json;
  if (json?.success) return `获得 ${json.gain} 鸡腿`;
  throw new Error(json?.message || res.text || '签到失败');
}

(async () => {
  const accounts = parseAccounts(env('NODESEEK_COOKIE'), ['cookie']);
  await runAccounts($?.name || 'NodeSeek', accounts, sign);
})().catch((e) => {
  console.log(`❌ ${e.message || e}`);
  process.exit(1);
});
