/**
 * 天翼云盘签到
 * cron: 14 2 * * *
 * const $ = new Env("天翼云盘签到");
 *
 * 方式一：已登录 cookie
 * export ECLOUD="cookie#eCookie"
 * 或 JSON：[{"cookie":"...","eCookie":"..."}]
 *
 * 方式二：账号密码
 * export ECLOUD="用户名#密码"
 */

const {
  Env,
  env,
  parseAccounts,
  request,
  sleep,
  digits,
  rsaEncrypt,
  rsaEncryptToHex,
  runAccounts,
} = require('./utils');

const $ = new Env('天翼云盘签到');

const UA =
  'Mozilla/5.0 (Linux; Android 5.1.1; SM-G930K Build/NRD90M; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/74.0.3729.136 Mobile Safari/537.36 Ecloud/8.6.3 Android/22 clientId/355325117317828 clientModel/SM-G930K imsi/460071114317824 clientChannelId/qq proVersion/1.0.6';

function extractQuery(url, key) {
  const match = String(url).match(new RegExp(`[?&]${key}=([^&]+)`));
  return match ? decodeURIComponent(match[1]) : '';
}

async function login(username, password) {
  const first = await request(
    'https://cloud.189.cn/api/portal/loginUrl.action?redirectURL=https%3A%2F%2Fcloud.189.cn%2Fweb%2Fredirect.html&defaultSaveName=3&defaultSaveNameCheck=uncheck&browserId=c7044c4577d2d903bbb74a956c11274d'
  );
  if (!first.location) throw new Error('未能成功跳转');
  const second = await request(first.location);
  const ltUrl = second.location;
  if (!ltUrl) throw new Error('未能成功跳转');
  const lt = extractQuery(ltUrl, 'lt');
  const reqId = extractQuery(ltUrl, 'reqId');
  if (!lt || !reqId) throw new Error('未能成功获取 lt/reqId');
  const headers = { cookie: second.setCookie, lt, referer: ltUrl, reqId };
  const configRes = await request('https://open.e.189.cn/api/logbox/oauth2/appConf.do', {
    method: 'POST',
    headers,
    form: { version: '2.0', appKey: 'cloud' },
  });
  const encryptRes = await request('https://open.e.189.cn/api/logbox/config/encryptConf.do', {
    method: 'POST',
    form: { appId: 'cloud' },
  });
  const paramId = configRes.json?.data?.paramId;
  if (!paramId) throw new Error('not found paramId');
  const pre = encryptRes.json?.data?.pre || '';
  const pubKey = encryptRes.json?.data?.pubKey;
  const need = await request('https://open.e.189.cn/api/logbox/oauth2/needcaptcha.do', {
    method: 'POST',
    form: {
      accountType: '01',
      userName: pre + rsaEncrypt(username, pubKey),
      appKey: 'cloud',
    },
  });
  if (need.text !== '0') throw new Error('需要验证码，请在任意设备成功登陆一次再试');
  const loginRes = await request('https://open.e.189.cn/api/logbox/oauth2/loginSubmit.do', {
    method: 'POST',
    headers,
    form: {
      version: 'v2.0',
      apToken: '',
      appKey: 'cloud',
      accountType: '01',
      userName: pre + rsaEncryptToHex(username, pubKey),
      epd: pre + rsaEncryptToHex(password, pubKey),
      captchaType: '',
      validateCode: '',
      smsValidateCode: '',
      captchaToken: '',
      returnUrl:
        'https%3A%2F%2Fcloud.189.cn%2Fapi%2Fportal%2FcallbackUnify.action%3FredirectURL%3Dhttps%253A%252F%252Fcloud.189.cn%252Fweb%252Fredirect.html',
      mailSuffix: '@189.cn',
      dynamicCheck: 'FALSE',
      clientType: '1',
      cb_SaveName: '3',
      isOauth2: 'false',
      state: '',
      paramId,
    },
  });
  if (String(loginRes.json?.result) !== '0') throw new Error(loginRes.json?.msg || '登录失败');
  const toUrl = loginRes.json.toUrl;
  const jump = await request(toUrl);
  return { eCookie: loginRes.setCookie, cookie: jump.setCookie };
}

async function updateCookie(entity) {
  const check = await request(`https://cloud.189.cn/api/portal/listFiles.action?noCache=0.${digits(16)}&fileId=-11`, {
    cookie: entity.cookie,
  });
  if (check.json && !check.json.errorCode) return entity.cookie;
  const r1 = await request(
    'https://cloud.189.cn/api/portal/loginUrl.action?redirectURL=https%3A%2F%2Fcloud.189.cn%2Fweb%2Fredirect.html',
    { cookie: entity.cookie }
  );
  if (!r1.location) throw new Error('未能成功跳转');
  const r2 = await request(r1.location, { cookie: entity.eCookie });
  if (!r2.location) throw new Error('未能成功跳转');
  const r3 = await request(r2.location, { cookie: entity.eCookie });
  return r3.setCookie || entity.cookie;
}

function checkPrize(json) {
  if (json && json.errorCode && json.errorCode !== 'User_Not_Chance') {
    throw new Error(json.errorMsg || json.errorCode);
  }
}

async function draw(cookie, taskId) {
  const res = await request(
    `https://m.cloud.189.cn/v2/drawPrizeMarketDetails.action?taskId=${taskId}&activityId=ACT_SIGNIN`,
    {
      cookie,
      headers: {
        'user-agent': UA,
        referer: 'https://m.cloud.189.cn/zhuanti/2016/sign/index.jsp?albumBackupOpened=1',
      },
    }
  );
  const json = res.json || (res.text ? JSON.parse(res.text) : {});
  checkPrize(json);
  return json.prizeName || json.errorCode || 'ok';
}

function isCookieLike(text) {
  return /[=;]/.test(String(text || ''));
}

async function resolveEntity(account) {
  if (account.username && account.password) {
    return login(account.username, account.password);
  }
  if (account.cookie && account.eCookie && isCookieLike(account.cookie)) {
    return { cookie: account.cookie, eCookie: account.eCookie };
  }
  if (account.cookie && account.eCookie && !isCookieLike(account.cookie)) {
    return login(account.cookie, account.eCookie);
  }
  throw new Error('请填写 cookie#eCookie 或 用户名#密码');
}

async function sign(account) {
  const entity = await resolveEntity(account);
  entity.cookie = await updateCookie(entity);
  const a = await draw(entity.cookie, 'TASK_SIGNIN');
  await sleep(5000);
  const b = await draw(entity.cookie, 'TASK_SIGNIN_PHOTOS');
  await sleep(5000);
  const c = await draw(entity.cookie, 'TASK_2022_FLDFS_KJ');
  return `签到抽奖：${a} / ${b} / ${c}`;
}

(async () => {
  const accounts = parseAccounts(env('ECLOUD'), ['cookie', 'eCookie']);
  await runAccounts($?.name || '天翼云盘', accounts, sign);
})().catch((e) => {
  console.log(`❌ ${e.message || e}`);
  process.exit(1);
});
