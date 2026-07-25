/* 游搭 YooDa · 前端接线器（桌面版/移动版通用）
   原页面 = 离线演出（保留为兜底）；本文件把 匹配/画像/聊天 切换到真实后端。
   探活失败或 file:// 打开时自动退回纯离线模式，现场断网不开天窗。 */
(function () {
  "use strict";
  if (location.protocol === "file:") return;

  var ADAPTER = { on: false };
  var SRV = { pending: null, next: null };
  var lastText = "";
  S.pm = S.pm || {};        // peer 本地 id -> matchId
  S.pmSeen = S.pmSeen || {};// 已提示过的 matchId
  S.seen = S.seen || 0;     // 已处理的最大消息 id
  var isMobilePage = typeof VIEWS === "undefined";
  var mainView = isMobilePage ? "s2" : "v2";

  function api(path, opts) {
    opts = opts || {};
    var ctl = new AbortController();
    var t = setTimeout(function () { ctl.abort(); }, opts.timeout || 9000);
    return fetch(path, {
      method: opts.method || "GET",
      signal: ctl.signal,
      headers: opts.body ? { "Content-Type": "application/json" } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (r) {
      clearTimeout(t);
      return r.json().then(function (j) { if (!r.ok && j && j.error) throw new Error(j.error); return j; });
    }).catch(function (e) { clearTimeout(t); throw e; });
  }

  /* 服务端 profile → 页面 b 形状，并注册进 BOTS（id 前缀 u_ 防撞） */
  function toPeer(p) {
    var id = "u_" + p.id;
    var old = null;
    for (var i = 0; i < BOTS.length; i++) if (BOTS[i].id === id) { old = BOTS[i]; break; }
    if (old) return old;
    var meta = p.bot_meta || {};
    var gm = (typeof GMETA !== "undefined") ? GMETA[p.game] : null;
    var b = {
      n: p.nickname, g: p.gender || "secret", v: p.voice_tag || "不开麦",
      game: p.game || "三角洲行动", role: p.role || "自由人", rank: p.rank || "—",
      st: p.play_style || "稳健", t: p.time || "晚间", m: p.mbti || "",
      intro: p.intro || (p.is_bot ? "" : "真人玩家，现场刚上线。"),
      c: meta.canned || ["在的在的，上号吗？"],
      id: id, uuid: p.id, real: !p.is_bot,
      room: meta.room || String(100000 + Math.floor(Math.random() * 899999)),
      gid: meta.gid || ((p.nickname || "玩家").slice(0, 2) + "#" + (1000 + Math.floor(Math.random() * 8999))),
      va: meta.va || 0,
      rgb: meta.rgb || (gm ? gm[1] : (BOTS[0] && BOTS[0].rgb) || [64, 224, 180]),
      abbr: gm ? gm[0] : (meta.abbr || "YOODA"),
    };
    BOTS.push(b);
    return b;
  }

  /* ── 身份 ── */
  function ensurePid() {
    if (S.pid) return Promise.resolve(S.pid);
    var nick = (S.me && S.me.nick) || ("玩家" + Math.floor(1000 + Math.random() * 9000));
    var raw = (S.me && S.me.raw) || "";
    return api("/api/profile", { method: "POST", body: { nickname: nick, rawIntro: raw } })
      .then(function (r) { if (r && r.profile) { S.pid = r.profile.id; save(); } return S.pid; });
  }

  /* ── onboarding：原逻辑照跑，画像异步同步到服务端 ── */
  var origToCard = $("toCard").onclick;
  $("toCard").onclick = function () {
    origToCard();
    if (!ADAPTER.on || !S.me) return;
    api("/api/profile", { method: "POST", body: { id: S.pid, nickname: S.me.nick, rawIntro: S.me.raw } })
      .then(function (r) { if (r && r.profile) { S.pid = r.profile.id; save(); } })
      .catch(function () {});
  };

  /* ── 匹配：原动画照播，服务端并行撮合 ── */
  function fireServerMatch(text) {
    SRV.next = null;
    SRV.pending = ensurePid().catch(function () { return null; }).then(function (pid) {
      var ex = [];
      for (var i = 0; i < S.excl.length; i++) {
        var x = String(S.excl[i]);
        if (x.slice(0, 2) === "u_") ex.push(x.slice(2));
      }
      return api("/api/match", { method: "POST", body: { profileId: pid, text: text, excludeIds: ex }, timeout: 15000 });
    }).then(function (r) {
      if (r && r.partner) {
        var b = toPeer(r.partner);
        S.pm[b.id] = r.matchId; save();
        SRV.next = { b: b, score: r.score || 88, reasonLines: r.reasonLines || [], degraded: r.degraded || null };
      }
      return SRV.next;
    }).catch(function () { SRV.pending = null; return null; });
  }
  var origGo = $("go").onclick;
  $("go").onclick = function () {
    origGo();
    lastText = ($("q").value || "").trim() || (S.q && S.q.raw) || "";
    if (ADAPTER.on && lastText) fireServerMatch(lastText);
  };
  $("again").onclick = function () {
    if (S.swaps >= 3) { toast("换太多次啦，重新描述一下需求"); show(mainView); return; }
    S.swaps++; save();
    if (ADAPTER.on && lastText) fireServerMatch(lastText);
    runMatch();
  };

  /* ── rank / why 注入服务端结果 ── */
  var origRank = rank, origWhy = why;
  rank = function (r, exclude) {
    if (SRV.next) return { list: [{ b: SRV.next.b, s: SRV.next.score, hit: {} }], degraded: SRV.next.degraded };
    return origRank(r, exclude);
  };
  why = function (r, x) {
    if (SRV.next && x.b === SRV.next.b && SRV.next.reasonLines.length) return SRV.next.reasonLines.slice();
    return origWhy(r, x);
  };

  /* ── result：多等服务端最多 6 秒，超时回本地 ── */
  var origResult = result;
  result = function () {
    if (!ADAPTER.on || !SRV.pending) { SRV.next = null; return origResult(); }
    var waited = 0;
    (function poll() {
      if (SRV.next) { origResult(); SRV.next = null; SRV.pending = null; return; }
      if (waited >= 10000 || !SRV.pending) { SRV.pending = null; SRV.next = null; return origResult(); }
      waited += 250; setTimeout(poll, 250);
    })();
  };

  /* ── 聊天：服务端收发 + bot 真回复 ── */
  function srvPeer() { return now && now.uuid && S.pm[now.id]; }
  var origSend = send;
  send = function () {
    if (!srvPeer()) return origSend();
    var v = $("cIn").value.trim(); if (!v) return;
    S.ss[now.id].m.push({ me: 1, t: v }); $("cIn").value = ""; draw(); save();
    typing(true);
    api("/api/messages", { method: "POST", body: { matchId: S.pm[now.id], senderId: S.pid, content: v }, timeout: 12000 })
      .then(function (r) {
        typing(false);
        if (r && r.sent) S.seen = Math.max(S.seen, r.sent.id);
        if (r && r.reply) {
          S.seen = Math.max(S.seen, r.reply.id);
          S.ss[now.id].m.push({ me: 0, t: r.reply.content });
          draw(); renderList(); save();
        }
      })
      .catch(function () { typing(false); toast("网络抖了一下，重发试试"); });
  };
  var origOpen = openChat;
  openChat = function (id) {
    var b = null;
    for (var i = 0; i < BOTS.length; i++) if (BOTS[i].id === id) { b = BOTS[i]; break; }
    if (!(ADAPTER.on && b && b.uuid && S.pm[id])) return origOpen(id);
    if (!S.ss[id]) S.ss[id] = { m: [], k: 0 };
    if (!S.ss[id].m.length) {
      var t = ice(b);
      S.ss[id].m.push({ me: 1, t: t }); save();   // 先入本地，origOpen 见非空就不会走本地剧本
      api("/api/messages", { method: "POST", body: { matchId: S.pm[id], senderId: S.pid, content: t }, timeout: 12000 })
        .then(function (r) {
          if (r && r.sent) S.seen = Math.max(S.seen, r.sent.id);
          if (r && r.reply) {
            S.seen = Math.max(S.seen, r.reply.id);
            S.ss[id].m.push({ me: 0, t: r.reply.content });
            if (now && now.id === id) draw();
            renderList(); save();
          }
        }).catch(function () {});
    }
    return origOpen(id);
  };

  /* ── 收件箱轮询：被翻牌提醒 + 跨设备消息 + 心跳 ── */
  function tick() {
    if (!ADAPTER.on || !S.pid) return;
    api("/api/inbox?profileId=" + encodeURIComponent(S.pid) + "&afterMsgId=" + S.seen, { timeout: 8000 })
      .then(function (r) {
        if (!r) return;
        var byMatch = {};
        if (S.ssBak) {
          Object.keys(S.ssBak).forEach(function (id) {
            if (S.pm[id]) {
              if (!S.ss[id] || !S.ss[id].m.length) S.ss[id] = S.ssBak[id];
              delete S.ssBak[id];
            }
          });
        }
        (r.matches || []).forEach(function (m) {
          var b = toPeer(m.partner);
          S.pm[b.id] = m.matchId;
          byMatch[m.matchId] = b;
          if (!m.iAmA && !S.pmSeen[m.matchId]) {
            S.pmSeen[m.matchId] = 1;
            if (!S.ss[b.id]) S.ss[b.id] = { m: [], k: 0 };
            toast("🎉 " + b.n + " 翻到了你的牌，来打个招呼");
            try { renderList(); } catch (e) {}
          }
        });
        (r.messages || []).forEach(function (msg) {
          if (msg.id <= S.seen) return;
          S.seen = Math.max(S.seen, msg.id);
          if (msg.sender_id === S.pid) return;
          var b = byMatch[msg.match_id]; if (!b) return;
          if (!S.ss[b.id]) S.ss[b.id] = { m: [], k: 0 };
          S.ss[b.id].m.push({ me: 0, t: msg.content });
          if (now && now.id === b.id) { try { draw(); } catch (e) {} }
          else toast(b.n + "：" + msg.content.slice(0, 18));
          try { renderList(); } catch (e) {}
        });
        save();
      }).catch(function () {});
  }

  /* ── 探活：/api/inbox 缺参会返回 400 json——只要能拿到 json 就说明后端在 ── */
  api("/api/inbox?profileId=ping", { timeout: 6000 })
    .then(function () { ADAPTER.on = true; })
    .catch(function (e) { ADAPTER.on = /profileId|invalid|uuid/i.test(String(e && e.message)) ; })
    .then(function () {
      if (!ADAPTER.on) return;
      setInterval(tick, 4000); tick();
      if (S.me && !S.pid) ensurePid().catch(function () {});
    });
})();
