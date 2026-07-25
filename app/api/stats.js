/* GET /api/stats — 公开统计：真人在线数 / 注册玩家数（首页真实数字用） */
const { sb, json } = require("./_lib");

module.exports = async (req, res) => {
  try {
    const cutoff = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const online = await sb(`profiles?select=id&is_bot=eq.false&last_seen_at=gte.${encodeURIComponent(cutoff)}&limit=1000`);
    const total = await sb(`profiles?select=id&is_bot=eq.false&limit=1`, {
      prefer: "count=exact", headers: { Range: "0-0", "Range-Unit": "items", Prefer: "count=exact" },
    }).catch(() => null);
    /* count 走 content-range 不好拿，退化为直接数（≤5000 足够现阶段） */
    const all = await sb(`profiles?select=id&is_bot=eq.false&limit=5000`);
    return json(res, 200, { online: (online || []).length, players: (all || []).length });
  } catch (e) {
    return json(res, 500, { error: String(e.message || e).slice(0, 200) });
  }
};
