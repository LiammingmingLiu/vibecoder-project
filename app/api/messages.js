/* GET  /api/messages?matchId=&afterId=0 — 拉取消息（须为会话成员）
   POST /api/messages {matchId, content} — 发送消息 */
const { sb, authProfile, json, readBody } = require("./_lib");

async function memberMatch(matchId, pid) {
  const m = (await sb(`matches?id=eq.${encodeURIComponent(matchId)}&select=id,user_a,user_b,a_read_id,b_read_id`))[0];
  if (!m || (m.user_a !== pid && m.user_b !== pid)) return null;
  return m;
}

module.exports = async (req, res) => {
  try {
    const { user, profile: me } = await authProfile(req);
    if (!user) return json(res, 401, { error: "AUTH" });
    if (!me) return json(res, 403, { error: "NO_PROFILE" });

    if (req.method === "GET") {
      const u = new URL(req.url, "http://x");
      const matchId = u.searchParams.get("matchId");
      const afterId = parseInt(u.searchParams.get("afterId") || "0", 10);
      const m = await memberMatch(matchId, me.id);
      if (!m) return json(res, 403, { error: "不在会话中" });
      const msgs = await sb(`messages?match_id=eq.${encodeURIComponent(matchId)}&id=gt.${afterId}&order=id.asc&limit=200&select=id,sender_id,content,created_at`);
      return json(res, 200, { messages: msgs });
    }
    if (req.method !== "POST") return json(res, 405, { error: "GET/POST only" });

    const { matchId, content } = await readBody(req);
    if (!matchId || !content || !content.trim()) return json(res, 400, { error: "参数不全" });
    const m = await memberMatch(matchId, me.id);
    if (!m) return json(res, 403, { error: "不在会话中" });

    const msg = (await sb("messages", {
      method: "POST",
      body: JSON.stringify({ match_id: matchId, sender_id: me.id, content: content.trim().slice(0, 500) }),
    }))[0];
    const iAmA = m.user_a === me.id;
    await sb(`matches?id=eq.${m.id}`, {
      method: "PATCH", prefer: "return=minimal",
      body: JSON.stringify({ last_msg_at: new Date().toISOString(), [iAmA ? "a_read_id" : "b_read_id"]: msg.id }),
    });
    return json(res, 200, { sent: msg });
  } catch (e) {
    return json(res, 500, { error: String(e.message || e).slice(0, 200) });
  }
};
