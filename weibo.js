/**
 * 微博超话签到
 * cron: 51 4 * * *
 * const $ = new Env("微博超话签到");
 *
 * export WEIBO_COOKIE="SUB=xxx; ..."
 * 多账号：青龙建多个同名变量，或换行 / @#@ 分隔
 */

const { Env, loadAccounts, request, mergeCookie, runAccounts } = require('./utils');

const $ = new Env('微博超话签到');

async function getToken(cookie) {
  const res = await request('https://m.weibo.cn/api/config', { cookie });
  const data = res.json?.data;
  if (!data?.login) throw new Error('cookie已失效');
  return {
    token: data.st,
    cookie: mergeCookie(res.setCookie, cookie),
  };
}

async function sign(account) {
  const cookie = account.cookie;
  if (!cookie) throw new Error('未填写 cookie');
  const weiboToken = await getToken(cookie);
  const res = await request(
    'https://m.weibo.cn/api/container/getIndex?containerid=100803_-_followsuper&luicode=10000011&lfid=231093_-_chaohua',
    {
      cookie: weiboToken.cookie,
      headers: { 'x-xsrf-token': weiboToken.token },
    }
  );
  if (res.status !== 200) throw new Error('cookie已失效');
  const json = res.json;
  if (json?.ok !== 1) throw new Error('获取关注超话列表失败');
  const cards = json.data?.cards?.[0]?.card_group || [];
  let count = 0;
  for (const any of cards) {
    const buttons = any.buttons || [];
    for (const bu of buttons) {
      if (bu.name !== '签到') continue;
      const scheme = `https://m.weibo.cn${bu.scheme}`;
      await request(scheme, {
        method: 'POST',
        cookie: mergeCookie(weiboToken.cookie, res.setCookie),
        headers: {
          'x-xsrf-token': weiboToken.token,
          referer:
            'https://m.weibo.cn/p/tabbar?containerid=100803_-_followsuper&luicode=10000011&lfid=231093_-_chaohua&page_type=tabbar',
          'mweibo-pwa': '1',
        },
        form: { st: weiboToken.token, _spr: 'screen:393x851' },
      });
      count += 1;
    }
  }
  return `超话签到 ${count} 个`;
}

(async () => {
  const accounts = await loadAccounts('WEIBO_COOKIE', ['cookie']);
  await runAccounts($?.name || '微博超话', accounts, sign);
})().catch((e) => {
  console.log(`❌ ${e.message || e}`);
  process.exit(1);
});
