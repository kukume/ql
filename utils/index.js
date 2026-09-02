'use strict';

/** 公共方法，不要添加到青龙定时任务 */

const crypto = require('crypto');
const fs = require('fs');
const { execFileSync } = require('child_process');

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const QL_AUTH_FILES = ['/ql/data/config/auth.json', '/ql/config/auth.json'];
const QL_DB_FILES = ['/ql/data/db/database.sqlite', '/ql/db/database.sqlite'];
const QL_API_BASES = ['http://127.0.0.1:5700', 'http://127.0.0.1:5701'];

function env(name, fallback = '') {
  const value = process.env[name];
  return value == null || value === '' ? fallback : value;
}

function splitRawValues(raw) {
  if (!raw) return [];
  const text = String(raw).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!text) return [];
  if (text.includes('@#@')) {
    return text.split('@#@').map((s) => s.trim()).filter(Boolean);
  }
  if (text.includes('\n')) {
    return text.split('\n').map((s) => s.trim()).filter(Boolean);
  }
  return [text];
}

function parseOneAccount(item, extraKeys, index) {
  if (item.startsWith('{')) {
    try {
      return normalizeAccount(JSON.parse(item), extraKeys, index);
    } catch {
      // fall through
    }
  }
  const parts = item.split('#');
  if (extraKeys.length && parts.length > 1) {
    const obj = { remarks: `账号${index + 1}` };
    extraKeys.forEach((key, i) => {
      if (parts[i] != null && parts[i] !== '') obj[key] = parts[i];
    });
    if (parts.length > extraKeys.length) {
      obj.remarks = parts[extraKeys.length] || obj.remarks;
    }
    return obj;
  }
  const obj = { remarks: `账号${index + 1}` };
  if (extraKeys[0]) obj[extraKeys[0]] = item;
  else obj.cookie = item;
  return obj;
}

function parseAccounts(raw, extraKeys = []) {
  if (!raw) return [];
  const text = String(raw).trim();
  if (!text) return [];
  if (text.startsWith('[') || text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      return list.map((item, index) => normalizeAccount(item, extraKeys, index));
    } catch {
      // fall through to delimiter parsing
    }
  }
  return splitRawValues(text).map((item, index) => parseOneAccount(item, extraKeys, index));
}

function qlAuthToken() {
  for (const file of QL_AUTH_FILES) {
    try {
      if (!fs.existsSync(file)) continue;
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      const token = data.token || (data.tokens && data.tokens.desktop) || '';
      if (token) return token;
    } catch {
      // ignore malformed auth.json
    }
  }
  return '';
}

