# ql

从 [kukume/bot](https://github.com/kukume/bot) Telegram 模块的自动签到任务改写的青龙脚本，可用青龙订阅拉取并自动添加定时任务。

逻辑对齐原仓库 `telegram` 模块中的 Job（`BaiduJob`、`BiliBiliSignJob`、`DouYuSignJob` 等），定时也沿用原 Quartz 时间。

## 青龙订阅

面板 → **订阅管理** → **新建订阅**：

| 项 | 值 |
| --- | --- |
| 名称 | kuku 签到 |
| 类型 | 公开仓库 |
| 链接 | `https://github.com/kukume/ql.git` |
| 定时 | `0 8 * * *`（每天拉一次更新即可） |
| 白名单 | `baidu\|bilibili\|douyu\|ecloud\|kugou\|mihoyo\|nodeseek\|nodeloc\|smzdm\|weibo\|step\|netease` |
| 黑名单 | `README\|utils` |
| 依赖文件 | `utils` |
| 文件后缀 | `js py` |
| 分支 | `main` |
| 自动添加任务 | 是 |

命令行等价：

```bash
ql repo https://github.com/kukume/ql.git "baidu|bilibili|douyu|ecloud|kugou|mihoyo|nodeseek|nodeloc|smzdm|weibo|step|netease" "README|utils" "utils" "main" "js py"
```

订阅后会自动创建以下任务（cron 写在各脚本头部）：

| 脚本 | 任务 | cron |
| --- | --- | --- |
| `baidu.js` | 百度贴吧 + 游帮帮 | `41 2 * * *` |
| `bilibili.js` | 哔哩哔哩观看/分享 | `23 3 * * *` |
| `douyu.js` | 斗鱼鱼吧 | `3 6 * * *` |
| `ecloud.js` | 天翼云盘 | `14 2 * * *` |
| `kugou.js` | 酷狗听歌/看广告 | `41 3 * * *` |
| `mihoyo.js` | 原神 + 米游社 | `13 8 * * *` |
| `nodeseek.js` | NodeSeek | `25 2 * * *` |
| `nodeloc.js` | NodeLoc | `13 5 * * *` |
| `smzdm.js` | 什么值得买 | `32 6 * * *` |
| `weibo.js` | 微博超话 | `51 4 * * *` |
| `step.js` | 小米运动 / 乐心运动刷步 | `12 5 * * *` |
| `ql_netease_play.py` | 网易云网页播放上报 | `*/5 * * * *` |
| `ql_netease_musician.py` | 网易云音乐人黑胶VIP续期 | `32 8 * * *` |

推送、开播提醒等 Telegram 实时任务没有迁过来，青龙只覆盖自动签到/刷步/听歌。JS 和 Python 可以放在同一个订阅里，文件后缀填 `js py`。

## 环境变量

多账号请在青龙里建多个同名环境变量，或在一个变量里用换行 / `@#@` 分隔。不要用 `&` 拼接，Cookie 里经常自带 `&`，会被切坏。多个字段仍用 `#` 拼接，也支持 JSON 数组。

失败会走青龙 `sendNotify` 推送；全部成功默认不推。需要每次都推送时设置 `QL_NOTIFY_ALL=true`。

需要极验的任务（什么值得买 Web 签到、米哈游风控）可配置打码：

```
export DAMAGOU_KEY=""
# 或
export TWOCAPTCHA_KEY=""
```

### 百度

```
export BAIDU_COOKIE="BDUSS=xxx; STOKEN=xxx;"
```

### 哔哩哔哩

```
export BILIBILI_COOKIE="SESSDATA=xxx; bili_jct=xxx; DedeUserID=xxx;"
```

### 斗鱼鱼吧

```
export DOUYU_COOKIE="acf_auth=xxx; ..."
```

### 天翼云盘

```
# cookie + eCookie
export ECLOUD="COOKIE_LOGIN_USER=xxx;#SSON=xxx;"
# 或账号密码
export ECLOUD="用户名#密码"
```

### 酷狗

```
export KUGOU="token#userid#kuGoo#mid"
```

### 米哈游

```
# 原神（web cookie）
export MIHOYO_COOKIE="cookie_token=xxx; account_id=xxx; ..."
# 米游社（stuid / stoken / mid）
export MIHOYO_TOKEN="aid#token#mid"
# 或一次配齐
export MIHOYO='[{"cookie":"...","aid":"...","token":"...","mid":"...","remarks":"主号"}]'
export MIHOYO_SKIP_GENSHIN="false"
export MIHOYO_SKIP_MYS="false"
```

### NodeSeek

```
export NODESEEK_COOKIE="cookie"
export NODESEEK_RANDOM="true"
```

Cookie 需带上能通过 Cloudflare 的浏览器完整 cookie。

### NodeLoc

```
export NODELOC="cookie#csrf"
```

### 什么值得买

```
export SMZDM_COOKIE="cookie"
```

未配置打码时只跑 App 签到。

### 微博超话

```
export WEIBO_COOKIE="SUB=xxx; ..."
```

### 网易云网页播放上报

浏览器登录 [music.163.com](https://music.163.com/) 后，Cookie 整串里必须带 `MUSIC_U` 和 `__csrf`。网易 Cookie 本身含 `&`，多账号不要用 `&` 拼接。

```
export NETEASE_COOKIE="MUSIC_U=xxx; __csrf=xxx; ..."
export NETEASE_SONG_ID="1864698228"
export NETEASE_PLAY_COUNT="1"
export NETEASE_WAIT="true"
export NETEASE_PULL_AUDIO="true"
export NETEASE_LEVEL="exhigh"
```

多账号：青龙里建多个同名 `NETEASE_COOKIE`，或一个变量里换行（每账号一行），也可用 `@#@` 分隔。`wait=true` 时每遍会等一首歌的时长，次数多时把任务超时调大。

### 网易云音乐人任务

和播放上报共用 `NETEASE_COOKIE`。只查黑胶续期页 `vip/info`。650 次播放直接忽略。

- **发布1条近期动态**：对齐 Kotlin `shareMySong`，Node 拿 `checkToken` 后分享自己的歌到动态，发完即删。青龙需要 `node`
- **图文笔记**：发 mlog，发完即删

不认识的只记日志。

Python 依赖：`requests`、`pycryptodome`（或 `pycryptodomex`）。

### 刷步数

```
export XIAOMI_STEP="loginToken#20000#1"
export LEXIN_STEP="cookie#userid#accessToken#20000#1"
```

末尾 `#1` 表示开启 ±1000 步偏移。

## 运行环境

- 青龙 2.15+（Node 18+，自带 `fetch`；Python 脚本需要 `requests` 和 `pycryptodome`）
- 解析贴吧页面时如已安装 `cheerio` 会优先使用（青龙默认带）
