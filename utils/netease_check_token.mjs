/**
 * Official NetEase Yidun Watchman getToken, without a real browser.
 * Loads acstatic-dun tool.min.js + watchman.min.js and speaks JSONP to ac.dun.163.com.
 *
 * Usage: node get-check-token.mjs [productNumber] [businessId]
 */
import https from "node:https";
import http from "node:http";
import vm from "node:vm";
import { URL } from "node:url";

const PRODUCT = process.argv[2] || "YD00000558929251";
const BUSINESS = process.argv[3] || "bd5d2f973ef74cd2a61325a412ae54d9";
const PAGE_URL = "https://music.163.com/";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https:") ? https : http;
    const req = lib.get(
      url,
      {
        headers: {
          "User-Agent": UA,
          Referer: PAGE_URL,
          Accept: "*/*",
        },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          fetchText(new URL(res.headers.location, url).href).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error("GET " + url + " -> " + res.statusCode));
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      }
    );
    req.on("error", reject);
    req.setTimeout(15000, () => {
      req.destroy(new Error("timeout " + url));
    });
  });
}

function createStorage() {
  const map = new Map();
  return {
    getItem(k) {
      return map.has(String(k)) ? map.get(String(k)) : null;
    },
    setItem(k, v) {
      map.set(String(k), String(v));
    },
    removeItem(k) {
      map.delete(String(k));
    },
    clear() {
      map.clear();
    },
    get length() {
      return map.size;
    },
    key(i) {
      return [...map.keys()][i] ?? null;
    },
  };
}

