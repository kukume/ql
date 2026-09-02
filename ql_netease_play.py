# -*- coding: utf-8 -*-
"""
new Env('网易云网页播放上报');
cron: */5 * * * *
"""

from __future__ import annotations

import base64
import binascii
import json
import os
import random
import re
import string
import time
from typing import Any, Dict, List, Optional

import requests

try:
    from Crypto.Cipher import AES
    from Crypto.Util.Padding import pad
except ImportError:  # 青龙有时装的是 pycryptodomex
    from Cryptodome.Cipher import AES
    from Cryptodome.Util.Padding import pad

try:
    from notify import send as ql_send
except Exception:
    ql_send = None

# ---------- weapi（与网页 core.js asrsea 一致） ----------
PRESET_KEY = "0CoJUm6Qyw8W8jud"
AES_IV = b"0102030405060708"
RSA_EXPONENT = "010001"
RSA_MODULUS = (
    "00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725"
    "152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312"
    "ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424"
    "d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7"
)
CHARSET = string.ascii_letters + string.digits

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/151.0.0.0 Safari/537.36"
)
ORIGIN = "https://music.163.com"
PLAYER_URL = ORIGIN + "/weapi/song/enhance/player/url/v1"
WEBLOG_URL = "https://clientlogusf.music.163.com/weapi/feedback/weblog"
MIN_REPORT_SECONDS = 3


def log(msg: str) -> None:
    print(msg, flush=True)


def env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def env_bool(name: str, default: bool = False) -> bool:
    raw = env(name)
    if not raw:
        return default
    return raw.lower() not in ("0", "false", "no", "off")


def env_int(name: str, default: int) -> int:
    raw = env(name)
    if not raw:
        return default
    return int(raw)


def split_ids(raw: str) -> List[str]:
    """歌曲 id：换行、逗号、& 都可以。"""
    if not raw:
        return []
    text = raw.replace("\r", "\n").replace(",", "\n").replace("&", "\n")
    return [x.strip() for x in text.split("\n") if x.strip()]


def split_cookies(raw: str) -> List[str]:
    """拆 os.environ 里的 Cookie 字符串。

    青龙同名变量会用 & 拼成一条，但网易 Cookie 的 P_INFO/S_INFO 里
    本身就有 &，所以不能按 & 硬切。

    优先：换行、@#@。
    否则整段当作 1 个账号（单 Cookie 最常见）。
    """
    if not raw:
        return []
    text = raw.replace("\r\n", "\n").replace("\r", "\n").strip()
    if "@#@" in text:
        return [x.strip() for x in text.split("@#@") if x.strip()]
    if "\n" in text:
        return [x.strip() for x in text.split("\n") if x.strip()]
    return [text]


def _ql_auth_token() -> str:
    for path in ("/ql/data/config/auth.json", "/ql/config/auth.json"):
        if os.path.isfile(path):
            data = json.loads(open(path, encoding="utf-8").read())
            return data.get("token") or data.get("tokens", {}).get("desktop", "") or ""
    return ""


def cookies_from_ql_api(name: str) -> List[str]:
    """青龙同名变量真正是多条记录，API 能按条返回，不会被 & 拼坏。"""
    token = _ql_auth_token()
    if not token:
        return []
    headers = {"Authorization": "Bearer " + token}
    last_err = None
    for base in ("http://127.0.0.1:5700", "http://127.0.0.1:5701"):
        try:
            resp = requests.get(
                base + "/api/envs",
                params={"searchValue": name},
                headers=headers,
                timeout=5,
            )
            data = resp.json()
            rows = data.get("data") or []
            values = []
            for row in rows:
                if row.get("name") != name:
                    continue
                if int(row.get("status", 0)) != 0:
                    continue
                value = (row.get("value") or "").strip()
                if value:
                    values.append(value)
            if values:
                return values
        except Exception as exc:
            last_err = exc
    if last_err:
        log("青龙 API 读取环境变量失败: %s" % last_err)
    return []


def cookies_from_ql_db(name: str) -> List[str]:
    for db in ("/ql/data/db/database.sqlite", "/ql/db/database.sqlite"):
        if not os.path.isfile(db):
            continue
        try:
            import sqlite3

            conn = sqlite3.connect(db)
            cur = conn.cursor()
            # sequelize 表名一般是 Envs；status=0 启用
            cur.execute(
                "SELECT value FROM Envs WHERE name=? AND status=0",
                (name,),
            )
            rows = [r[0].strip() for r in cur.fetchall() if r and r[0] and str(r[0]).strip()]
            conn.close()
            if rows:
                return rows
        except Exception as exc:
            log("青龙数据库读取失败: %s" % exc)
    return []


