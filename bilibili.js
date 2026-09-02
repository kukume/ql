/**
 * 哔哩哔哩签到（观看排行榜视频 + 分享）
 * cron: 23 3 * * *
 * const $ = new Env("哔哩哔哩签到");
 *
 * export BILIBILI_COOKIE="SESSDATA=xxx; bili_jct=xxx; DedeUserID=xxx;"
 * 多账号：青龙建多个同名变量，或换行 / @#@ 分隔
 */

const { Env, loadAccounts, request, sleep, cookieValue, runAccounts } = require('./utils');

const $ = new Env('哔哩哔哩签到');

function accountFromCookie(cookie) {
  return {
    cookie,
    userid: cookieValue(cookie, 'DedeUserID'),
    token: cookieValue(cookie, 'bili_jct'),
  };
}

async function ranking(cookie) {
  const res = await request('https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all', {
    cookie,
    headers: { referer: 'https://www.bilibili.com' },
  });
  const list = res.json?.data?.list;
  if (!Array.isArray(list) || !list.length) throw new Error(res.json?.message || '获取排行榜失败');
  return list.map((item) => ({
    aid: String(item.aid),
    cid: String(item.cid),
    title: item.title,
    duration: Number(item.duration) || 30,
    bv: item.bvid,
  }));
}

async function watchVideo(entity, video) {
  const startTs = String(Date.now());
  const map = {
    mid: entity.userid,
    aid: video.aid,
    cid: video.cid,
    part: '1',
    lv: '5',
    ftime: String(Date.now()),
    stime: startTs,
    jsonp: 'jsonp',
    type: '3',
    sub_type: '0',
    refer_url: '',
    spmid: '333.788.0.0',
    from_spmid: '333.1007.tianma.1-1-1.click',
    csrf: entity.token,
  };
  const click = await request('https://api.bilibili.com/x/click-interface/click/web/h5', {
    method: 'POST',
    cookie: entity.cookie,
    form: map,
  });
  if (click.json?.code !== 0) throw new Error(click.json?.message || '上报点击失败');
  await sleep(3000);
  const heartbeat = await request('https://api.bilibili.com/x/click-interface/web/heartbeat', {
    method: 'POST',
    cookie: entity.cookie,
    form: {
      ...map,
      start_ts: startTs,
      dt: '2',
      play_type: '0',
      realtime: String(Math.max(video.duration - 5, 1)),
      played_time: String(Math.max(video.duration - 1, 1)),
      real_played_time: String(Math.max(video.duration - 1, 1)),
      quality: '80',
      video_duration: String(video.duration),
      last_play_progress_time: String(Math.max(video.duration - 2, 1)),
      max_play_progress_time: String(Math.max(video.duration - 2, 1)),
    },
  });
  if (heartbeat.json?.code !== 0) throw new Error(heartbeat.json?.message || '上报观看失败');
}

async function share(entity, aid) {
  const res = await request('https://api.bilibili.com/x/web-interface/share/add', {
    method: 'POST',
    cookie: entity.cookie,
    form: { aid, csrf: entity.token, jsonp: 'jsonp' },
  });
  if (![0, 71000].includes(res.json?.code)) throw new Error(res.json?.message || '分享失败');
}

async function sign(account) {
  const cookie = account.cookie;
  if (!cookie) throw new Error('未填写 cookie');
  const entity = accountFromCookie(cookie);
  if (!entity.token) throw new Error('cookie 中未找到 bili_jct');
  const videos = await ranking(cookie);
  const first = videos[0];
  await sleep(5000);
  await watchVideo(entity, first);
  await sleep(5000);
  await share(entity, first.aid);
  return `观看并分享《${first.title}》`;
}

(async () => {
  const accounts = await loadAccounts('BILIBILI_COOKIE', ['cookie']);
  await runAccounts($?.name || '哔哩哔哩', accounts, sign);
})().catch((e) => {
  console.log(`❌ ${e.message || e}`);
  process.exit(1);
});
