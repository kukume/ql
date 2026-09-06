# -*- coding: utf-8 -*-
"""
new Env('网易云音乐人黑胶VIP续期');
cron: 32 8 * * *
"""

from __future__ import annotations

import hashlib
import json
import random
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ql_netease_play import (
    load_cookies,
    log,
    notify,
    session_from_cookie,
    weapi_post,
)

ORIGIN = "https://music.163.com"
INTERFACE = "https://interface.music.163.com"
NOS_UPLOAD = "http://45.127.129.8"

VIP_INFO_URL = INTERFACE + "/weapi/nmusician/workbench/special/right/vip/info"
VIP_GET_URL = INTERFACE + "/weapi/nmusician/workbench/special/right/vip/get"
MY_SONGS_URL = ORIGIN + "/weapi/nmusician/production/common/artist/song/item/list/get"
EVENT_PUBLISH_URL = ORIGIN + "/weapi/share/friends/resource"
EVENT_DELETE_URL = ORIGIN + "/weapi/event/delete"
SONG_DETAIL_URL = ORIGIN + "/weapi/v3/song/detail"
NOS_TOKEN_URL = ORIGIN + "/weapi/nos/token/whalealloc"
MLOG_PUBLISH_URL = ORIGIN + "/weapi/mlog/publish/v1"

DONE_STATUS = 100


def ok(data: Dict[str, Any], extra: Tuple[int, ...] = ()) -> bool:
    return bool(data) and (data.get("code") == 200 or data.get("code") in extra)


def api(
    sess: requests.Session,
    url: str,
    payload: Optional[Dict[str, Any]] = None,
    os_name: Optional[str] = None,
) -> Dict[str, Any]:
    old = sess.headers.get("Cookie", "")
    if os_name:
        cookie = re.sub(r"(?:^|;\s*)os=[^;]*", "", old).strip("; ")
        sess.headers["Cookie"] = "os=%s; %s" % (os_name, cookie)
    try:
        return weapi_post(sess, url, payload or {})
    finally:
        sess.headers["Cookie"] = old


def vip_info(sess: requests.Session) -> Dict[str, Any]:
    data = api(sess, VIP_INFO_URL)
    if not ok(data):
        raise RuntimeError("vip/info 失败: %s" % data)
    return data.get("data") or {}


def vip_get(sess: requests.Session) -> Dict[str, Any]:
    return api(sess, VIP_GET_URL)


def my_songs(sess: requests.Session) -> List[Dict[str, Any]]:
    data = api(
        sess,
        MY_SONGS_URL,
        {"fromBackend": "0", "limit": "10", "offset": "0", "online": "1"},
    )
    if not ok(data):
        raise RuntimeError("获取自己的歌曲失败: %s" % data)
    return list((data.get("data") or {}).get("list") or [])


def pick_song(sess: requests.Session) -> Dict[str, Any]:
    songs = my_songs(sess)
    if not songs:
        raise RuntimeError("没有已上架的自己的歌曲")
    return random.choice(songs)


def song_detail(sess: requests.Session, song_id: int) -> Dict[str, Any]:
    data = api(
        sess,
        SONG_DETAIL_URL,
        {"c": json.dumps([{"id": song_id}]), "ids": json.dumps([song_id])},
    )
    if not ok(data) or not data.get("songs"):
        raise RuntimeError("song/detail 失败: %s" % data)
    song = data["songs"][0]
    artists = song.get("ar") or [{}]
    album = song.get("al") or {}
    return {
        "name": song.get("name") or "",
        "artist": (artists[0] or {}).get("name") or "",
        "pic": (album.get("picUrl") or "") + "?param=500y500",
    }


def yidun_check_token() -> str:
    script = Path(__file__).resolve().parent / "utils" / "netease_check_token.mjs"
    if not script.is_file():
        raise RuntimeError("缺少 %s" % script)
    proc = subprocess.run(
        ["node", str(script)],
        capture_output=True,
        text=True,
        timeout=30,
    )
    lines = [ln.strip() for ln in (proc.stdout or "").splitlines() if ln.strip()]
    token = lines[-1] if lines else ""
    if not token:
        raise RuntimeError(
            "checkToken 为空 (exit %s): %s" % (proc.returncode, (proc.stderr or "").strip())
        )
    log("  checkToken len=%s" % len(token))
    return token


