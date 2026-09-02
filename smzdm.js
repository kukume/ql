/**
 * 什么值得买签到（Web 极验 + App）
 * cron: 32 6 * * *
 * const $ = new Env("什么值得买签到");
 *
 * export SMZDM_COOKIE="cookie"
 * Web 签到需要极验：export DAMAGOU_KEY="" 或 TWOCAPTCHA_KEY=""
 * 若未配置打码，将仅执行 App 签到
 */

const { Env, env, parseAccounts, request, md5, extract, geeTest, runAccounts } = require('./utils');

const $ = new Env('什么值得买签到');

async function webSign(cookie) {
  const init = await request('https://zhiyou.smzdm.com/user/getgeetest/geetest_captcha_init');
  const data = init.json?.data?.geetest_data;
  if (!data) throw new Error('获取极验参数失败');
  const gee = await geeTest(data.gt, data.challenge, 'https://www.smzdm.com/');
  const text = (
    await request(
      `https://zhiyou.smzdm.com/user/checkin/jsonp_checkin?callback=jQuery112406820925204571995_${Date.now()}&geetest_challenge=${gee.challenge}&geetest_validate=${gee.validate}&geetest_seccode=${encodeURIComponent(gee.secCode)}&_=${Date.now()}`,
      { cookie, headers: { referer: 'https://www.smzdm.com/' } }
    )
  ).text;
  const jsonText = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  const json = JSON.parse(jsonText);
  if (json.error_code !== 0) throw new Error(json.error_msg || 'Web 签到失败');
}

function appSignValue(cookie, t) {
  const sess = extract(cookie, 'sess=', ';');
  return md5(`f=android&sk=1&time=${t}&token=${sess}&v=10.0&weixin=0&key=apr1$AwP!wRRT$gJ/q.X24poeBInlUJC`).toUpperCase();
}

async function appSign(cookie) {
  const t = Date.now();
  const sess = extract(cookie, 'sess=', ';');
  if (!sess) throw new Error('cookie 中未找到 sess');
  const res = await request('https://user-api.smzdm.com/checkin', {
    method: 'POST',
    cookie,
    form: {
      touchstone_event: '',
      v: '10.0',
      sign: appSignValue(cookie, t),
      weixin: '0',
      time: String(t),
      sk: '1',
      token: sess,
      f: 'android',
      captcha: '',
    },
  });
  if (res.json?.error_code !== 0) throw new Error(res.json?.error_msg || 'App 签到失败');
}

async function sign(account) {
  const cookie = account.cookie;
  if (!cookie) throw new Error('未填写 cookie');
  const msgs = [];
  if (env('DAMAGOU_KEY') || env('TWOCAPTCHA_KEY')) {
    await webSign(cookie);
    msgs.push('Web签到成功');
  } else {
    msgs.push('未配置打码，跳过 Web 签到');
  }
  await appSign(cookie);
  msgs.push('App签到成功');
  return msgs.join('；');
}

(async () => {
  const accounts = parseAccounts(env('SMZDM_COOKIE'), ['cookie']);
  await runAccounts($?.name || '什么值得买', accounts, sign);
})().catch((e) => {
  console.log(`❌ ${e.message || e}`);
  process.exit(1);
});
