/* POST /api/match — 解析需求 + 候选预筛 + 重排出牌 + 落库（单次 DeepSeek 调用完成解析+重排）*/
const { sb, deepseek, fallbackParse, pubProfile, json, readBody } = require("./_lib");

const SYS = `你是游搭（游戏搭子匹配平台）的匹配引擎。输入：用户需求原话 + 候选人列表。
输出 json：{"parsed_tags":["解析出的标签，3-6个，中文短词"],"chosen_id":"候选人id","score":0-100,"reason_lines":["两到三行『为什么是TA』，每行≤40字"],"degraded":""}
规则：硬条件优先（指定游戏、性别、声音），软条件其次（位置互补、时段重叠、风格）；reason_lines 用第二人称、口语化、必须引用双方真实标签，禁止编造；
若没有完全满足硬条件的人，选最接近的，并在 degraded 字段用一句话如实说明降级（否则留空串）。只输出 json。`;

module.exports = async (req, res) => {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });
  try {
    const { profileId, text, excludeIds = [] } = await readBody(req);
    if (!text || !text.trim()) return json(res, 400, { error: "需求不能为空" });

    /* 预筛：排除自己与已出现的人；真人优先、活跃优先，取 14 个 */
    const notIn = [profileId, ...excludeIds].filter(Boolean);
    let q = "profiles?select=*&order=is_bot.asc,last_seen_at.desc&limit=14";
    if (notIn.length) q += `&id=not.in.(${notIn.map(encodeURIComponent).join(",")})`;
    /* 真人窗口：10 分钟内活跃的真人 + 全部 bot */
    const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    q += `&or=(is_bot.eq.true,last_seen_at.gte.${encodeURIComponent(cutoff)})`;
    const pool = await sb(q);
    if (!pool || !pool.length) return json(res, 200, { empty: true });

    const cands = pool.map(p => {
      const v = pubProfile(p);
      return { id: v.id, nickname: v.nickname, gender: v.gender, voice: v.voice_tag, game: v.game, role: v.role, rank: v.rank, style: v.play_style, time: v.time, real_person: !p.is_bot, intro: (v.intro || "").slice(0, 40) };
    });

    let out = null, degraded = "", dbg = "";
    try {
      out = await deepseek([
        { role: "system", content: SYS },
        { role: "user", content: JSON.stringify({ 需求原话: text.trim(), 候选人: cands }) },
      ], { temperature: 0.5, maxTokens: 600, timeoutMs: 12000 });
    } catch (e) { dbg = String(e.message || e).slice(0, 80); /* R2 兜底：规则匹配 + 模板理由 */ }

    let chosen = out && pool.find(p => p.id === out.chosen_id);
    if (!chosen) {
      const f = fallbackParse(text);
      const scored = pool.map(p => {
        const v = pubProfile(p);
        let s = 0;
        if (f.games.includes(v.game)) s += 8;
        if (f.partner.gender !== "any" && v.gender === f.partner.gender) s += 5;
        if (f.partner.voice && f.partner.voice !== "好听" && v.voice_tag === f.partner.voice) s += 3;
        if (f.partner.voice === "好听" && ["甜妹音", "御姐音", "奶音"].includes(v.voice_tag)) s += 2;
        if (f.partner.style && v.play_style === f.partner.style) s += 2;
        if (f.partner.roles.length && f.partner.roles.some(r => v.role.includes(r))) s += 4;
        if (!p.is_bot) s += 1.5;
        return { p, s };
      }).sort((a, b) => b.s - a.s);
      chosen = scored[0].p;
      const cv = pubProfile(chosen);
      out = {
        parsed_tags: [...f.games, f.partner.gender === "female" ? "找女生" : f.partner.gender === "male" ? "找男生" : "", f.partner.voice, f.partner.style, f.time !== "any" ? f.time : ""].filter(Boolean).slice(0, 6),
        score: 82,
        reason_lines: [`TA 主玩${cv.game}，${cv.role}位、${cv.play_style}路线，和你的需求对得上。`, `TA ${cv.time}在线，现在就能聊上。`],
        degraded: "（离线规则匹配）",
      };
      degraded = out.degraded;
    }

    /* 落库 */
    const reqRow = await sb("match_requests", {
      method: "POST",
      body: JSON.stringify({ requester_id: profileId || null, raw_text: text.trim(), parsed: { tags: out.parsed_tags }, excluded_ids: excludeIds }),
    });
    const m = await sb("matches", {
      method: "POST",
      body: JSON.stringify({ request_id: reqRow[0].id, user_a: profileId || null, user_b: chosen.id, reason: (out.reason_lines || []).join("\n"), score: out.score || null }),
    });

    return json(res, 200, {
      matchId: m[0].id,
      partner: pubProfile(chosen),
      parsedTags: out.parsed_tags || [],
      reasonLines: out.reason_lines || [],
      degraded: out.degraded || degraded || "",
      _dbg: dbg || undefined,
    });
  } catch (e) {
    return json(res, 500, { error: String(e.message || e).slice(0, 200) });
  }
};