def share_my_song(
    sess: requests.Session,
    song_id: int,
    msg: str = "每日分享",
    check_token: str = "",
) -> int:
    """对齐 Kotlin shareMySong：分享自己的歌到动态。"""
    token = check_token or yidun_check_token()
    data = api(
        sess,
        EVENT_PUBLISH_URL,
        {
            "type": "song",
            "id": str(song_id),
            "msg": msg,
            "uuid": "publish-%s%s" % (int(time.time() * 1000), random.randint(10000, 99999)),
            "checkToken": token,
        },
    )
    event_id = data.get("id")
    if not ok(data) or not event_id:
        raise RuntimeError("分享歌曲到动态失败: %s" % data)
    return int(event_id)


def delete_event(sess: requests.Session, event_id: int) -> None:
    data = api(sess, EVENT_DELETE_URL, {"id": str(event_id)}, os_name="pc")
    if not ok(data):
        raise RuntimeError("删除动态失败: %s" % data)


def publish_and_delete_event(sess: requests.Session, check_token: str = "") -> str:
    song = pick_song(sess)
    song_id = int(song["songId"])
    event_id = share_my_song(sess, song_id, check_token=check_token)
    delete_event(sess, event_id)
    return "已分享并删除动态 《%s》 event=%s" % (song.get("songName") or song_id, event_id)


def nos_token(sess: requests.Session, image_url: str) -> Dict[str, Any]:
    raw = sess.get(image_url, timeout=20).content
    biz_key = "".join("%x" % random.randint(0, 15) for _ in range(9))
    data = api(
        sess,
        NOS_TOKEN_URL,
        {
            "bizKey": biz_key,
            "filename": "album.jpg",
            "bucket": "yyimgs",
            "md5": hashlib.md5(raw).hexdigest(),
            "type": "image",
            "fileSize": str(len(raw)),
        },
    )
    if not ok(data):
        raise RuntimeError("nos token 失败: %s" % data)
    info = data.get("data") or {}
    info["bytes"] = raw
    return info


def upload_nos(sess: requests.Session, info: Dict[str, Any]) -> None:
    url = "%s/%s/%s?offset=0&complete=true&version=1.0" % (
        NOS_UPLOAD,
        info.get("bucket"),
        info.get("objectKey"),
    )
    resp = sess.post(
        url,
        data=info["bytes"],
        headers={
            "x-nos-token": info.get("token") or "",
            "Content-Type": "image/jpg",
            "Referer": ORIGIN,
        },
        timeout=30,
    )
    resp.raise_for_status()


def publish_mlog(sess: requests.Session) -> str:
    song = pick_song(sess)
    song_id = int(song["songId"])
    detail = song_detail(sess, song_id)
    info = nos_token(sess, detail["pic"])
    upload_nos(sess, info)
    text = "分享%s的歌曲: %s" % (detail["artist"], detail["name"])
    mlog = {
        "content": {
            "image": [
                {
                    "height": 500,
                    "width": 500,
                    "more": False,
                    "nosKey": "%s/%s" % (info.get("bucket"), info.get("objectKey")),
                    "picKey": info.get("resourceId"),
                }
            ],
            "needAudio": False,
            "song": {
                "endTime": 0,
                "name": detail["name"],
                "songId": song_id,
                "startTime": 30000,
            },
            "text": text,
        },
        "from": 0,
        "type": 1,
    }
    data = api(sess, MLOG_PUBLISH_URL, {"type": 1, "mlog": json.dumps(mlog, ensure_ascii=False)})
    if not ok(data):
        raise RuntimeError("发布 mlog 失败: %s" % data)
    event = (((data.get("data") or {}).get("event") or {}).get("info") or {})
    resource_id = event.get("resourceId")
    if not resource_id:
        raise RuntimeError("发布 mlog 没有 resourceId: %s" % data)
    delete_event(sess, int(resource_id))
    return "已发布并删除 mlog resource=%s" % resource_id


def flatten_tasks(info: Dict[str, Any]) -> List[Dict[str, Any]]:
    tasks: List[Dict[str, Any]] = []

    def add(raw: Any, source: str) -> None:
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except Exception:
                return
        if isinstance(raw, dict):
            children = raw.get("children") or []
        elif isinstance(raw, list):
            children = raw
        else:
            return
        for i, item in enumerate(children):
            if not isinstance(item, dict):
                continue
            row = dict(item)
            row["_source"] = source
            row["_index"] = i
            tasks.append(row)
            nested = item.get("children") or item.get("schemaContent")
            if nested:
                add(nested, source + ".child")

    add(info.get("furtherTask"), "further")
    add(info.get("taskJson"), "newbie")
    return tasks


