/**
 * 米哈游签到（原神 + 米游社）
 * cron: 13 8 * * *
 * const $ = new Env("米哈游签到");
 *
 * 原神签到需要 web cookie：
 * export MIHOYO_COOKIE="cookie_token=xxx; account_id=xxx; ..."
 *
 * 米游社签到需要 app stoken：
 * export MIHOYO_TOKEN="aid#token#mid"
 * hubCookie 格式为 stuid=aid; stoken=token; mid=mid;
 *
 * 也可用 JSON 一次配齐：
 * export MIHOYO='[{"cookie":"...","token":"...","aid":"...","mid":"...","remarks":"主号"}]'
 *
 * 极验打码（可选）：export DAMAGOU_KEY="" 或 TWOCAPTCHA_KEY=""
 */

const { Env, env, parseAccounts, request, sleep, md5, letter, uuid, geeTest, runAccounts } = require('./utils');

const $ = new Env('米哈游签到');

function createFix() {
  return {
    fp: letter(13),
    device: uuid(),
    app: 'bll8iq97cem8',
  };
}

function hubDs() {
  const salt = 'AcpNVhfh0oedCobdCyFV8EE1jMOVDy9q';
  const time = Math.floor(Date.now() / 1000);
  const randomLetter = letter(6);
  const hash = md5(`salt=${salt}&t=${time}&r=${randomLetter}`);
  return { appVersion: '2.60.1', clientType: '2', ds: `${time},${randomLetter},${hash}` };
}

function hubNewDs(data) {
  const salt = 't0qEgfub6cvueAPgR5m9aQWWVciEer7v';
  const t = Math.floor(Date.now() / 1000);
  const r = String(Math.floor(Math.random() * 100000) + 100001);
  const b = data ? JSON.stringify(data) : '{}';
  const c = md5(`salt=${salt}&t=${t}&r=${r}&b=${b}&q=`);
  return { appVersion: '2.60.1', clientType: '2', ds: `${t},${r},${c}` };
}

function appDs() {
  const salt = 'JwYDpKvLj6MrMqqYU6jTKF17KNO2PXoS';
  const time = Math.floor(Date.now() / 1000);
  const randomLetter = letter(6);
  const hash = md5(`salt=${salt}&t=${time}&r=${randomLetter}`);
  return { appVersion: '2.63.1', clientType: '5', ds: `${time},${randomLetter},${hash}` };
}

function commonHeaders(fix, ds) {
  return {
    'x-rpc-device_id': String(fix.device).replace(/-/g, ''),
    'x-rpc-client_type': ds.clientType,
    'x-rpc-app_version': ds.appVersion,
    'x-rpc-device_fp': fix.fp,
    DS: ds.ds,
  };
}

function appHeaders(fix) {
  const ds = appDs();
  return {
    ...commonHeaders(fix, ds),
    'user-agent': `Mozilla/5.0 (iPhone; CPU iPhone OS 14_0_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) miHoYoBBS/${ds.appVersion}`,
  };
}

function hubHeaders(fix) {
  const ds = hubDs();
  return {
    ...commonHeaders(fix, ds),
    referer: 'https://app.mihoyo.com',
  };
}

function hubNewHeaders(fix, data) {
  const ds = hubNewDs(data);
  return {
    ...commonHeaders(fix, ds),
    referer: 'https://app.mihoyo.com',
  };
}

function check(json) {
  if (!json || json.retcode !== 0) throw new Error(json?.message || '米哈游接口失败');
}

function hubCookie(account) {
  const aid = account.aid || account.stuid;
  const token = account.token || account.stoken;
  const mid = account.mid;
  if (!aid || !token || !mid) return '';
  return `stuid=${aid}; stoken=${token}; mid=${mid}; `;
}

async function genshinSignOne(cookie, fix, role, gee) {
  const headers = {
    ...appHeaders(fix),
    'x-rpc-signgame': 'hk4e',
  };
  if (gee) {
    headers['x-rpc-validate'] = gee.validate;
    headers['x-rpc-seccode'] = gee.secCode;
    headers['x-rpc-challenge'] = gee.challenge;
  }
  return request('https://api-takumi.mihoyo.com/event/luna/sign', {
    method: 'POST',
    cookie,
    headers,
    json: {
      act_id: 'e202311201442471',
      region: role.region,
      uid: role.game_uid,
      lang: 'zh-cn',
    },
  });
}

async function genshinSign(account, fix) {
  const cookie = account.cookie;
  if (!cookie) throw new Error('未设置 cookie，无法原神签到');
  const roles = await request('https://api-takumi.mihoyo.com/binding/api/getUserGameRolesByCookie?game_biz=hk4e_cn', {
    cookie,
  });
  if (roles.json?.retcode !== 0) throw new Error(roles.json?.message || '获取原神角色失败');
  const list = roles.json?.data?.list || [];
  if (!list.length) throw new Error('您还没有原神角色！！');
  const msgs = [];
  for (const role of list) {
    let res = await genshinSignOne(cookie, fix, role);
    const code = res.json?.retcode;
    if (code === 0 || code === -5003) {
      const gt = res.json?.data?.gt || '';
      if (gt) {
        const challenge = res.json.data.challenge;
        const gee = await geeTest(gt, challenge, 'https://webstatic.mihoyo.com/');
        res = await genshinSignOne(cookie, fix, role, gee);
        if (![0, -5003].includes(res.json?.retcode)) throw new Error(res.json?.message || '原神签到失败');
      }
      msgs.push(`${role.nickname || role.game_uid}${code === -5003 ? '已签' : '签到成功'}`);
    } else {
      throw new Error(res.json?.message || '未知错误');
    }
    await sleep(3000);
  }
  return msgs.join('，');
}

