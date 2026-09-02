/**
 * 小米运动 / 乐心运动 修改步数
 * cron: 12 5 * * *
 * const $ = new Env("刷步数");
 *
 * 小米运动：
 * export XIAOMI_STEP="loginToken#步数"
 * 步数偏移：末尾加 #1 ，例如  token#20000#1
 *
 * 乐心运动：
 * export LEXIN_STEP="cookie#userid#accessToken#步数"
 * 步数偏移：末尾加 #1
 *
 * 也可 JSON：
 * [{"miLoginToken":"...","step":20000,"offset":true}]
 * [{"leXinCookie":"...","leXinUserid":"...","leXinAccessToken":"...","step":20000}]
 */

const { Env, env, loadAccounts, request, uuid, runAccounts } = require('./utils');

const $ = new Env('刷步数');
const UA = 'MiFit6.14.0 (24129PN74C; Android 16; Density/2.75)';

function applyOffset(step, offset) {
  const n = Number(step);
  if (!offset) return n;
  const delta = Math.floor(Math.random() * 2000) - 1000;
  return Math.max(0, n + delta);
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function formatDateTime(date, withTime) {
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  if (!withTime) return `${y}-${m}-${d}`;
  const h = pad(date.getHours() % 12 || 12);
  const mi = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  return `${y}-${m}-${d} ${h}:${mi}:${s}`;
}

async function leXinModify(account, step) {
  const now = new Date();
  const second = Math.floor(Date.now() / 1000);
  const url =
    `https://sports.lifesense.com/sport_service/sport/sport/uploadMobileStepV2?country=%E4%B8%AD%E5%9B%BD&city=%E6%9F%B3%E5%B7%9E&cityCode=450200&timezone=Asia%2FShanghai&latitude=24.368694&os_country=CN&channel=qq&language=zh&openudid=&platform=android&province=%E5%B9%BF%E8%A5%BF%E5%A3%AE%E6%97%8F%E8%87%AA%E6%B2%BB%E5%8C%BA&appType=6&requestId=${uuid()}&countryCode=&systemType=2&longitude=109.532216&devicemodel=V1914A&area=CN&screenwidth=1080&os_langs=zh&provinceCode=450000&promotion_channel=qq&rnd=3d51742c&version=4.6.7&areaCode=450203&requestToken=${uuid()}&network_type=wifi&osversion=10&screenheight=2267&ts=${second}`;
  const res = await request(url, {
    method: 'POST',
    cookie: account.leXinCookie,
    json: {
      list: [
        {
          active: 1,
          calories: Math.floor(step / 4),
          created: formatDateTime(now, true),
          dataSource: 2,
          dayMeasurementTime: formatDateTime(now, false),
          deviceId: 'M_NULL',
          distance: Math.floor(step / 3),
          id: uuid(),
          isUpload: 0,
          measurementTime: formatDateTime(now, true),
          priority: 0,
          step,
          type: 2,
          updated: Date.now(),
          userId: String(account.leXinUserid),
          DataSource: 2,
          exerciseTime: 0,
        },
      ],
    },
  });
  if (res.json?.code !== 200) throw new Error(res.json?.msg || '乐心修改步数失败');
}

async function getMiInfo(token) {
  const res = await request(
    `https://account-cn.huami.com/v1/client/app_tokens?app_name=com.xiaomi.hm.health&dn=api-user.huami.com%2Capi-mifit.huami.com%2Capp-analytics.huami.com&login_token=${token}`,
    { headers: { 'user-agent': UA } }
  );
  if (res.json?.result !== 'ok') throw new Error('登录已失效，请重新登录！！');
  return {
    appToken: res.json.token_info.app_token,
    userId: res.json.token_info.user_id,
  };
}

async function xiaomiModify(token, step) {
  const info = await getMiInfo(token);
  const tenDateStr = String(Date.now()).slice(0, 10);
  const date = formatDateTime(new Date(), false);
  const dataJson = JSON.stringify([
    {
      date,
      summary: JSON.stringify({
        v: 6,
        slp: {
          st: 1628296479,
          ed: 1628296479,
          dp: 0,
          lt: 0,
          wk: 0,
          usrSt: -1440,
          usrEd: -1440,
          wc: 0,
          is: 0,
          lb: 0,
          to: 0,
          dt: 0,
          rhr: 0,
          ss: 0,
        },
        stp: {
          ttl: step,
          dis: 10627,
          cal: 510,
          wk: 41,
          rn: 50,
          runDist: 7654,
          runCal: 397,
          stage: [],
        },
        goal: 8000,
        tz: '28800',
      }),
      source: 24,
      type: 0,
    },
  ]);
  const res = await request(`https://api-mifit-cn.huami.com/v1/data/band_data.json?&t=${Date.now()}`, {
    method: 'POST',
    headers: { apptoken: info.appToken, 'user-agent': UA },
    form: {
      userid: info.userId,
      last_sync_data_time: tenDateStr,
      device_type: '0',
      last_deviceid: 'DA932FFFFE8816E7',
      data_json: dataJson,
    },
  });
  if (res.json?.code === 1) return;
  if (res.json?.code === 0) throw new Error('步数修改失败，登录已失效');
  throw new Error('步数修改失败，未知错误');
}

function truthy(v) {
  return v === true || v === 1 || v === '1' || v === 'true';
}

async function sign(account) {
  const step = applyOffset(account.step || env('STEP_COUNT', '10000'), truthy(account.offset));
  if (!step || step <= 0) throw new Error('步数需大于 0');
  const msgs = [];
  if (account.miLoginToken) {
    await xiaomiModify(account.miLoginToken, step);
    msgs.push(`小米运动 ${step} 步`);
  }
  if (account.leXinCookie) {
    await leXinModify(account, step);
    msgs.push(`乐心运动 ${step} 步`);
  }
  if (!msgs.length) throw new Error('未绑定小米运动或乐心运动');
  return msgs.join('；');
}

async function collectAccounts() {
  const combined = await loadAccounts('STEP', ['miLoginToken', 'step', 'offset']);
  if (combined.length) return combined;
  const xiaomi = await loadAccounts('XIAOMI_STEP', ['miLoginToken', 'step', 'offset']);
  const lexin = await loadAccounts('LEXIN_STEP', [
    'leXinCookie',
    'leXinUserid',
    'leXinAccessToken',
    'step',
    'offset',
  ]);
  return [...xiaomi, ...lexin];
}

(async () => {
  await runAccounts($?.name || '刷步数', await collectAccounts(), sign);
})().catch((e) => {
  console.log(`❌ ${e.message || e}`);
  process.exit(1);
});
