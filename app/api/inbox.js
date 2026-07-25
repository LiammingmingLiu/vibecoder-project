/* GET /api/inbox?afterMsgId=0 — 心跳 + 我的会话列表（按最新消息排序，含状态/未读/预览）+ 增量消息 */
const { sb, authProfile, pubProfile, statusOf, json } = require("./_lib");

module.exports = async (req, res) => {
  try {
    const { user, profile: me } = await authProfile(req);
    if (!user) return json(res, 401, { error: "AUTH" });
    if (!me) return json(res, 403, { error: "NO_PROFILE" });
    const pid = me.id;
    const u = new URL(req.url, "http://x");
    const afterMsgId = parseInt(u.searchParams.get("afterMsgId") || "0", 10);

    /* 心跳 */
    sb(`profiles?id=eq.${pid}`, { method: "PATCH", prefer: "return=minimal", body: JSON.stringify({ last_seen_at: new Date().toISOString() }) }).catch(() => {});

    const ms = await sb(`matches?or=(user_a.eq.${pid},user_b.eq.${pid})&order=last_msg_at.desc&limit=50&select=id,user_a,user_b,a_deleted,b_deleted,a_read_id,b_read_id,last_msg_at,messages(id,sender_id,content,created_at)&messages.order=id.desc&messages.limit=1`);
    const mine = (ms || []).filter(m => !(m.user_a === pid ? m.a_deleted : m.b_deleted));

    const peerIds = [...new Set(mine.map(m => (m.user_a === pid ? m.user_b : m.user_a)).filter(Boolean))];
    let peers = [];
    if (peerIds.length) peers = await sb(`profiles?id=in.(${peerIds.map(encodeURIComponent).join(",")})&select=*`);
    const pmap = Object.fromEntries(peers.map(p => [p.id, p]));

    const matches = mine.map(m => {
      const iAmA = m.user_a === pid;
      const peerRow = pmap[iAmA ? m.user_b : m.user_a];
      if (!peerRow) return null;
      const last = (m.messages && m.messages[0]) || null;
      const myRead = iAmA ? m.a_read_id : m.b_read_id;
      return {
        matchId: m.id,
        partner: pubProfile(peerRow),
        status: statusOf(peerRow.last_seen_at),
        last: last ? { id: last.id, text: last.content, mine: last.sender_id === pid, at: last.created_at } : null,
        unread: !!(last && last.id > (myRead || 0) && last.sender_id !== pid),
        last_msg_at: m.last_msg_at,
      };
    }).filter(Boolean);

    let messages = [];
    if (mine.length) {
      const mids = mine.map(m => encodeURIComponent(m.id)).join(",");
      messages = await sb(`messages?match_id=in.(${mids})&id=gt.${afterMsgId}&order=id.asc&limit=200&select=id,match_id,sender_id,content,created_at`);
    }

    /* 全站真人在线数（3 分钟活跃口径） */
    const cutoff = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const onlineRows = await sb(`profiles?select=id&is_bot=eq.false&last_seen_at=gte.${encodeURIComponent(cutoff)}&limit=500`);

    return json(res, 200, { matches, messages, online: (onlineRows || []).length, me: pid, now: Date.now() });
  } catch (e) {
    return json(res, 500, { error: String(e.message || e).slice(0, 200) });
  }
};