def load_cookies() -> List[str]:
    """多账号 Cookie。

    青龙 set_envs() 会把同名变量 join('&') 写进 os.environ，
    见 https://github.com/whyour/qinglong/blob/master/back/services/env.ts
    所以 os.environ['NETEASE_COOKIE'] 不是数组。

    读取顺序：青龙 API 按条 → sqlite 按条 → os.environ 整段。
    """
    for loader, label in (
        (cookies_from_ql_api, "青龙 API"),
        (cookies_from_ql_db, "青龙数据库"),
    ):
        values = loader("NETEASE_COOKIE")
        if values:
            log("Cookie 来源: %s，共 %s 条" % (label, len(values)))
            return values

    raw = env("NETEASE_COOKIE")
    values = split_cookies(raw)
    log("Cookie 来源: os.environ，共 %s 条（青龙同名变量已被 & 拼成一串，单 Cookie 请保持 1 条）" % len(values))
    return values


def _random_secret(n: int = 16) -> str:
    return "".join(random.choice(CHARSET) for _ in range(n))


def _aes_encrypt(text: str, key: str) -> str:
    cipher = AES.new(key.encode("utf-8"), AES.MODE_CBC, AES_IV)
    encrypted = cipher.encrypt(pad(text.encode("utf-8"), AES.block_size))
    return base64.b64encode(encrypted).decode("utf-8")


def _rsa_encrypt(text: str) -> str:
    message = int(binascii.hexlify(text[::-1].encode("utf-8")), 16)
    encrypted = pow(message, int(RSA_EXPONENT, 16), int(RSA_MODULUS, 16))
    return format(encrypted, "x").zfill(256)


def weapi_encrypt(payload: Dict[str, Any]) -> Dict[str, str]:
    text = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    secret = _random_secret(16)
    params = _aes_encrypt(_aes_encrypt(text, PRESET_KEY), secret)
    return {"params": params, "encSecKey": _rsa_encrypt(secret)}


def csrf_from_cookie(cookie: str) -> str:
    for part in cookie.split(";"):
        part = part.strip()
        if part.startswith("__csrf="):
            return part.split("=", 1)[1]
    return ""


def session_from_cookie(cookie: str) -> requests.Session:
    s = requests.Session()
    s.headers.update(
        {
            "User-Agent": UA,
            "Accept": "*/*",
            "Accept-Language": "zh-CN,zh;q=0.9",
            "Origin": ORIGIN,
            "Referer": ORIGIN + "/",
            "Content-Type": "application/x-www-form-urlencoded",
            "Cookie": cookie,
        }
    )
    s.cookies.set("playerid", str(random.randint(10_000_000, 99_999_999)), domain="music.163.com")
    return s