function createWindow() {
  const start = Date.now();
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  const listeners = {};

  const location = {
    href: PAGE_URL,
    protocol: "https:",
    host: "music.163.com",
    hostname: "music.163.com",
    pathname: "/",
    search: "",
    hash: "",
    origin: "https://music.163.com",
    port: "",
    toString() {
      return PAGE_URL;
    },
  };

  const navigator = {
    userAgent: UA,
    platform: "Win32",
    language: "zh-CN",
    languages: ["zh-CN", "zh", "en"],
    cookieEnabled: true,
    hardwareConcurrency: 8,
    maxTouchPoints: 0,
    vendor: "Google Inc.",
    appName: "Netscape",
    appCodeName: "Mozilla",
    appVersion: UA.replace(/^Mozilla\//, ""),
    product: "Gecko",
    productSub: "20030107",
    onLine: true,
    doNotTrack: null,
    webdriver: false,
    plugins: { length: 0, item: () => null, namedItem: () => null },
    mimeTypes: { length: 0, item: () => null, namedItem: () => null },
    javaEnabled() {
      return false;
    },
  };

  const screen = {
    width: 1920,
    height: 1080,
    availWidth: 1920,
    availHeight: 1040,
    colorDepth: 24,
    pixelDepth: 24,
  };

  const document = {
    cookie: "",
    documentElement: { clientWidth: 1920, clientHeight: 1080, style: {} },
    body: null,
    head: null,
    compatMode: "CSS1Compat",
    hidden: false,
    visibilityState: "visible",
    readyState: "complete",
    title: "网易云音乐",
    referrer: PAGE_URL,
    characterSet: "UTF-8",
    charset: "UTF-8",
    createElement(tag) {
      return createElement(String(tag).toLowerCase());
    },
    createEvent() {
      return { initEvent() {} };
    },
    getElementsByTagName(tag) {
      tag = String(tag).toLowerCase();
      if (tag === "head") return [document.head];
      if (tag === "body") return [document.body];
      if (tag === "script") return scriptNodes.slice();
      return [];
    },
    getElementById() {
      return null;
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    addEventListener(type, fn) {
      (listeners[type] || (listeners[type] = [])).push(fn);
    },
    removeEventListener(type, fn) {
      listeners[type] = (listeners[type] || []).filter((x) => x !== fn);
    },
    appendChild(child) {
      if (child.tagName === "SCRIPT") {
        if (child.src) loadScriptEl(child);
        scriptNodes.push(child);
      }
      child.parentNode = document;
      child.parentElement = document;
      return child;
    },
    insertBefore(child, ref) {
      return document.appendChild(child);
    },
    removeChild(child) {
      const i = scriptNodes.indexOf(child);
      if (i >= 0) scriptNodes.splice(i, 1);
      return child;
    },
  };

  const scriptNodes = [];

  function createElement(tag) {
    const el = {
      tagName: tag.toUpperCase(),
      nodeName: tag.toUpperCase(),
      style: {},
      children: [],
      childNodes: [],
      parentNode: null,
      parentElement: null,
      className: "",
      id: "",
      src: "",
      type: "",
      charset: "",
      async: true,
      text: "",
      innerHTML: "",
      innerText: "",
      textContent: "",
      width: 300,
      height: 150,
      offsetWidth: 300,
      offsetHeight: 150,
      clientWidth: 300,
      clientHeight: 150,
      onload: null,
      onerror: null,
      onreadystatechange: null,
      readyState: "",
      setAttribute(name, value) {
        el[name] = value;
        if (name === "src") el.src = value;
      },
      getAttribute(name) {
        return el[name] ?? null;
      },
      appendChild(child) {
        el.children.push(child);
        child.parentNode = el;
        child.parentElement = el;
        return child;
      },
      removeChild(child) {
        el.children = el.children.filter((c) => c !== child);
        return child;
      },
      insertBefore(child, ref) {
        const i = el.children.indexOf(ref);
        if (i >= 0) el.children.splice(i, 0, child);
        else el.children.push(child);
        child.parentNode = el;
        child.parentElement = el;
        if (child.tagName === "SCRIPT" && child.src) loadScriptEl(child);
        return child;
      },
      getContext() {
        return null;
      },
      toDataURL() {
        return "data:image/png;base64,";
      },
      getShaderPrecisionFormat() {
        return { rangeMin: 0, rangeMax: 0, precision: 0 };
      },
      addEventListener() {},
      removeEventListener() {},
      attachEvent() {},
      detachEvent() {},
    };
    return el;
  }

  const head = createElement("head");
  const body = createElement("body");
  document.head = head;
  document.body = body;
  head.parentNode = document;
  body.parentNode = document;

  const origAppend = head.appendChild.bind(head);
  head.appendChild = function (child) {
    origAppend(child);
    if (child.tagName === "SCRIPT" && child.src) loadScriptEl(child);
    return child;
  };
  body.appendChild = function (child) {
    body.children.push(child);
    child.parentNode = body;
    if (child.tagName === "SCRIPT" && child.src) loadScriptEl(child);
    return child;
  };
  body.insertBefore = head.insertBefore;

  const window = {
    window: null,
    self: null,
    top: null,
    parent: null,
    document,
    location,
    navigator,
    screen,
    localStorage,
    sessionStorage,
    innerWidth: 1920,
    innerHeight: 1080,
    outerWidth: 1920,
    outerHeight: 1080,
    devicePixelRatio: 1,
    pageXOffset: 0,
    pageYOffset: 0,
    length: 0,
    chrome: { runtime: {} },
    performance: {
      now() {
        return Date.now() - start;
      },
      timing: {
        navigationStart: start,
        fetchStart: start,
        requestStart: start,
        responseStart: start + 10,
        responseEnd: start + 20,
      },
    },
    history: { length: 2 },
    console,
    Date,
    Math,
    JSON,
    Error,
    TypeError,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    parseInt,
    parseFloat,
    isFinite,
    isNaN,
    encodeURIComponent,
    decodeURIComponent,
    encodeURI,
    decodeURI,
    escape,
    unescape,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Uint8Array,
    Int8Array,
    Uint16Array,
    Int16Array,
    Uint32Array,
    Int32Array,
    Float32Array,
    Float64Array,
    ArrayBuffer,
    Promise,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Symbol,
    Proxy,
    Reflect,
    addEventListener(type, fn) {
      (listeners[type] || (listeners[type] = [])).push(fn);
    },
    removeEventListener(type, fn) {
      listeners[type] = (listeners[type] || []).filter((x) => x !== fn);
    },
    attachEvent() {},
    detachEvent() {},
    XMLHttpRequest: function () {
      throw new Error("XHR not used");
    },
  };
  window.window = window;
  window.self = window;
  window.top = window;
  window.parent = window;
  window.globalThis = window;

  const ctx = vm.createContext(window);

  function runScript(code, filename) {
    vm.runInContext(code, ctx, { filename, timeout: 20000 });
  }

  async function loadScriptEl(el) {
    try {
      const code = await fetchText(el.src);
      el.readyState = "loading";
      runScript(code, el.src);
      el.readyState = "complete";
      if (typeof el.onload === "function") el.onload();
      if (typeof el.onreadystatechange === "function") el.onreadystatechange();
    } catch (e) {
      if (typeof el.onerror === "function") el.onerror(e);
      else console.error("script load failed", el.src, e.message);
    }
  }

  async function loadUrl(url) {
    const code = await fetchText(url);
    runScript(code, url);
  }

  return { window, ctx, loadUrl, runScript };
}

function timeout(ms, label) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(label + " timeout")), ms));
}

const { window, loadUrl } = createWindow();

await loadUrl("https://acstatic-dun.126.net/tool.min.js");
if (typeof window.initWatchman !== "function") {
  throw new Error("initWatchman not installed");
}

const instance = await Promise.race([
  new Promise((resolve, reject) => {
    window.initWatchman({
      productNumber: PRODUCT,
      onload: (inst) => resolve(inst),
      onerror: (err) => reject(err || new Error("initWatchman onerror")),
    });
  }),
  timeout(20000, "initWatchman"),
]);

const token = await Promise.race([
  new Promise((resolve, reject) => {
    instance.getToken(
      BUSINESS,
      (t) => resolve(t),
      (err) => reject(err || new Error("getToken error"))
    );
  }),
  timeout(20000, "getToken"),
]);

if (!token || typeof token !== "string") {
  throw new Error("empty token");
}

process.stdout.write(token);
process.exit(0);
