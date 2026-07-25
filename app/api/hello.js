/* POST /api/hello — 打招呼：此刻才建立会话（同一对人永远只有一个会话），并发出第一条消息 */
const { sb, authProfile, pubProfile, json, readBody } = require("./_lib");

module.exports = async (req, res) => {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });
  try {
    const { profile: me } = await authProfile(req);
    if (!me) return json(res, 401, { error: "请先登录" });
    const { targetId, text } = await readBody(req);
    if (!targetId || targetId === me.id) return json(res, 400, { error: "目标不合法" });

    /* 拉黑双向禁止 */
    const blk = await sb(`blocks?or=(and(blocker.eq.${me.id},blocked.eq.${targetId}),and(blocker.eq.${targetId},blocked.eq.${me.id}))&select=blocker&limit=1`);
    if (blk && blk.length) return json(res, 403, { error: "无法与该用户建立会话" });

    /* 归一化对：撞车/重复打招呼复用同一会话 */
    let m = null;
    try {
      m = (await sb("matches", {
        method: "POST",
        body: JSON.stringify({ user_a: me.id, user_b: targetId, reason: "", last_msg_at: new Date().toISOString() }),
      }))[0];
    } catch (e) {
      if (e.status === 409) {
        m = (await sb(`matches?or=(and(user_a.eq.${me.id},user_b.eq.${targetId}),and(user_a.eq.${targetId},user_b.eq.${me.id}))&limit=1`))[0];
      } else throw e;
    }
    if (!m) return json(res, 500, { error: "会话创建失败" });

    /* 我这侧若曾删除，重新打招呼即复活我这侧 */
    const iAmA = m.user_a === me.id;
    const revive = {};
    if (iAmA && m.a_deleted) revive.a_deleted = false;
    if (!iAmA && m.b_deleted) revive.b_deleted = false;

    const first = (text || "在吗？一起来一把？").trim().slice(0, 500);
    const msg = (await sb("messages", {
      method: "POST",
      body: JSON.stringify({ match_id: m.id, sender_id: me.id, content: first }),
    }))[0];

    await sb(`matches?id=eq.${m.id}`, {
      method: "PATCH", prefer: "return=minimal",
      body: JSON.stringify({ ...revive, last_msg_at: new Date().toISOString(), [iAmA ? "a_read_id" : "b_read_id"]: msg.id }),
    });

    const peer = (await sb(`profiles?id=eq.${targetId}&select=*`))[0];
    return json(res, 200, { matchId: m.id, message: msg, partner: peer ? pubProfile(peer) : null });
  } catch (e) {
    return json(res, 500, { error: String(e.message || e).slice(0, 200) });
  }
};
