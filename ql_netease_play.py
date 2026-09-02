# -*- coding: utf-8 -*-
"""
网易云听歌打卡（每日有效听歌约 300 首）
cron: 18 4 * * *
new Env('网易云听歌');

export NETEASE_COOKIE="MUSIC_U=xxx; __csrf=xxx;"
多账号用 & 或换行分隔，也支持 JSON：
[{"cookie":"...","remarks":"主号","count":300}]

可选：
export NETEASE_PLAY_COUNT="300"
export NETEASE_PLAYLIST="3778678,3779629"
export NETEASE_REAL_IP="116.25.146.155"
"""

from __future__ import annotations

import base64
import binascii
import json
import os
import random
import subprocess
import time
import math

try:
    import requests
except ImportError as e:
    raise SystemExit("需要 requests，请在青龙「依赖管理 → Python3」安装 requests") from e

NONCE = b"0CoJUm6Qyw8W8jud"
IV = b"0102030405060708"
MODULUS = (
    "00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7"
    "b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280"
    "104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932"
    "575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b"
    "3ece0462db0a22b8e7"
)
PUBKEY = "010001"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
CHART_PLAYLISTS = [3778678, 3779629, 19723756, 2884035]


def env(name, fallback=""):
    value = os.environ.get(name)
    return fallback if value is None or value == "" else value


def parse_accounts(raw, extra_keys=None):
    extra_keys = extra_keys or []
    if not raw:
        return []
    text = str(raw).strip()
    if not text:
        return []
    if text.startswith("[") or text.startswith("{"):
        try:
            parsed = json.loads(text)
            items = parsed if isinstance(parsed, list) else [parsed]
            return [normalize_account(item, extra_keys, i) for i, item in enumerate(items)]
        except json.JSONDecodeError:
            pass
    accounts = []
    for index, item in enumerate(filter(None, (s.strip() for s in text.replace("\r", "\n").replace("&", "\n").split("\n")))):
        if item.startswith("{"):
            try:
                accounts.append(normalize_account(json.loads(item), extra_keys, index))
                continue
            except json.JSONDecodeError:
                pass
        parts = item.split("#")
        if extra_keys and len(parts) > 1:
            obj = {"remarks": f"账号{index + 1}"}
            for i, key in enumerate(extra_keys):
                if i < len(parts) and parts[i] != "":
                    obj[key] = parts[i]
            if len(parts) > len(extra_keys):
                obj["remarks"] = parts[len(extra_keys)] or obj["remarks"]
            accounts.append(obj)
            continue
        obj = {"remarks": f"账号{index + 1}"}
        if extra_keys:
            obj[extra_keys[0]] = item
        else:
            obj["cookie"] = item
        accounts.append(obj)
    return accounts


def normalize_account(item, extra_keys, index):
    if isinstance(item, str):
        obj = {"remarks": f"账号{index + 1}"}
        if extra_keys:
            obj[extra_keys[0]] = item
        else:
            obj["cookie"] = item
        return obj
    data = dict(item)
    data.setdefault("remarks", data.get("remark") or data.get("name") or f"账号{index + 1}")
    return data


def cookie_value(cookie, name):
    for part in str(cookie or "").split(";"):
        part = part.strip()
        if not part or "=" not in part:
            continue
        key, value = part.split("=", 1)
        if key.strip() == name and value != "deleted":
            return value
    return ""


def aes_cbc_encrypt(plain, key):
    pad = 16 - (len(plain) % 16)
    data = plain + bytes([pad] * pad)
    try:
        from Cryptodome.Cipher import AES as _AES
    except ImportError:
        try:
            from Crypto.Cipher import AES as _AES
        except ImportError:
            _AES = None
    if _AES is not None:
        return _AES.new(key, _AES.MODE_CBC, IV).encrypt(data)
    proc = subprocess.run(
        ["openssl", "enc", "-aes-128-cbc", "-K", key.hex(), "-iv", IV.hex(), "-nosalt", "-nopad"],
        input=data,
        capture_output=True,
        check=True,
    )
    return proc.stdout


