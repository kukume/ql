/**
 * 百度签到（贴吧 + 游帮帮）
 * cron: 41 2 * * *
 * const $ = new Env("百度签到");
 *
 * export BAIDU_COOKIE="BDUSS=xxx; STOKEN=xxx;"
 * 多账号用 & 或换行分隔，也支持 JSON：[{"cookie":"...","remarks":"小号"}]
 */

const {
  Env,
  env,
  parseAccounts,
  request,
  sleep,
  mergeCookie,
  cookieValue,
  loadCheerio,
  runAccounts,
} = require('./utils');

const $ = new Env('百度签到');

function ybbHeaders() {
  return {
    'X-Channel-Name': 'xiaomi',
    'X-Device-Name': 'android',
    'X-Client-Version': '2.3.14',
    'X-System-Version': '31',
    'X-Auth-Timestamp': String(Date.now()),
  };
}

async function ybbWatchAd(cookie, version = 'v2') {
  const pre = await request(`https://api-gt.baidu.com/v1/server/task?version=${version}`, {
    cookie,
    headers: ybbHeaders(),
  });
  const preJson = pre.json;
  if (!preJson || !preJson.success) throw new Error(preJson?.errors?.message_cn || '游帮帮任务获取失败');
  const tasks = (preJson.result || []).filter((item) => ['看视频送时长', '看视频送积分'].includes(item.name));
  if (!tasks.length) throw new Error('没有这个任务');
  const task = tasks[0];
  const tenTime = Math.floor(Date.now() / 1000);
  const result = await request(
    `https://api-gt.baidu.com/v1/server/task${version.includes('v3') ? '?version=v3' : ''}`,
    {
      method: 'POST',
      cookie,
      headers: ybbHeaders(),
      json: {
        end_time: tenTime,
        start_time: tenTime,
        task: task.id,
        sign: task.sign,
      },
    }
  );
  if (!result.json || !result.json.success) throw new Error(result.json?.errors?.message_cn || '游帮帮看广告失败');
}

async function ybbSign(cookie) {
  const res = await request('https://ybb.baidu.com/api/v1/server/scores', {
    method: 'POST',
    cookie,
    headers: {
      ...ybbHeaders(),
      referer:
        'https://ybb.baidu.com/m/pages/h5/sign-activity?channel=xiaomi&device=android&appversion=2.3.14&cuid=8D795D0D8C8AB781BD0E0B807B0B1B0F%7CVCUIVQGDM&systemversion=31',
      'user-agent':
        'Mozilla/5.0 (Linux; Android 12; M2007J3SC Build/SKQ1.211006.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/100.0.4896.79 Mobile Safari/537.36 com.baidu.ybb/2.3.14',
    },
    json: { type: 'daily' },
  });
  if (!res.json || !res.json.success) throw new Error(res.json?.errors?.message_cn || '游帮帮签到失败');
}

async function ybbExchangeVip(cookie) {
  const res = await request('https://api-gt.baidu.com/v1/server/reward_records', {
    method: 'POST',
    cookie,
    headers: ybbHeaders(),
    json: { award_id: 48 },
  });
  if (!res.json || !res.json.success) throw new Error(res.json?.errors?.message_cn || '游帮帮兑换失败');
}

async function getSToken(cookie, url) {
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/101.0.4951.67 Safari/537.36';
  const first = await request(
    `https://wappass.baidu.com/v3/login/api/auth?jump=&notjump=1&return_type=3&tpl=tb&u=${encodeURIComponent(url)}`,
    { cookie, headers: { 'user-agent': ua } }
  );
  if (![301, 302].includes(first.status) || !first.location) throw new Error('您的百度cookie已失效！');
  const second = await request(first.location, { cookie, headers: { 'user-agent': ua } });
  const sToken = cookieValue(second.setCookie, 'STOKEN');
  if (!sToken) throw new Error('获取sToken失败');
  return sToken;
}

function tieBaCookie(cookie, sToken) {
  const bduss = String(cookie).match(/BDUSS=.*?;/)?.[0];
  if (!bduss) throw new Error('cookie 中未找到 BDUSS');
  return `${bduss}STOKEN=${sToken}; `;
}

function parseLikeNames(html) {
  const cheerio = loadCheerio();
  const names = [];
  if (cheerio) {
    const $html = cheerio.load(html);
    $html('tr a[title]').each((_, el) => {
      const title = $html(el).attr('title');
      if (title) names.push(title);
    });
    return names;
  }
  for (const match of html.matchAll(/<tr[\s\S]*?<a[^>]*title="([^"]+)"/g)) {
    names.push(match[1]);
  }
  return names;
}

async function tieBaSign(cookie) {
  const url = `https://tieba.baidu.com/f/like/mylike?v=${Date.now()}`;
  let sToken = cookieValue(cookie, 'STOKEN') || (await getSToken(cookie, url));
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
  const baiduHome = await request('https://www.baidu.com/', { headers: { 'user-agent': ua } });
  let headersCookie = mergeCookie(tieBaCookie(cookie, sToken), baiduHome.setCookie);
  let like = await request(url, { cookie: headersCookie, headers: { 'user-agent': ua } });
  if (!like.text) {
    sToken = await getSToken(cookie, url);
    headersCookie = mergeCookie(tieBaCookie(cookie, sToken), baiduHome.setCookie);
    like = await request(url, { cookie: headersCookie, headers: { 'user-agent': ua } });
  }
  const names = parseLikeNames(like.text);
  let ok = 0;
  for (const name of names) {
    await sleep(5000);
    const res = await request('https://tieba.baidu.com/sign/add', {
      method: 'POST',
      cookie: headersCookie,
      headers: { 'user-agent': ua },
      form: { ie: 'utf-8', kw: name },
    });
    const json = res.json || {};
    if (![0, 1101].includes(json.no)) throw new Error(json.error || `贴吧[${name}]签到失败`);
    ok += 1;
  }
  return `贴吧 ${ok}/${names.length}`;
}

async function sign(account) {
  const cookie = account.cookie || account.BAIDU_COOKIE;
  if (!cookie) throw new Error('未填写 cookie');
  const msgs = [];
  for (let i = 0; i < 12; i++) {
    await sleep(15000);
    await ybbWatchAd(cookie);
  }
  for (let i = 0; i < 4; i++) {
    await sleep(30000);
    await ybbWatchAd(cookie, 'v3');
  }
  await ybbSign(cookie);
  await sleep(2000);
  try {
    await ybbExchangeVip(cookie);
    msgs.push('游帮帮完成并兑换会员');
  } catch (e) {
    msgs.push(`游帮帮完成，兑换：${e.message}`);
  }
  msgs.push(await tieBaSign(cookie));
  return msgs.join('；');
}

(async () => {
  const accounts = parseAccounts(env('BAIDU_COOKIE'), ['cookie']);
  await runAccounts($?.name || '百度', accounts, sign);
})().catch((e) => {
  console.log(`❌ ${e.message || e}`);
  process.exit(1);
});