def task_done(task: Dict[str, Any]) -> bool:
    return task.get("missionStatus") == DONE_STATUS


def task_blob(task: Dict[str, Any]) -> str:
    return " ".join(
        str(task.get(k) or "")
        for k in ("name", "desc", "missionCode", "button")
    )


def classify_action(task: Dict[str, Any]) -> str:
    blob = task_blob(task)
    if any(k in blob for k in ("播放", "recently_play_count", "play_count")):
        return "ignore"
    if any(k in blob for k in ("图文笔记", "notebook_publish", "mlog")):
        return "mlog"
    if any(k in blob for k in ("发布动态", "近期动态", "musician_comment_action")):
        return "event"
    return "unknown"


def format_task(task: Dict[str, Any]) -> str:
    name = task.get("name") or "(无名)"
    done = "已完成" if task_done(task) else "未完成"
    return "[%s#%s] %s %s status=%s rate=%s/%s action=%s code=%s" % (
        task.get("_source"),
        task.get("_index"),
        done,
        name,
        task.get("missionStatus"),
        task.get("progressRate"),
        task.get("totalCompleteNum"),
        classify_action(task),
        task.get("missionCode") or "-",
    )


def claim_vip(sess: requests.Session) -> str:
    got = vip_get(sess)
    if ok(got, extra=(1801, 1803)):
        return "领取黑胶VIP: %s" % (got.get("message") or got.get("code"))
    raise RuntimeError("领取黑胶VIP失败: %s" % got)


def step(lines: List[str], ai: int, name: str, fn: Any) -> bool:
    try:
        msg = fn()
        line = "[账号%s] %s: %s" % (ai, name, msg or "OK")
        log(line)
        lines.append(line)
        return True
    except Exception as exc:
        line = "[账号%s] %s失败: %s" % (ai, name, exc)
        log(line)
        lines.append(line)
        return False


def run_account(ai: int, cookie: str) -> Tuple[List[str], bool]:
    lines: List[str] = []
    sess = session_from_cookie(cookie)
    failed = False

    def go(name: str, fn: Any) -> None:
        nonlocal failed
        if not step(lines, ai, name, fn):
            failed = True

    info = vip_info(sess)
    tasks = flatten_tasks(info)
    log(
        "[账号%s] 音乐人=%s 已开通=%s canOpen=%s 近30日播放=%s 任务%s条"
        % (
            ai,
            info.get("isMusician"),
            info.get("hasOpen"),
            info.get("canOpen"),
            info.get("recentPlayCount30"),
            len(tasks),
        )
    )
    for task in tasks:
        if classify_action(task) == "ignore":
            continue
        log("  " + format_task(task))

    need_event = False
    need_mlog = False
    for task in tasks:
        action = classify_action(task)
        if action == "ignore" or task_done(task):
            continue
        if action == "event":
            need_event = True
        elif action == "mlog":
            need_mlog = True
        else:
            log("  未支持: %s" % format_task(task))

    if need_event:
        go("发布动态", lambda: publish_and_delete_event(sess))
    if need_mlog:
        go("图文笔记/mlog", lambda: publish_mlog(sess))

    if info.get("canOpen"):
        go("领取黑胶VIP", lambda: claim_vip(sess))
    return lines, failed


def main() -> None:
    cookies = load_cookies()
    if not cookies:
        raise SystemExit(
            "未配置 NETEASE_COOKIE。\n"
            "青龙「环境变量」里新增 NETEASE_COOKIE，值是浏览器 Cookie 整串，必须含 MUSIC_U 和 __csrf。"
        )

    summary: List[str] = []
    fail = 0
    success = 0
    for ai, cookie in enumerate(cookies, 1):
        if "MUSIC_U=" not in cookie:
            log("[账号%s] Cookie 缺少 MUSIC_U，跳过" % ai)
            fail += 1
            continue
        try:
            lines, failed = run_account(ai, cookie)
            summary.extend(lines)
            if failed:
                fail += 1
            else:
                success += 1
        except Exception as exc:
            fail += 1
            line = "[账号%s] 失败: %s" % (ai, exc)
            summary.append(line)
            log(line)

    title = "网易云音乐人VIP续期 成功%s 失败%s" % (success, fail)
    body = "\n".join(summary) or "无结果"
    log(title)
    notify(title, body)
    if fail:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