def weapi_post(sess: requests.Session, url: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    csrf = csrf_from_cookie(sess.headers.get("Cookie", ""))
    body = dict(payload)
    body.setdefault("csrf_token", csrf)
    encrypted = weapi_encrypt(body)
    target = url + ("&" if "?" in url else "?") + "csrf_token=" + csrf
    resp = sess.post(target, data=encrypted, timeout=20)
    resp.raise_for_status()
    return resp.json()


def get_player_url(sess: requests.Session, song_id: int, level: str) -> Dict[str, Any]:
    data = weapi_post(
        sess,
        PLAYER_URL,
        {"ids": json.dumps([song_id]), "level": level, "encodeType": "aac"},
    )
    if data.get("code") != 200 or not data.get("data"):
        raise RuntimeError("player/url 失败: %s" % data)
    info = data["data"][0]
    if not info.get("url"):
        raise RuntimeError("没有播放地址（会员/版权？）: %s" % info)
    return info


def https_url(url: str) -> str:
    if url.startswith("http://"):
        return "https://" + url[len("http://") :]
    return url


def pull_audio(sess: requests.Session, url: str, size_hint: Optional[int] = None) -> int:
    headers = {
        "Referer": ORIGIN + "/",
        "Range": "bytes=0-",
        "Accept-Encoding": "identity;q=1, *;q=0",
        "Sec-Fetch-Dest": "audio",
        "Sec-Fetch-Mode": "no-cors",
        "Sec-Fetch-Site": "cross-site",
    }
    with sess.get(https_url(url), headers=headers, stream=True, timeout=30) as resp:
        n = 0
        for chunk in resp.iter_content(64 * 1024):
            if not chunk:
                break
            n += len(chunk)
            if size_hint and n >= size_hint:
                break
        log("  音频 GET %s bytes=%s range=%s" % (resp.status_code, n, resp.headers.get("Content-Range")))
        return n


def weblog(sess: requests.Session, action: str, js: Dict[str, Any]) -> Dict[str, Any]:
    js = dict(js)
    js["mainsite"] = "1"
    js["mainsiteWeb"] = "1"
    payload = {"logs": json.dumps([{"action": action, "json": js}], ensure_ascii=False)}
    return weapi_post(sess, WEBLOG_URL, payload)


def play_once(
    sess: requests.Session,
    song_id: int,
    level: str,
    end: str,
    wait: bool,
    pull: bool,
) -> Dict[str, Any]:
    info = get_player_url(sess, song_id, level)
    duration_s = int(info.get("time") or 0) / 1000.0
    log(
        "  player/url id=%s br=%s size=%s type=%s level=%s duration=%.3fs"
        % (info.get("id"), info.get("br"), info.get("size"), info.get("type"), info.get("level"), duration_s)
    )
    if pull:
        pull_audio(sess, info["url"], size_hint=info.get("size"))

    start = weblog(sess, "startplay", {"id": song_id, "type": "song", "content": "id=%s" % song_id})
    log("  startplay %s" % start)

    if wait:
        log("  等待 %.1fs（模拟听完）..." % duration_s)
        time.sleep(max(duration_s, 0))

    if duration_s <= MIN_REPORT_SECONDS:
        log("  跳过 play：网页 JS 要求 > %ss" % MIN_REPORT_SECONDS)
        return {"startplay": start, "play": {"skipped": True}}

    play = weblog(
        sess,
        "play",
        {
            "type": "song",
            "wifi": 0,
            "download": 0,
            "id": song_id,
            "time": int(round(duration_s)),
            "end": end,
            "source": "song",
            "sourceId": str(song_id),
            "content": "id=%s" % song_id,
        },
    )
    log("  play %s" % play)
    return {"startplay": start, "play": play, "time": int(round(duration_s))}


def ok_resp(data: Dict[str, Any]) -> bool:
    if not data:
        return False
    if data.get("skipped"):
        return False
    return data.get("code") == 200 or data.get("data") == "success"


def notify(title: str, content: str) -> None:
    if env_bool("NETEASE_NOTIFY", True) and ql_send:
        try:
            ql_send(title, content)
        except Exception as exc:
            log("通知失败: %s" % exc)


def main() -> None:
    cookies = load_cookies()
    if not cookies:
        raise SystemExit(
            "未配置 NETEASE_COOKIE。\n"
            "青龙「环境变量」里新增 NETEASE_COOKIE，值是浏览器 Cookie 整串，必须含 MUSIC_U 和 __csrf。\n"
            "多账号：建多个同名 NETEASE_COOKIE，或一个变量里换行（每账号一行）。"
        )

    song_ids = [int(x) for x in split_ids(env("NETEASE_SONG_ID", "1864698228"))]
    play_count = max(1, env_int("NETEASE_PLAY_COUNT", 1))
    wait = env_bool("NETEASE_WAIT", True)
    pull = env_bool("NETEASE_PULL_AUDIO", True)
    level = env("NETEASE_LEVEL", "exhigh") or "exhigh"
    end = env("NETEASE_END", "playend") or "playend"
    interval = max(0, env_int("NETEASE_INTERVAL", 0))

    log("账号数=%s 歌曲=%s 每账号次数=%s wait=%s 拉音频=%s end=%s" % (
        len(cookies), song_ids, play_count, wait, pull, end
    ))
    if wait:
        log("注意：wait=true 时每遍大约等一首歌的时长，次数多时请把青龙任务超时调大。")

    summary: List[str] = []
    fail = 0
    success = 0

    for ai, cookie in enumerate(cookies, 1):
        if "MUSIC_U=" not in cookie:
            log("[账号%s] Cookie 缺少 MUSIC_U，跳过" % ai)
            fail += 1
            continue
        sess = session_from_cookie(cookie)
        for song_id in song_ids:
            for i in range(1, play_count + 1):
                log("=== 账号%s 歌曲%s 第%s/%s 遍 ===" % (ai, song_id, i, play_count))
                try:
                    result = play_once(sess, song_id, level, end, wait, pull)
                    if ok_resp(result.get("play") or {}):
                        success += 1
                        summary.append("账号%s 歌曲%s 第%s遍: play OK time=%s" % (
                            ai, song_id, i, result.get("time")
                        ))
                    else:
                        fail += 1
                        summary.append("账号%s 歌曲%s 第%s遍: play 异常 %s" % (
                            ai, song_id, i, result.get("play")
                        ))
                except Exception as exc:
                    fail += 1
                    summary.append("账号%s 歌曲%s 第%s遍: 失败 %s" % (ai, song_id, i, exc))
                    log("  失败: %s" % exc)
                if interval and not (ai == len(cookies) and song_id == song_ids[-1] and i == play_count):
                    time.sleep(interval)

    title = "网易云播放上报 成功%s 失败%s" % (success, fail)
    body = "\n".join(summary) or "无结果"
    log(title)
    log(body)
    notify(title, body)
    if fail:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