def weapi(payload):
    data = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    secret = binascii.hexlify(os.urandom(16))[:16]
    first = base64.b64encode(aes_cbc_encrypt(data, NONCE))
    params = base64.b64encode(aes_cbc_encrypt(first, secret)).decode("ascii")
    reversed_key = secret[::-1]
    enc = pow(int(reversed_key.hex(), 16), int(PUBKEY, 16), int(MODULUS, 16))
    return {"params": params, "encSecKey": format(enc, "x").zfill(256)}


def load_send():
    candidates = [
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "notify.py"),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "notify.py"),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "notify.py"),
        "/ql/scripts/notify.py",
        "/ql/data/scripts/notify.py",
    ]
    import importlib.util

    for path in candidates:
        if not os.path.isfile(path):
            continue
        spec = importlib.util.spec_from_file_location("ql_notify", path)
        if spec is None or spec.loader is None:
            continue
        module = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(module)
            if hasattr(module, "send"):
                return module.send
        except Exception:
            continue
    try:
        import notify

        if hasattr(notify, "send"):
            return notify.send
    except Exception:
        pass
    return None


def send_notify(title, content):
    body = f"{title}\n{content}"
    print(body)
    sender = load_send()
    if sender:
        sender(title, content)


class Netease:
    def __init__(self, cookie, real_ip=""):
        cookie = str(cookie).strip()
        if cookie and "MUSIC_U=" not in cookie and "__csrf=" not in cookie and ";" not in cookie:
            cookie = f"MUSIC_U={cookie}"
        if "os=" not in cookie:
            cookie = f"{cookie}; os=pc" if cookie else "os=pc"
        self.cookie = cookie
        self.csrf = cookie_value(cookie, "__csrf")
        self.session = requests.Session()
        self.session.headers.update(
            {
                "user-agent": UA,
                "referer": "https://music.163.com/",
                "origin": "https://music.163.com",
                "content-type": "application/x-www-form-urlencoded",
                "cookie": self.cookie,
            }
        )
        if real_ip:
            self.session.headers["x-real-ip"] = real_ip
            self.session.headers["x-forwarded-for"] = real_ip

    def request(self, path, payload=None):
        payload = dict(payload or {})
        payload.setdefault("csrf_token", self.csrf)
        url = f"https://music.163.com{path}"
        if self.csrf:
            url += f"?csrf_token={self.csrf}"
        res = self.session.post(url, data=weapi(payload), timeout=30)
        try:
            return res.json()
        except ValueError as e:
            raise RuntimeError(f"接口返回非 JSON：{res.text[:200]}") from e

    def account(self):
        return self.request("/weapi/nuser/account/get")

    def user_detail(self, uid):
        return self.request(f"/weapi/v1/user/detail/{uid}")

    def user_level(self):
        return self.request("/weapi/user/level")

    def personalized_playlist(self, limit=30):
        return self.request("/weapi/personalized/playlist", {"limit": limit})

    def playlist_detail(self, playlist_id, n=1000):
        return self.request(
            "/weapi/v6/playlist/detail",
            {"id": playlist_id, "n": n, "s": 8, "shareUserId": "0"},
        )

    def daka(self, song_datas):
        logs = [{"action": "play", "json": item} for item in song_datas]
        return self.request("/weapi/feedback/weblog", {"logs": json.dumps(logs, separators=(",", ":"))})


def collect_songs(client, playlist_ids, need):
    song_datas = []
    seen = set()
    for playlist_id in playlist_ids:
        result = client.playlist_detail(playlist_id)
        tracks = (result.get("playlist") or {}).get("tracks") or []
        for song in tracks:
            sid = song.get("id")
            if not sid or sid in seen:
                continue
            seen.add(sid)
            duration = song.get("dt") or 180000
            song_datas.append(
                {
                    "type": "song",
                    "wifi": 0,
                    "download": 0,
                    "id": sid,
                    "time": max(int(math.ceil(duration / 1000)), 30),
                    "end": "playend",
                    "source": "list",
                    "sourceId": playlist_id,
                }
            )
            if len(song_datas) >= need:
                return song_datas
    return song_datas