async function valuesFromQlApi(name) {
  const token = qlAuthToken();
  if (!token) return [];
  let lastErr = null;
  for (const base of QL_API_BASES) {
    try {
      const res = await request(`${base}/api/envs?searchValue=${encodeURIComponent(name)}`, {
        headers: { authorization: `Bearer ${token}` },
        timeout: 5000,
      });
      const rows = res.json?.data || [];
      const values = [];
      for (const row of rows) {
        if (row?.name !== name) continue;
        if (Number(row.status) !== 0) continue;
        const value = String(row.value || '').trim();
        if (value) values.push(value);
      }
      if (values.length) return values;
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) console.log(`青龙 API 读取环境变量失败: ${lastErr.message || lastErr}`);
  return [];
}

function valuesFromQlDb(name) {
  const safeName = String(name).replace(/'/g, "''");
  for (const db of QL_DB_FILES) {
    try {
      if (!fs.existsSync(db)) continue;
      const out = execFileSync(
        'sqlite3',
        ['-json', db, `SELECT value FROM Envs WHERE name='${safeName}' AND status=0`],
        { encoding: 'utf8', timeout: 5000 }
      );
      const rows = JSON.parse(out || '[]');
      const values = rows
        .map((row) => String(row.value || '').trim())
        .filter(Boolean);
      if (values.length) return values;
    } catch (e) {
      if (e.code !== 'ENOENT') console.log(`青龙数据库读取失败: ${e.message || e}`);
    }
  }
  return [];
}

/**
 * 多账号环境变量。
 *
 * 青龙会把同名变量 join('&') 写进 process.env，Cookie 里自带的 & 会被切坏。
 * 读取顺序：青龙 API 按条 → sqlite 按条 → process.env（仅按换行 / @#@ 拆，不按 &）。
 */
async function loadEnvValues(name) {
  if (!name) return [];
  const fromApi = await valuesFromQlApi(name);
  if (fromApi.length) {
    console.log(`环境变量 ${name} 来源: 青龙 API，共 ${fromApi.length} 条`);
    return fromApi;
  }
  const fromDb = valuesFromQlDb(name);
  if (fromDb.length) {
    console.log(`环境变量 ${name} 来源: 青龙数据库，共 ${fromDb.length} 条`);
    return fromDb;
  }
  const fromEnv = splitRawValues(env(name));
  if (fromEnv.length) {
    console.log(
      `环境变量 ${name} 来源: process.env，共 ${fromEnv.length} 条（同名变量若被 & 拼接，请改用多条同名变量或换行）`
    );
  }
  return fromEnv;
}

function parseAccountValues(values, extraKeys = []) {
  const accounts = [];
  for (const raw of values || []) {
    accounts.push(...parseAccounts(raw, extraKeys));
  }
  return accounts.map((account, index) => {
    if (!account.remarks || /^账号\d+$/.test(account.remarks)) {
      return { ...account, remarks: `账号${index + 1}` };
    }
    return account;
  });
}

async function loadAccounts(nameOrNames, extraKeys = []) {
  const names = Array.isArray(nameOrNames) ? nameOrNames : [nameOrNames];
  for (const name of names) {
    const values = await loadEnvValues(name);
    if (values.length) return parseAccountValues(values, extraKeys);
  }
  return [];
}

function normalizeAccount(item, extraKeys, index) {
  if (typeof item === 'string') {
    const obj = { remarks: `账号${index + 1}` };
    if (extraKeys[0]) obj[extraKeys[0]] = item;
    else obj.cookie = item;
    return obj;
  }
  return {
    remarks: item.remarks || item.remark || item.name || `账号${index + 1}`,
    ...item,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function md5(text) {
  return crypto.createHash('md5').update(String(text), 'utf8').digest('hex');
}

function letter(length) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let out = '';
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function digits(length) {
  let out = '';
  for (let i = 0; i < length; i++) out += Math.floor(Math.random() * 10);
  return out;
}

function uuid() {
  return crypto.randomUUID();
}

function cookieMap(cookie = '') {
  const map = new Map();
  String(cookie)
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((part) => {
      const eq = part.indexOf('=');
      if (eq <= 0) return;
      const key = part.slice(0, eq).trim();
      const value = part.slice(eq + 1);
      if (value === 'deleted') return;
      map.set(key, value);
    });
  return map;
}

function cookieValue(cookie, name) {
  return cookieMap(cookie).get(name) || '';
}

function mergeCookie(...cookies) {
  const map = new Map();
  for (const cookie of cookies) {
    for (const [k, v] of cookieMap(cookie || '')) map.set(k, v);
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function parseSetCookie(headers) {
  let list = [];
  if (headers && typeof headers.getSetCookie === 'function') {
    list = headers.getSetCookie();
  } else if (headers && typeof headers.raw === 'function') {
    list = headers.raw()['set-cookie'] || [];
  } else if (headers && headers['set-cookie']) {
    list = Array.isArray(headers['set-cookie']) ? headers['set-cookie'] : [headers['set-cookie']];
  }
  return list
    .map((item) => String(item).split(';')[0])
    .filter((item) => item && !/=deleted$/i.test(item))
    .join('; ');
}

function renderForm(data) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(data || {})) {
    if (v == null) continue;
    params.append(k, String(v));
  }
  return params.toString();
}

async function request(url, options = {}) {
  const {
    method = 'GET',
    headers = {},
    cookie = '',
    json,
    form,
    body,
    followRedirect = false,
    timeout = 60000,
  } = options;

  const hdr = {
    'user-agent': DEFAULT_UA,
    accept: '*/*',
    ...Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
    ),
  };
  if (cookie) hdr.cookie = cookie;

  let payload = body;
  if (json != null) {
    hdr['content-type'] = hdr['content-type'] || 'application/json';
    payload = typeof json === 'string' ? json : JSON.stringify(json);
  } else if (form != null) {
    hdr['content-type'] = hdr['content-type'] || 'application/x-www-form-urlencoded';
    payload = typeof form === 'string' ? form : renderForm(form);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: hdr,
      body: method === 'GET' || method === 'HEAD' ? undefined : payload,
      redirect: followRedirect ? 'follow' : 'manual',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const setCookie = parseSetCookie(res.headers);
  const location = res.headers.get('location') || '';
  const buffer = Buffer.from(await res.arrayBuffer());
  const text = buffer.toString('utf8');
  let data = null;
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      data = JSON.parse(trimmed);
    } catch {
      data = null;
    }
  }
  return {
    status: res.status,
    ok: res.status >= 200 && res.status < 300,
    headers: res.headers,
    location,
    setCookie,
    cookie: mergeCookie(cookie, setCookie),
    text,
    json: data,
    buffer,
  };
}

function jsonpToJson(text) {
  const match = String(text).match(/\{(?:[^{}]|\{[^{}]*})*}/);
  if (!match) throw new Error('json not found');
  return JSON.parse(match[0]);
}

function extract(text, start, end) {
  const escapedStart = start.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedEnd = end.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(text).match(new RegExp(`${escapedStart}(.*?)${escapedEnd}`));
  return match ? match[1] : '';
}

function rsaEncrypt(plain, publicKeyStr) {
  const pem = publicKeyStr.includes('BEGIN')
    ? publicKeyStr
    : `-----BEGIN PUBLIC KEY-----\n${publicKeyStr}\n-----END PUBLIC KEY-----`;
  const encrypted = crypto.publicEncrypt(
    { key: pem, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(String(plain), 'utf8')
  );
  return encrypted.toString('base64');
}

function rsaEncryptToHex(plain, publicKeyStr) {
  return Buffer.from(rsaEncrypt(plain, publicKeyStr), 'base64').toString('hex');
}

function aesCbcEncrypt(plain, key, iv) {
  const cipher = crypto.createCipheriv('aes-128-cbc', Buffer.from(key), Buffer.from(iv));
  return Buffer.concat([cipher.update(Buffer.from(plain, 'utf8')), cipher.final()]);
}

function loadCheerio() {
  try {
    return require('cheerio');
  } catch {
    return null;
  }
}

async function sendNotify(title, content) {
  const body = `${title}\n${content}`;
  console.log(body);
  const candidates = ['./sendNotify', '../sendNotify', '../../sendNotify'];
  for (const file of candidates) {
    try {
      const notify = require(file);
      if (notify && typeof notify.sendNotify === 'function') {
        await notify.sendNotify(title, content);
        return;
      }
    } catch {
      // ignore missing notify module
    }
  }
}

async function geeTest(gt, challenge, pageUrl) {
  const damagou = env('DAMAGOU_KEY');
  if (damagou) {
    const url =
      `http://api.damagou.top/apiv1/jiyanRecognize.html?userkey=${encodeURIComponent(damagou)}` +
      `&gt=${encodeURIComponent(gt)}&challenge=${encodeURIComponent(challenge)}&isJson=2` +
      `&headers=${encodeURIComponent(`referer|${pageUrl}`)}`;
    const res = await request(url);
    const json = res.json || JSON.parse(res.text);
    if (json.status === 0) {
      const [ch, validate] = String(json.data).split('|');
      return { challenge: ch, validate, secCode: `${validate}|jordan` };
    }
    throw new Error(json.msg || '打码狗识别失败');
  }

  const twoKey = env('TWOCAPTCHA_KEY');
  if (!twoKey) throw new Error('需要极验验证码，请配置 DAMAGOU_KEY 或 TWOCAPTCHA_KEY');

  const create = await request('https://api.2captcha.com/createTask', {
    method: 'POST',
    json: {
      clientKey: twoKey,
      task: {
        type: 'GeeTestTaskProxyless',
        gt,
        challenge,
        websiteURL: pageUrl,
      },
    },
  });
  if (!create.json || create.json.errorId) {
    throw new Error('识别验证码失败：' + (create.json?.errorDescription || create.text));
  }
  const taskId = create.json.taskId;
  for (let i = 0; i < 35; i++) {
    await sleep(2000);
    const result = await request('https://api.2captcha.com/getTaskResult', {
      method: 'POST',
      json: { clientKey: twoKey, taskId },
    });
    if (!result.json || result.json.errorId) {
      throw new Error('识别验证码失败：' + (result.json?.errorDescription || result.text));
    }
    if (result.json.status === 'processing') continue;
    const solution = result.json.solution || {};
    return {
      challenge: solution.challenge,
      validate: solution.validate,
      secCode: solution.seccode || `${solution.validate}|jordan`,
    };
  }
  throw new Error('无法识别验证码');
}

async function runAccounts(name, accounts, handler) {
  if (!accounts.length) {
    console.log(`未配置${name}账号，跳过`);
    return;
  }
  const logs = [];
  let failed = 0;
  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    const label = account.remarks || `账号${i + 1}`;
    try {
      const remark = await handler(account, i);
      const line = `✅ ${label}：${remark || '成功'}`;
      console.log(line);
      logs.push(line);
    } catch (e) {
      failed += 1;
      const line = `❌ ${label}：${e.message || e}`;
      console.log(line);
      logs.push(line);
    }
    if (i < accounts.length - 1) await sleep(3000);
  }
  const title = name;
  const content = logs.join('\n');
  if (failed > 0 || env('QL_NOTIFY_ALL', 'false') === 'true') {
    await sendNotify(title, content);
  }
}

function Env(name) {
  return { name };
}

module.exports = {
  DEFAULT_UA,
  env,
  parseAccounts,
  loadEnvValues,
  loadAccounts,
  sleep,
  md5,
  letter,
  digits,
  uuid,
  cookieMap,
  cookieValue,
  mergeCookie,
  parseSetCookie,
  request,
  jsonpToJson,
  extract,
  rsaEncrypt,
  rsaEncryptToHex,
  aesCbcEncrypt,
  loadCheerio,
  sendNotify,
  geeTest,
  runAccounts,
  Env,
};
