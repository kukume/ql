/**
 * 酷狗概念版（听歌 + 看广告）
 * cron: 41 3 * * *
 * const $ = new Env("酷狗签到");
 *
 * export KUGOU="token#userid#kuGoo#mid"
 * 或 JSON：[{"token":"...","userid":"...","kuGoo":"...","mid":"..."}]
 */

const { Env, loadAccounts, request, sleep, md5, letter, runAccounts } = require('./utils');

const $ = new Env('酷狗签到');

function signature(salt, map, other = '') {
  const list = [];
  const sb = [];
  for (const [k, v] of Object.entries(map)) {
    list.push(`${k}=${v}`);
    sb.push(`${k}=${v}`);
  }
  list.sort();
  list.unshift(salt);
  list.push(other);
  list.push(salt);
  const sign = md5(list.join(''));
  return `${sb.join('&')}&signature=${sign}`;
}

function signature3(map, other = '') {
  return signature('LnT6xpN3khm36zse0QzvmgTZ3waWdRSA', map, other);
}

async function listenMusic(entity) {
  const map = {
    userid: String(entity.userid),
    token: entity.token,
    appid: '3116',
    clientver: '10547',
    clienttime: String(Math.floor(Date.now() / 1000)),
    mid: entity.mid,
    uuid: letter(32),
    dfid: '-',
  };
  const other = '{"mixsongid":273263741}';
  const res = await request(`https://gateway.kugou.com/v2/report/listen_song?${signature3(map, other)}`, {
    method: 'POST',
    headers: {
      'content-type': 'text/plain',
      'x-router': 'youth.kugou.com',
      'user-agent': 'Android12-1070-10536-130-0-ReportPlaySongToServerProtocol-wifi',
    },
    body: other,
  });
  const code = res.json?.error_code;
  if (code !== 0 && code !== 130012) throw new Error(res.json?.error_msg || '听歌上报失败');
}

async function watchAd(entity) {
  const map = {
    userid: String(entity.userid),
    token: entity.token,
    appid: '3116',
    clientver: '10780',
    clienttime: String(Math.floor(Date.now() / 1000)),
    mid: entity.mid,
    uuid: letter(32),
    dfid: '-',
  };
  const now = Date.now();
  const before = now - 15 * 1423;
  const other = JSON.stringify({ ad_id: '12424568007', play_start: before, play_end: now });
  const res = await request(`https://gateway.kugou.com/youth/v1/ad/play_report?${signature3(map, other)}`, {
    method: 'POST',
    headers: {
      'user-agent': 'Android12-1070-10780-130-0-AdPlayStatusProtocol-3gnet(20)',
    },
    json: other,
  });
  if (![0, 30002].includes(res.json?.error_code)) throw new Error(res.json?.error_msg || '看广告失败');
  return res.json?.data;
}

async function sign(account) {
  const entity = {
    token: account.token,
    userid: account.userid,
    kuGoo: account.kuGoo || account.kugoo,
    mid: account.mid,
  };
  if (!entity.token || !entity.userid || !entity.mid) {
    throw new Error('请填写 token#userid#kuGoo#mid');
  }
  await listenMusic(entity);
  let last = null;
  for (let i = 0; i < 8; i++) {
    await sleep(25000);
    last = await watchAd(entity);
  }
  const vip = last?.remain_vip_hour;
  return vip != null ? `听歌+看广告完成，剩余VIP ${vip} 小时` : '听歌+看广告完成';
}

(async () => {
  const accounts = await loadAccounts('KUGOU', ['token', 'userid', 'kuGoo', 'mid']);
  await runAccounts($?.name || '酷狗', accounts, sign);
})().catch((e) => {
  console.log(`❌ ${e.message || e}`);
  process.exit(1);
});