async function hubVerifyGeeTest(cookie, fix) {
  const create = await request('https://bbs-api.miyoushe.com/misc/api/createVerification?is_high=true', {
    cookie,
    headers: hubNewHeaders(fix),
  });
  check(create.json);
  const challenge = create.json.data.challenge;
  const gt = create.json.data.gt;
  const rr = await geeTest(gt, challenge, 'https://bbs.mihoyo.com');
  const verify = await request('https://bbs-api.miyoushe.com/misc/api/verifyVerification', {
    method: 'POST',
    cookie,
    headers: hubNewHeaders(fix),
    json: {
      geetest_challenge: rr.challenge,
      geetest_seccode: rr.secCode,
      geetest_validate: rr.validate,
    },
  });
  check(verify.json);
}

async function hubSign(cookie, fix) {
  const list = [2, 5, 8, 6, 1, 3, 4];
  for (const i of list) {
    await sleep(1500);
    const body = { gids: String(i) };
    let res = await request('https://bbs-api.miyoushe.com/apihub/app/api/signIn', {
      method: 'POST',
      cookie,
      headers: hubNewHeaders(fix, body),
      json: body,
    });
    const code = res.json?.retcode;
    if (code === 1034) await hubVerifyGeeTest(cookie, fix);
    if ([1008, 0].includes(code)) continue;
    res = await request('https://bbs-api.miyoushe.com/apihub/app/api/signIn', {
      method: 'POST',
      cookie,
      headers: hubNewHeaders(fix, body),
      json: body,
    });
    check(res.json);
  }
}

async function mysSign(account, fix) {
  const cookie = hubCookie(account);
  if (!cookie) throw new Error('未设置 token，请填写 aid#token#mid');
  const postRes = await request(
    'https://bbs-api.miyoushe.com/post/wapi/getForumPostList?forum_id=26&gids=2&is_good=false&is_hot=false&page_size=20&sort_type=2'
  );
  check(postRes.json);
  const posts = postRes.json.data.list || [];
  for (let i = 0; i < 3; i++) {
    const postId = posts[i]?.post?.post_id;
    const res = await request(`https://bbs-api.mihoyo.com/post/api/getPostFull?post_id=${postId}&is_cancel=false`, {
      cookie,
      headers: hubHeaders(fix),
    });
    check(res.json);
  }
  for (let i = 0; i < 5; i++) {
    const postId = posts[i]?.post?.post_id;
    const res = await request('https://bbs-api.mihoyo.com/apihub/sapi/upvotePost', {
      method: 'POST',
      cookie,
      headers: hubHeaders(fix),
      json: { csm_source: 'home', is_cancel: false, post_id: String(postId), upvote_type: '1' },
    });
    check(res.json);
  }
  const share = await request(
    `https://bbs-api.mihoyo.com/apihub/api/getShareConf?entity_id=${posts[0]?.post?.post_id}&entity_type=1`,
    { cookie, headers: hubHeaders(fix) }
  );
  check(share.json);
  await hubSign(cookie, fix);
  return '米游社浏览/点赞/分享/签到完成';
}

async function sign(account) {
  const fix = account.fix || createFix();
  const doGenshin = env('MIHOYO_SKIP_GENSHIN', 'false') !== 'true' && Boolean(account.cookie);
  const doMys = env('MIHOYO_SKIP_MYS', 'false') !== 'true' && Boolean(hubCookie(account));
  if (!doGenshin && !doMys) throw new Error('请至少配置 MIHOYO_COOKIE 或 MIHOYO_TOKEN');
  const msgs = [];
  if (doGenshin) msgs.push(await genshinSign(account, fix));
  if (doMys) msgs.push(await mysSign(account, fix));
  return msgs.join('；');
}

function loadAccounts() {
  if (env('MIHOYO')) return parseAccounts(env('MIHOYO'), ['cookie']);
  const cookies = parseAccounts(env('MIHOYO_COOKIE'), ['cookie']);
  const tokens = parseAccounts(env('MIHOYO_TOKEN'), ['aid', 'token', 'mid']);
  const max = Math.max(cookies.length, tokens.length);
  const list = [];
  for (let i = 0; i < max; i++) {
    list.push({
      remarks: cookies[i]?.remarks || tokens[i]?.remarks || `账号${i + 1}`,
      ...(cookies[i] || {}),
      ...(tokens[i] || {}),
    });
  }
  return list;
}

(async () => {
  await runAccounts($?.name || '米哈游', loadAccounts(), sign);
})().catch((e) => {
  console.log(`❌ ${e.message || e}`);
  process.exit(1);
});
