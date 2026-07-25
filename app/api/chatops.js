/* POST /api/chatops — 会话操作三合一：{op:"read"|"delete"|"block", matchId?, lastId?, targetId?} */
const { sb, authProfile, json, readBody } = require("./_lib");

module.exports = async (req, res) => {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });
  try {
    const { user, profile: me } = await authProfile(req);
    if (!user) return json(res, 401, { error: "AUTH" });
    if (!me) return json(res, 403, { error: "NO_PROFILE" });
    const { op, matchId, lastId, targetId } = await readBody(req);

    if (op === "read" || op === "delete") {
      const m = (await sb(`matches?id=eq.${encodeURIComponent(matchId)}&select=id,user_a,user_b`))[0];
      if (!m || (m.user_a !== me.id && m.user_b !== me.id)) return json(res, 403, { error: "不在会话中" });
      const iAmA = m.user_a === me.id;
      const patch = op === "read"
        ? { [iAmA ? "a_read_id" : "b_read_id"]: parseInt(lastId || "0", 10) }
        : { [iAmA ? "a_deleted" : "b_deleted"]: true };
      await sb(`matches?id=eq.${m.id}`, { method: "PATCH", prefer: "return=minimal", body: JSON.stringify(patch) });
      return json(res, 200, { ok: true });
    }

    if (op === "block") {
      if (!targetId || targetId === me.id) return json(res, 400, { error: "目标不合法" });
      try {
        await sb("blocks", { method: "POST", prefer: "return=minimal", body: JSON.stringify({ blocker: me.id, blocked: targetId }) });
      } catch (e) { if (e.status !== 409) throw e; }
      /* 同时把与 TA 的会话从我这侧删除 */
      const ms = await sb(`matches?or=(and(user_a.eq.${me.id},user_b.eq.${targetId}),and(user_a.eq.${targetId},user_b.eq.${me.id}))&select=id,user_a`);
      for (const m of ms || []) {
        const iAmA = m.user_a === me.id;
        await sb(`matches?id=eq.${m.id}`, { method: "PATCH", prefer: "return=minimal", body: JSON.stringify({ [iAmA ? "a_deleted" : "b_deleted"]: true }) });
      }
      return json(res, 200, { ok: true });
    }
    return json(res, 400, { error: "未知操作" });
  } catch (e) {
    return json(res, 500, { error: String(e.message || e).slice(0, 200) });
  }
};
