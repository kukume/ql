/**
 * 斗鱼鱼吧签到
 * cron: 3 6 * * *
 * const $ = new Env("斗鱼鱼吧签到");
 *
 * export DOUYU_COOKIE="acf_auth=xxx; ..."
 * 多账号用 & 或换行分隔
 */

const { Env, env, parseAccounts, request, sleep, mergeCookie, cookieValue, runAccounts } = require('./utils');

const $ = new Env('斗鱼鱼吧签到');

function timestamp() {
  return String(Date.now()).slice(0, 8);
}

async function yuBaCookie(cookie) {
  const login = await request(
    `https://passport.douyu.com/lapi/passport/iframe/safeAuth?callback=jQuery111309004936224711857_1671594747590&client_id=5&did=&t=1671594747991&_=${Date.now()}`,
    { cookie, headers: { referer: 'https://yuba.douyu.com/' } }
  );
  if (![301, 302].includes(login.status) || !login.location) {
    throw new Error('鱼吧签到失败，cookie已失效，请重新登录');
  }
  const nextUrl = login.location.startsWith('http') ? login.location : `https:${login.location}`;
  const auth = await request(nextUrl, { cookie, headers: { referer: 'https://yuba.douyu.com/' } });
  return auth.setCookie;
}

async function sign(account) {
  const cookie = account.cookie;
  if (!cookie) throw new Error('未填写 cookie');
  const fullCookie = mergeCookie(cookie, await yuBaCookie(cookie));
  const listRes = await request(
    `https://yuba.douyu.com/wbapi/web/group/myFollow?page=1&limit=30&official=1&timestamp=${timestamp()}`,
    { cookie: fullCookie, headers: { referer: 'https://yuba.douyu.com/allclassify/featurelist' } }
  );
  const json = listRes.json;
  if (!json || json.status_code !== 200) throw new Error(typeof json?.data === 'string' ? json.data : '获取关注鱼吧失败');
  const groups = json.data?.list || [];
  let signed = 0;
  let skipped = 0;
  for (const node of groups) {
    const id = node.group_id;
    const info = await request(`https://yuba.douyu.com/wbapi/web/group/head?group_id=${id}&timestamp=${timestamp()}`, {
      cookie: fullCookie,
    });
    const infoNode = info.json;
    const exp = infoNode?.data?.group_exp ?? 0;
    const isSign = infoNode?.data?.is_signed ?? 1;
    const infoCookie = mergeCookie(fullCookie, info.setCookie);
    if (isSign === 0) {
      const csrf = cookieValue(info.setCookie, 'acf_yb_t');
      const signRes = await request(`https://yuba.douyu.com/ybapi/topic/sign?timestamp=${timestamp()}`, {
        method: 'POST',
        cookie: infoCookie,
        headers: {
          referer: `https://yuba.douyu.com/group/${id}`,
          'x-csrf-token': csrf,
        },
        form: { group_id: String(id), cur_exp: String(exp) },
      });
      if (signRes.json?.status_code !== 200) {
        throw new Error(typeof signRes.json?.data === 'string' ? signRes.json.data : `鱼吧 ${id} 签到失败`);
      }
      signed += 1;
    } else {
      skipped += 1;
    }
    await sleep(5000);
  }
  return `签到 ${signed} 个，已签 ${skipped} 个`;
}

(async () => {
  const accounts = parseAccounts(env('DOUYU_COOKIE'), ['cookie']);
  await runAccounts($?.name || '斗鱼鱼吧', accounts, sign);
})().catch((e) => {
  console.log(`❌ ${e.message || e}`);
  process.exit(1);
});
