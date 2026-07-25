/* GET /api/inbox?profileId=&afterMsgId=0 — 心跳 + 我的全部匹配（含对方画像）+ 新到消息 */
const { sb, pubProfile, json } = require("./_lib");

module.exports = async (req, res) => {
  try {
    const u = new URL(req.url, "http://x");
    const pid = u.searchParams.get("profileId");
    const afterMsgId = parseInt(u.searchParams.get("afterMsgId") || "0", 10);
    if (!pid) return json(res, 400, { error: "profileId required" });
    const eid = encodeURIComponent(pid);

    /* 心跳（不阻塞主流程） */
    sb(`profiles?id=eq.${eid}`, { method: "PATCH", body: JSON.stringify({ last_seen_at: new Date().toISOString() }) }).catch(() => {});

    const ms = await sb(`matches?or=(user_a.eq.${eid},user_b.eq.${eid})&order=created_at.desc&limit=40&select=id,user_a,user_b,reason,created_at`);
    const peerIds = [...new Set(ms.map(m => (m.user_a === pid ? m.user_b : m.user_a)).filter(Boolean))];
    let peers = [];
    if (peerIds.length) {
      peers = await sb(`profiles?id=in.(${peerIds.map(encodeURIComponent).join(",")})&select=*`);
    }
    const pmap = Object.fromEntries(peers.map(p => [p.id, pubProfile(p)]));
    const matches = ms.map(m => ({
      matchId: m.id,
      partner: pmap[m.user_a === pid ? m.user_b : m.user_a] || null,
      iAmA: m.user_a === pid,
      reason: m.reason, created_at: m.created_at,
    })).filter(m => m.partner);

    let messages = [];
    if (ms.length) {
      const mids = ms.map(m => encodeURIComponent(m.id)).join(",");
      messages = await sb(`messages?match_id=in.(${mids})&id=gt.${afterMsgId}&order=id.asc&limit=200&select=id,match_id,sender_id,content,created_at`);
    }
    return json(res, 200, { matches, messages, now: Date.now() });
  } catch (e) {
    return json(res, 500, { error: String(e.message || e).slice(0, 200) });
  }
};
