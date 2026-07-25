/* GET  /api/messages?matchId=&afterId=0 — 拉取消息
   POST /api/messages {matchId, senderId, content} — 发送；对端是 bot 时由 DeepSeek 按人设即时回复 */
const { sb, deepseek, pubProfile, json, readBody } = require("./_lib");

module.exports = async (req, res) => {
  try {
    if (req.method === "GET") {
      const u = new URL(req.url, "http://x");
      const matchId = u.searchParams.get("matchId");
      const afterId = parseInt(u.searchParams.get("afterId") || "0", 10);
      if (!matchId) return json(res, 400, { error: "matchId required" });
      const msgs = await sb(`messages?match_id=eq.${encodeURIComponent(matchId)}&id=gt.${afterId}&order=id.asc&limit=100&select=id,sender_id,content,created_at`);
      return json(res, 200, { messages: msgs });
    }
    if (req.method !== "POST") return json(res, 405, { error: "GET/POST only" });

    const { matchId, senderId, content } = await readBody(req);
    if (!matchId || !senderId || !content || !content.trim()) return json(res, 400, { error: "参数不全" });

    const ins = await sb("messages", {
      method: "POST",
      body: JSON.stringify({ match_id: matchId, sender_id: senderId, content: content.trim().slice(0, 500) }),
    });

    /* 对端是 bot → 生成人设回复（DeepSeek 延迟即拟人延迟） */
    let reply = null;
    const m = (await sb(`matches?id=eq.${encodeURIComponent(matchId)}&select=user_a,user_b`))[0];
    if (m) {
      const peerId = m.user_a === senderId ? m.user_b : m.user_a;
      if (peerId) {
        const peer = (await sb(`profiles?id=eq.${encodeURIComponent(peerId)}&select=*`))[0];
        if (peer && peer.is_bot) {
          const hist = await sb(`messages?match_id=eq.${encodeURIComponent(matchId)}&order=id.desc&limit=10&select=sender_id,content`);
          const bm = peer.bot_meta || {};
          const v = pubProfile(peer);
          const SYS = `你在游搭平台和刚匹配到的搭子闲聊。你的人设：昵称「${v.nickname}」，${v.game}玩家（${v.role}位/${v.rank}），${v.play_style}打法，声音${v.voice_tag || "普通"}，${v.time}在线。自我介绍：「${v.intro}」。
你的游戏ID：${bm.gid || "游搭#0000"}；你的 KOOK 房号：${bm.room || "888888"}。
规则：中文口语，每次只回一句、不超过40字，偶尔用游戏黑话；目标是把话题引向约一局游戏、交换游戏ID或KOOK房号；对方问"上号/开一把"就给KOOK房号，问"ID/加好友"就给游戏ID；不主动谈论自己的身份问题，被追问是不是AI就幽默带过并把话题拉回开黑；不聊越界话题。`;
          const msgs = hist.reverse().map(h => ({ role: h.sender_id === peerId ? "assistant" : "user", content: h.content }));
          try {
            const txt = await deepseek([{ role: "system", content: SYS }, ...msgs], { json: false, temperature: 1.3, maxTokens: 120, timeoutMs: 6000 });
            const clean = (txt || "").trim().slice(0, 120);
            if (clean) {
              const rIns = await sb("messages", {
                method: "POST",
                body: JSON.stringify({ match_id: matchId, sender_id: peerId, content: clean }),
              });
              reply = rIns[0];
            }
          } catch (e) {
            const canned = (bm.canned || ["在的在的，上号吗？"]);
            const rIns = await sb("messages", {
              method: "POST",
              body: JSON.stringify({ match_id: matchId, sender_id: peerId, content: canned[Math.floor(Math.random() * canned.length)] }),
            });
            reply = rIns[0];
          }
        }
      }
    }
    return json(res, 200, { sent: ins[0], reply });
  } catch (e) {
    return json(res, 500, { error: String(e.message || e).slice(0, 200) });
  }
};
