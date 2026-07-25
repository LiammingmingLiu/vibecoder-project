/* 游搭 YooDa · 前端接线器 v3（桌面/移动通用）
   真产品模式：邮箱账号 · 纯真人匹配 · 打招呼建会话 · 会话管理 · 真实在线数。
   服务端不可达时不再演戏——诚实报错。 */
(function () {
  "use strict";
  if (location.protocol === "file:") return;

  var SB_URL = "https://kemqqmrltyniodcquybh.supabase.co";
  var SB_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtlbXFxbXJsdHluaW9kY3F1eWJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5NjI3NjEsImV4cCI6MjEwMDUzODc2MX0.O7EgC575w8OMpQEnoxF6v5MgWb15TCQW1HLIqaKKZi0"; /* 构建时替换为 anon key（仅用于 /auth，业务表已全量 RLS 拒绝） */
  var ADAPTER = { on: false, online: 0 };
  var SRV = { pending: null, next: null, waitTimer: null };
  var lastText = "";
  var INBOX = { matches: [] };
  S.pm = S.pm || {};       // peer 本地 id -> matchId
  S.lm = S.lm || {};       // matchId -> 最新消息 id
  S.seen = S.seen || 0;
  var isMobilePage = typeof VIEWS === "undefined";
  var mainView = isMobilePage ? "s2" : "v2";

  /* ══════════ 基础请求 ══════════ */
  function rawFetch(url, opts) {
    opts = opts || {};
    var ctl = new AbortController();
    var t = setTimeout(function () { ctl.abort(); }, opts.timeout || 10000);
    return fetch(url, {
      method: opts.method || "GET",
      signal: ctl.signal,
      headers: Object.assign({}, opts.body ? { "Content-Type": "application/json" } : {}, opts.headers || {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (r) {
      clearTimeout(t);
      return r.json().catch(function () { return {}; }).then(function (j) { j.__status = r.status; return j; });
    }, function (e) { clearTimeout(t); throw e; });
  }
  var authBad = false, lastAuthPop = 0;
  function authExpired(fromUser) {
    authBad = true; updAcct();
    var nowT = Date.now();
    if (fromUser || nowT - lastAuthPop > 30000) {
      lastAuthPop = nowT;
      openAuth(S.auth ? "登录状态过期了，重新登录一下" : "请先登录 / 注册一个游搭账号", true);
    }
  }
  function api(path, opts) {
    opts = opts || {};
    var bg = !!opts.bg;
    return ensureToken().then(function (tk) {
      if (tk) opts.headers = Object.assign({}, opts.headers, { Authorization: "Bearer " + tk });
      return rawFetch(path, opts);
    }).then(function (j) {
      if (j.__status === 401) { if (!bg) authExpired(true); else authExpired(false); throw new Error("401"); }
      if (j.__status === 403 && j.error === "NO_PROFILE") {
        if (!bg) { show(isMobilePage ? "s1" : "v1"); toast("先用一句话介绍下自己吧"); }
        throw new Error("NO_PROFILE");
      }
      if (j.__status >= 400) throw new Error(j.error || ("HTTP " + j.__status));
      authBad = false;
      return j;
    });
  }

  /* ══════════ 账号（Supabase Auth REST，无 SDK）══════════ */
  function saveAuth(s) {
    S.auth = s ? { at: s.access_token, rt: s.refresh_token, exp: Math.floor(Date.now() / 1000) + (s.expires_in || 3600), email: (s.user && s.user.email) || (S.auth && S.auth.email) || "" } : null;
    save();
  }
  var refreshing = null;
  function ensureToken() {
    if (!S.auth) return Promise.resolve(null);
    if (S.auth.exp - Math.floor(Date.now() / 1000) > 60) return Promise.resolve(S.auth.at);
    if (refreshing) return refreshing;
    refreshing = rawFetch(SB_URL + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST", headers: { apikey: SB_ANON }, body: { refresh_token: S.auth.rt },
    }).then(function (j) {
      refreshing = null;
      if (j.access_token) { saveAuth(j); return j.access_token; }
      S.lastEmail = (S.auth && S.auth.email) || S.lastEmail || "";
      saveAuth(null); updAcct(); return null;
    }).catch(function () { refreshing = null; return S.auth && S.auth.at; });
    return refreshing;
  }
  function authCall(kind, email, pwd) {
    var url = kind === "signup" ? "/auth/v1/signup" : "/auth/v1/token?grant_type=password";
    return rawFetch(SB_URL + url, { method: "POST", headers: { apikey: SB_ANON }, body: { email: email, password: pwd } })
      .then(function (j) {
        if (j.access_token) { saveAuth(j); return j; }
        var m = j.error_description || (j.error && j.error.message) || j.msg || j.error || "失败了，检查邮箱和密码";
        m = String(m);
        if (/already registered/i.test(m)) m = "这个邮箱已注册过，直接点登录";
        if (/at least 6/i.test(m)) m = "密码至少 6 位";
        if (/invalid login/i.test(m)) m = "邮箱或密码不对";
        if (/invalid.*email|validate email|is invalid/i.test(m)) m = "邮箱格式不对";
        throw new Error(m);
      });
  }

  /* ══════════ 注入样式与账号弹层 ══════════ */
  var css = document.createElement("style");
  css.textContent = "#ydAuth{position:fixed;inset:0;z-index:9000;display:none;align-items:center;justify-content:center;background:rgba(4,8,12,.74);backdrop-filter:blur(6px)}#ydAuth.on{display:flex}#ydAuth .p{width:min(360px,90vw);background:#10161d;border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:26px 24px;color:#eef4f6;font-size:15px}#ydAuth h3{margin:0 0 6px;font-size:20px}#ydAuth .hint{color:#8fa1a8;font-size:12.5px;margin:0 0 16px;line-height:1.7}#ydAuth input{width:100%;box-sizing:border-box;margin:6px 0;padding:12px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#0a1015;color:#eef4f6;font-size:16px;outline:none}#ydAuth input:focus{border-color:#38e0c2}#ydAuth .row{display:flex;gap:10px;margin-top:14px}#ydAuth .row button{flex:1;padding:12px;border-radius:10px;border:0;font-size:15px;font-weight:700;cursor:pointer}#ydAuth .pri{background:#38e0c2;color:#04211c}#ydAuth .sec{background:rgba(255,255,255,.1);color:#eef4f6}#ydAuth .msg{min-height:18px;color:#ff7d90;font-size:12.5px;margin-top:10px}#ydAuth .who{color:#8fa1a8;font-size:12.5px;margin-top:14px;display:flex;justify-content:space-between;align-items:center}#ydAuth .out{color:#ff7d90;cursor:pointer;background:none;border:0;font-size:12.5px;padding:0}.yd-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:1px}.yd-dot.on{background:#35e06f;box-shadow:0 0 6px rgba(53,224,111,.8)}.yd-dot.warm{background:#ffc14d}.yd-dot.off{background:#5b6b72}.yd-del{flex:none;border:0;background:none;color:#5b6b72;font-size:15px;cursor:pointer;padding:4px 6px}.yd-del:hover{color:#ff7d90}.yd-unread{display:inline-block;width:8px;height:8px;border-radius:50%;background:#ff5a6e;margin-left:6px}#candPanel{margin:18px auto 0;width:min(460px,90vw);text-align:left}#candPanel .ct{font-size:12px;letter-spacing:.14em;color:#8fa1a8;margin:0 0 10px}#candPanel .cr{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid rgba(255,255,255,.1);border-radius:12px;margin-bottom:8px;background:rgba(10,16,21,.72)}#candPanel .cn{font-weight:700;font-size:14.5px;flex:none}#candPanel .cl{color:#8fa1a8;font-size:12.5px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#candPanel .hi{flex:none;border:0;border-radius:9px;background:rgba(56,224,194,.16);color:#38e0c2;font-weight:700;font-size:12.5px;padding:7px 12px;cursor:pointer}#waitBox{margin:22px auto 0;text-align:center;color:#8fa1a8;font-size:14px;line-height:2}#waitBox b{color:#38e0c2}#ydAcct{position:fixed;left:14px;bottom:14px;z-index:800;border:1px solid rgba(255,255,255,.14);background:rgba(10,16,21,.82);color:#9fb2ba;border-radius:99px;font-size:12px;padding:6px 12px;cursor:pointer;backdrop-filter:blur(4px)}";
  document.head.appendChild(css);
  var av = document.createElement("div");
  av.id = "ydAuth";
  av.innerHTML = '<div class="p"><h3 id="ydT">登录游搭</h3><p class="hint" id="ydHint">邮箱 + 密码，10 秒注册。你的简介和全部聊天记录会永久保存，换设备登录即恢复。</p><input id="ydE" type="email" placeholder="邮箱（QQ / 163 都行）" autocomplete="email"><input id="ydP" type="password" placeholder="密码（至少 6 位）" autocomplete="current-password"><div class="row"><button class="pri" id="ydLogin">登录</button><button class="sec" id="ydSign">注册新号</button></div><div class="msg" id="ydMsg"></div><div class="who" id="ydWho" style="display:none"><span id="ydEmail"></span><button class="out" id="ydOut">退出登录</button></div></div>';
  document.body.appendChild(av);
  var acct = document.createElement("button");
  acct.id = "ydAcct"; acct.textContent = "登录 / 注册";
  document.body.appendChild(acct);
  acct.onclick = function () { openAuth(); };
  function openAuth(msg, relogin) {
    var logged = !!S.auth && !relogin;
    if (relogin && $("ydE")) { $("ydE").value = (S.auth && S.auth.email) || S.lastEmail || $("ydE").value; }
    $("ydT").textContent = logged ? "我的账号" : "登录游搭";
    $("ydMsg").textContent = msg || "";
    $("ydE").style.display = $("ydP").style.display = logged ? "none" : "block";
    document.querySelector("#ydAuth .row").style.display = logged ? "none" : "flex";
    $("ydHint").style.display = logged ? "none" : "block";
    $("ydWho").style.display = logged ? "flex" : "none";
    if (logged) $("ydEmail").textContent = S.auth.email || "已登录";
    av.classList.add("on");
  }
  av.addEventListener("click", function (e) { if (e.target === av) av.classList.remove("on"); });
  function doAuth(kind) {
    var em = $("ydE").value.trim(), pw = $("ydP").value;
    if (!em || !pw) { $("ydMsg").textContent = "邮箱和密码都要填"; return; }
    $("ydMsg").textContent = "请稍候…";
    authCall(kind, em, pw).then(function () {
      authBad = false; lastAuthPop = 0;
      $("ydMsg").textContent = "";
      av.classList.remove("on");
      return hydrateMe();
    }).catch(function (e) { $("ydMsg").textContent = String(e.message || e); });
  }
  $("ydLogin").onclick = function () { doAuth("login"); };
  $("ydSign").onclick = function () { doAuth("signup"); };
  $("ydOut").onclick = function () {
    try { localStorage.removeItem(LS); } catch (e) {}
    location.reload();
  };
  function updAcct() {
    acct.textContent = authBad ? "重新登录" : (S.auth ? ((S.auth.email || "账号").split("@")[0]) : "登录 / 注册");
    acct.style.color = authBad ? "#ff7d90" : "#9fb2ba";
    acct.style.borderColor = authBad ? "rgba(255,125,144,.5)" : "rgba(255,255,255,.14)";
  }

  /* 登录后拉取我的画像并恢复身份 */
  function hydrateMe() {
    updAcct();
    return api("/api/profile", { bg: true }).then(function (r) {
      if (r.profile) {
        S.pid = r.profile.id;
        S.me = { nick: r.profile.nickname, raw: r.profile.rawIntro || "" };
        save();
        if ($("nick")) $("nick").value = S.me.nick;
        if ($("intro")) $("intro").value = S.me.raw;
        show(mainView);
        tick();
      } else {
        show(isMobilePage ? "s1" : "v1");
        toast("先用一句话介绍下自己吧");
      }
    }).catch(function () {});
  }

  /* ══════════ 服务端 peer → 页面 b 形状 ══════════ */
  function toPeer(p) {
    var id = "u_" + p.id, old = null;
    for (var i = 0; i < BOTS.length; i++) if (BOTS[i].id === id) { old = BOTS[i]; break; }
    if (old) { old.status = p.status || old.status; return old; }
    var gm = (typeof GMETA !== "undefined") ? GMETA[p.game] : null;
    var b = {
      n: p.nickname, g: p.gender || "secret", v: p.voice_tag || "未知声线",
      game: p.game || "三角洲行动", role: p.role || "自由人", rank: p.rank || "—",
      st: p.play_style || "稳健", t: p.time || "晚间", m: p.mbti || "",
      intro: p.intro || "真人玩家", c: [], id: id, uuid: p.id, real: true,
      room: "", gid: "", va: 0, status: p.status || "off",
      rgb: gm ? gm[1] : [64, 224, 180], abbr: gm ? gm[0] : "YOODA",
    };
    BOTS.push(b);
    return b;
  }

  /* ══════════ Onboarding：需登录，画像入服务端 ══════════ */
  var origToCard = $("toCard").onclick;
  $("toCard").onclick = function () {
    if (!S.auth) { openAuth("先登录，你的介绍才能永久保存"); return; }
    origToCard();
    if (!S.me) return;
    api("/api/profile", { method: "POST", body: { nickname: S.me.nick, rawIntro: S.me.raw }, timeout: 16000 })
      .then(function (r) { if (r.profile) { S.pid = r.profile.id; save(); } })
      .catch(function (e) { if (String(e.message) !== "401") toast("保存失败：" + String(e.message).slice(0, 40)); });
  };

  /* ══════════ 匹配：多结果 + 蹲守，无假人兜底 ══════════ */
  function exServerIds() {
    var ex = [];
    for (var i = 0; i < S.excl.length; i++) { var x = String(S.excl[i]); if (x.slice(0, 2) === "u_") ex.push(x.slice(2)); }
    return ex;
  }
  function fireServerMatch(text) {
    SRV.next = null;
    SRV.pending = api("/api/match", { method: "POST", body: { text: text, excludeIds: exServerIds() }, timeout: 22000 })
      .then(function (r) {
        if (r.empty) { SRV.next = { empty: true }; return SRV.next; }
        var top = toPeer(r.top.profile);
        var cands = (r.candidates || []).filter(function (c) { return c.profile.id !== r.top.profile.id; })
          .map(function (c) { return { b: toPeer(c.profile), score: c.score, line: c.line, status: c.profile.status }; });
        SRV.next = { b: top, score: r.top.score, reasonLines: r.top.reasonLines || [], degraded: r.degraded || null, cands: cands };
        return SRV.next;
      })
      .catch(function (e) {
        SRV.next = { fail: String(e.message || e) };
        return SRV.next;
      });
  }
  var origGo = $("go").onclick;
  $("go").onclick = function () {
    if (!S.auth) { openAuth("登录后开始匹配真人搭子"); return; }
    origGo();
    lastText = ($("q").value || "").trim() || (S.q && S.q.raw) || "";
    if (lastText) fireServerMatch(lastText);
  };
  $("again").onclick = function () {
    if (S.swaps >= 3) { toast("换太多次啦，重新描述一下需求"); show(mainView); return; }
    S.swaps++; save();
    if (lastText) fireServerMatch(lastText);
    runMatch();
  };

  var origWhy = why;
  rank = function () {
    if (SRV.next && SRV.next.b) return { list: [{ b: SRV.next.b, s: SRV.next.score, hit: {} }], degraded: SRV.next.degraded };
    return { list: [], degraded: null };
  };
  why = function (r, x) {
    if (SRV.next && SRV.next.b === x.b && SRV.next.reasonLines.length) return SRV.next.reasonLines.slice();
    return origWhy(r, x);
  };

  var origResult = result;
  function clearWaitUI() { var w = $("waitBox"); if (w) w.remove(); }
  function stopWait() { if (SRV.waitTimer) { clearInterval(SRV.waitTimer); SRV.waitTimer = null; } clearWaitUI(); }
  result = function () {
    var waited = 0;
    (function poll() {
      if (SRV.next && SRV.next.b) { stopWait(); var keep = SRV.next; origResult(); injectCands(keep); SRV.next = null; SRV.pending = null; return; }
      if (SRV.next && SRV.next.empty) { SRV.next = null; SRV.pending = null; return enterWait(); }
      if (SRV.next && SRV.next.fail) {
        var f = SRV.next.fail; SRV.next = null; SRV.pending = null; stopWait();
        if (f !== "401") toast("匹配服务开小差：" + f.slice(0, 40));
        show(mainView); return;
      }
      if (waited >= 24000) { SRV.pending = null; stopWait(); toast("匹配超时，再试一次"); show(mainView); return; }
      waited += 250; setTimeout(poll, 250);
    })();
  };

  /* 蹲守态：暂时没有其他真人在线 */
  function enterWait() {
    var host = document.querySelector("#" + (isMobilePage ? "s2b" : "v2b") + " .inner") || $(isMobilePage ? "s2b" : "v2b");
    if (host && !$("waitBox")) {
      var d = document.createElement("div");
      d.id = "waitBox";
      d.innerHTML = "现在场上只有你一个真人玩家（在线 <b id='wOn'>" + Math.max(ADAPTER.online, 1) + "</b> 人）<br>雷达持续蹲守中——第一个进来的搭子就是你的";
      host.appendChild(d);
    }
    var tries = 0;
    if (SRV.waitTimer) clearInterval(SRV.waitTimer);
    SRV.waitTimer = setInterval(function () {
      tries++;
      if ($("wOn")) $("wOn").textContent = Math.max(ADAPTER.online, 1);
      if (tries > 15) { stopWait(); toast("暂时没等到新玩家，稍后再试"); show(mainView); return; }
      if (SRV.next && SRV.next.b) { stopWait(); var keep = SRV.next; origResult(); injectCands(keep); SRV.next = null; SRV.pending = null; return; }
      if (SRV.next) { SRV.next = null; SRV.pending = null; }
      if (!SRV.pending) fireServerMatch(lastText);
    }, 8000);
  }
  var origCancel = $("cancel").onclick;
  $("cancel").onclick = function () { stopWait(); SRV.pending = null; SRV.next = null; origCancel(); };

  /* Top1 下方的「在线的还有这些」小卡 */
  function injectCands(srv) {
    var old = $("candPanel"); if (old) old.remove();
    var cands = (srv && srv.cands) || [];
    if (!cands.length) return;
    var card = $("card"); if (!card) return;
    var p = document.createElement("div");
    p.id = "candPanel";
    p.innerHTML = '<p class="ct">在线的还有这些搭子 · 点击打招呼</p>' + cands.slice(0, 6).map(function (c) {
      return '<div class="cr"><span class="yd-dot ' + (c.status || "off") + '"></span><span class="cn">' + c.b.n + '</span><span class="cl">' + (c.line || (c.b.game + " · " + c.b.role)) + '</span><button class="hi" data-t="' + c.b.uuid + '" data-l="' + c.b.id + '">打招呼</button></div>';
    }).join("");
    card.parentNode.insertBefore(p, card.nextSibling);
    p.addEventListener("click", function (e) {
      var btn = e.target.closest(".hi"); if (!btn) return;
      sayHello(btn.dataset.t, btn.dataset.l, btn);
    });
  }
  function sayHello(uuid, localId, btn) {
    if (btn) { btn.textContent = "…"; btn.disabled = true; }
    var b = null;
    for (var i = 0; i < BOTS.length; i++) if (BOTS[i].id === localId) { b = BOTS[i]; break; }
    var first = b ? ice(b) : "在吗？一起来一把？";
    api("/api/hello", { method: "POST", body: { targetId: uuid, text: first }, timeout: 15000 })
      .then(function (r) {
        S.pm[localId] = r.matchId;
        if (!S.ss[localId]) S.ss[localId] = { m: [], k: 99 };
        if (!S.ss[localId].m.length) S.ss[localId].m.push({ me: 1, t: first });
        if (r.message) { S.seen = Math.max(S.seen, r.message.id); S.lm[r.matchId] = r.message.id; }
        save();
        openChat(localId);
      })
      .catch(function (e) { if (btn) { btn.textContent = "打招呼"; btn.disabled = false; } if (String(e.message) !== "401") toast(String(e.message).slice(0, 40)); });
  }

  /* Top1 的「开聊」也改为先打招呼建会话 */
  var origChatBtn = $("chat").onclick;
  $("chat").onclick = function () {
    var id = S.cur, b = null;
    for (var i = 0; i < BOTS.length; i++) if (BOTS[i].id === id) { b = BOTS[i]; break; }
    if (b && b.uuid && !S.pm[id]) { sayHello(b.uuid, id, null); return; }
    if (b && b.uuid) { openChat(id); return; }
    origChatBtn();
  };

  /* ══════════ 聊天 ══════════ */
  var origSend = send;
  send = function () {
    if (!(now && now.uuid && S.pm[now.id])) { toast("会话已失效，重新匹配一下"); return; }
    var v = $("cIn").value.trim(); if (!v) return;
    S.ss[now.id].m.push({ me: 1, t: v }); $("cIn").value = ""; draw(); save();
    api("/api/messages", { method: "POST", body: { matchId: S.pm[now.id], content: v }, timeout: 12000 })
      .then(function (r) { if (r.sent) { S.seen = Math.max(S.seen, r.sent.id); S.lm[S.pm[now.id]] = r.sent.id; save(); } })
      .catch(function (e) { if (String(e.message) !== "401") toast("没发出去，重试一下"); });
  };
  var origOpen = openChat;
  openChat = function (id) {
    var b = null;
    for (var i = 0; i < BOTS.length; i++) if (BOTS[i].id === id) { b = BOTS[i]; break; }
    if (!(b && b.uuid && S.pm[id])) { toast("这个会话已失效，重新匹配一下"); return; }
    if (!S.ss[id]) S.ss[id] = { m: [], k: 99 };
    S.ss[id].k = 99; /* 永不触发页面自带的剧本回复 */
    var r = origOpen(id);
    var mid = S.pm[id];
    if (S.lm[mid]) api("/api/chatops", { method: "POST", bg: true, body: { op: "read", matchId: mid, lastId: S.lm[mid] } }).catch(function () {});
    var im = INBOX.matches.find(function (x) { return x.matchId === mid; });
    if (im) im.unread = false;
    renderList();
    return r;
  };

  /* ══════════ 会话列表 2.0：最新置顶 · 状态点 · 未读 · 删除 ══════════ */
  renderList = function () {
    var box = $("listBox"); if (!box) return;
    var items = INBOX.matches;
    if (!items.length) {
      box.innerHTML = '<p style="font-size:12.5px;color:#7a8a91;padding:8px 6px;line-height:1.8">还没有聊过的搭子。<br>去匹配一个，打个招呼。</p>';
      return;
    }
    box.innerHTML = items.map(function (it) {
      var b = toPeer(it.partner);
      var prev = it.last ? ((it.last.mine ? "我：" : "") + it.last.text) : "打个招呼吧";
      return '<button class="item ' + (now && now.id === b.id ? "on" : "") + '" data-id="' + b.id + '" style="display:flex;align-items:center;gap:8px;width:100%">' +
        '<span class="av" style="background:' + grad(b) + ';flex:none">' + b.n[0] + '</span>' +
        '<span style="flex:1;min-width:0;text-align:left"><span class="nm" style="display:block"><span class="yd-dot ' + it.status + '"></span>' + b.n + (it.unread ? '<span class="yd-unread"></span>' : "") + '</span>' +
        '<span class="ls" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + prev + "</span></span>" +
        '<span class="yd-del" data-del="' + it.matchId + '" data-lid="' + b.id + '" title="删除会话">✕</span></button>';
    }).join("");
    Array.prototype.forEach.call(box.children, function (el) {
      if (!el.dataset || !el.dataset.id) return;
      el.onclick = function (e) {
        var del = e.target.closest(".yd-del");
        if (del) {
          e.stopPropagation();
          if (!confirm("删除后这个会话对你永久消失，确定？")) return;
          api("/api/chatops", { method: "POST", body: { op: "delete", matchId: del.dataset.del } })
            .then(function () {
              INBOX.matches = INBOX.matches.filter(function (x) { return x.matchId !== del.dataset.del; });
              delete S.ss[del.dataset.lid]; delete S.pm[del.dataset.lid]; save();
              if (now && now.id === del.dataset.lid) { var c = $("cClose") || $("back"); if (c && c.onclick) c.onclick(); }
              renderList();
            }).catch(function () { toast("删除失败，重试一下"); });
          return;
        }
        openChat(el.dataset.id);
      };
    });
  };

  /* ══════════ 收件箱轮询：心跳 + 列表 + 增量消息 ══════════ */
  function tick() {
    if (!ADAPTER.on || !S.auth || !S.pid || authBad) return;
    api("/api/inbox?afterMsgId=" + S.seen, { timeout: 9000, bg: true }).then(function (r) {
      ADAPTER.online = r.online || 0;
      setCounter(r.online);
      var known = {};
      INBOX.matches = r.matches || [];
      INBOX.matches.forEach(function (m) {
        var b = toPeer(m.partner);
        S.pm[b.id] = m.matchId;
        known[m.matchId] = b;
        if (m.last) S.lm[m.matchId] = Math.max(S.lm[m.matchId] || 0, m.last.id);
        if (!S.ss[b.id]) S.ss[b.id] = { m: [], k: 99 };
      });
      (r.messages || []).forEach(function (msg) {
        if (msg.id <= S.seen) return;
        S.seen = Math.max(S.seen, msg.id);
        if (msg.sender_id === S.pid) return;
        var b = known[msg.match_id]; if (!b) return;
        S.ss[b.id].m.push({ me: 0, t: msg.content });
        if (now && now.id === b.id && (($("chatView") && $("chatView").classList.contains("on")) || isMobilePage)) {
          try { draw(); } catch (e) {}
          api("/api/chatops", { method: "POST", bg: true, body: { op: "read", matchId: msg.match_id, lastId: msg.id } }).catch(function () {});
        } else {
          toast(b.n + "：" + msg.content.slice(0, 18));
          flashTitle();
        }
      });
      save(); renderList();
    }).catch(function () {});
  }

  /* 标题未读提示（切走时）*/
  var baseTitle = document.title, flashT = null;
  function flashTitle() {
    if (document.visibilityState === "visible") return;
    var unread = INBOX.matches.filter(function (m) { return m.unread; }).length || 1;
    document.title = "(" + unread + ") " + baseTitle;
    if (!flashT) flashT = setInterval(function () {
      if (document.visibilityState === "visible") { document.title = baseTitle; clearInterval(flashT); flashT = null; }
    }, 1500);
  }

  /* ══════════ 首页真实在线数 ══════════ */
  function setCounter(n) {
    var el = $("onlineN");
    if (el && typeof n === "number") el.textContent = Math.max(n, 1).toLocaleString();
  }
  function pollStats() {
    rawFetch("/api/stats", { timeout: 8000 }).then(function (r) {
      if (r.__status === 200) { ADAPTER.on = true; ADAPTER.online = r.online || 0; setCounter(r.online); }
    }).catch(function () {});
  }

  /* ══════════ 启动 ══════════ */
  pollStats();
  setInterval(pollStats, 30000);
  setInterval(tick, 4000);
  updAcct();
  if (S.auth) hydrateMe();
  else setTimeout(function () { if (!S.auth) openAuth(); }, 800);
})();