def resolve_playlists(client, extra_ids):
    ids = [int(x) for x in extra_ids if str(x).strip().isdigit()]
    try:
        rec = client.personalized_playlist(30)
        for item in rec.get("result") or []:
            pid = item.get("id")
            if pid and pid not in ids:
                ids.append(pid)
    except Exception as e:
        print(f"获取个性推荐歌单失败，改用榜单：{e}")
    for pid in CHART_PLAYLISTS:
        if pid not in ids:
            ids.append(pid)
    random.shuffle(ids)
    return ids


def play_account(account):
    cookie = account.get("cookie") or account.get("MUSIC_U") or ""
    if not cookie:
        raise RuntimeError("未填写 cookie")
    count = int(account.get("count") or env("NETEASE_PLAY_COUNT", "300"))
    extra = account.get("playlist") or env("NETEASE_PLAYLIST", "")
    extra_ids = []
    if isinstance(extra, list):
        extra_ids = extra
    elif extra:
        extra_ids = [x.strip() for x in str(extra).replace(";", ",").split(",") if x.strip()]
    real_ip = account.get("realIp") or env("NETEASE_REAL_IP", "116.25.146.155")
    client = Netease(cookie, real_ip)
    acc = client.account()
    profile = acc.get("profile") or {}
    uid = profile.get("userId") or (acc.get("account") or {}).get("id")
    if not uid:
        raise RuntimeError(acc.get("message") or "cookie 已失效，请重新抓取 MUSIC_U / __csrf")
    nickname = profile.get("nickname") or str(uid)
    before = client.user_detail(uid)
    listen_before = before.get("listenSongs")
    playlists = resolve_playlists(client, extra_ids)
    songs = collect_songs(client, playlists, count)
    if not songs:
        raise RuntimeError("没有拿到可播放的歌曲")
    uploaded = 0
    batch = 50
    last = None
    for i in range(0, len(songs), batch):
        chunk = songs[i : i + batch]
        last = client.daka(chunk)
        if last.get("code") != 200:
            raise RuntimeError(last.get("message") or f"听歌上报失败 code={last.get('code')}")
        uploaded += len(chunk)
        if i + batch < len(songs):
            time.sleep(2)
    time.sleep(3)
    after = client.user_detail(uid)
    listen_after = after.get("listenSongs")
    level = (client.user_level().get("data") or {}).get("level")
    parts = [nickname, f"上报 {uploaded} 首"]
    if listen_before is not None and listen_after is not None:
        parts.append(f"听歌 {listen_before} → {listen_after}")
    elif listen_after is not None:
        parts.append(f"累计听歌 {listen_after}")
    if level is not None:
        parts.append(f"Lv.{level}")
    return "，".join(parts)


def run_accounts(name, accounts, handler):
    if not accounts:
        print(f"未配置{name}账号，跳过")
        return
    logs = []
    failed = 0
    for i, account in enumerate(accounts):
        label = account.get("remarks") or f"账号{i + 1}"
        try:
            remark = handler(account)
            line = f"✅ {label}：{remark or '成功'}"
            print(line)
            logs.append(line)
        except Exception as e:
            failed += 1
            line = f"❌ {label}：{e}"
            print(line)
            logs.append(line)
        if i < len(accounts) - 1:
            time.sleep(3)
    if failed > 0 or env("QL_NOTIFY_ALL", "false") == "true":
        send_notify(name, "\n".join(logs))


if __name__ == "__main__":
    run_accounts("网易云听歌", parse_accounts(env("NETEASE_COOKIE"), ["cookie"]), play_account)
