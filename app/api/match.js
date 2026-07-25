/* POST /api/match — 纯真人匹配：解析 + Top-N 重排（不建会话，打招呼见 /api/hello）*/
const { sb, deepseek, fallbackParse, pubProfile, blockedSet, authProfile, json, readBody } = require("./_lib");

const SYS = `你是游搭（游戏搭子匹配平台）的匹配引擎。输入：用户需求原话 + 候选人列表（全部是真人在线玩家）。
输出 json：{"parsed_tags":["解析出的标签，3-6个中文短词"],"ranking":[{"id":"候选人id","score":0-100,"line":"一句话推荐理由，≤22字"}],"top_reason_lines":["给排名第一的人写两到三行『为什么是TA』，每行≤40字"],"degraded":""}
规则：ranking 按匹配度从高到低给出全部候选人；硬条件优先（指定游戏、性别、声音），软条件其次（位置互补、时段重叠、风格）；理由第二人称、口语化、只引用真实标签；没有完全满足硬条件的人时选最接近并在 degraded 说明。只输出 json。`;

module.exports = async (req, res) => {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });
  try {
    const { user, profile: me } = await authProfile(req);
    if (!user) return json(res, 401, { error: "AUTH" });
    if (!me) return json(res, 403, { error: "NO_PROFILE" });
    const { text, excludeIds = [] } = await readBody(req);
    if (!text || !text.trim()) return json(res, 400, { error: "需求不能为空" });

    /* 候选：3 分钟内活跃的真人，排除自己/已排除/拉黑 */
    const blocked = await blockedSet(me.id);
    const notIn = [me.id, ...excludeIds, ...blocked].filter(Boolean);
    const cutoff = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    let q = `profiles?select=*&is_bot=eq.false&last_seen_at=gte.${encodeURIComponent(cutoff)}&order=last_seen_at.desc&limit=12`;
    if (notIn.length) q += `&id=not.in.(${notIn.map(encodeURIComponent).join(",")})`;
    const pool = await sb(q);

    /* 记录请求（无论结果） */
    sb("match_requests", {
      method: "POST", prefer: "return=minimal",
      body: JSON.stringify({ requester_id: me.id, raw_text: text.trim(), parsed: null, excluded_ids: excludeIds }),
    }).catch(() => {});

    if (!pool || !pool.length) {
      return json(res, 200, { empty: true, waiting: true });
    }

    const cands = pool.map(p => {
      const v = pubProfile(p);
      return { id: v.id, nickname: v.nickname, gender: v.gender, voice: v.voice_tag, game: v.game, role: v.role, rank: v.rank, style: v.play_style, time: v.time, intro: (v.intro || "").slice(0, 40) };
    });

    let out = null, dbg = "";
    try {
      out = await deepseek([
        { role: "system", content: SYS },
        { role: "user", content: JSON.stringify({ 需求原话: text.trim(), 候选人: cands }) },
      ], { temperature: 0.5, maxTokens: 900, timeoutMs: 12000 });
    } catch (e) { dbg = String(e.message || e).slice(0, 80); }

    /* 组装 ranking（LLM 失败 → 规则打分兜底，仍是真人池） */
    let ranking = [];
    if (out && Array.isArray(out.ranking)) {
      ranking = out.ranking.map(r => ({ p: pool.find(x => x.id === r.id), score: r.score, line: r.line }))
        .filter(r => r.p);
    }
    if (!ranking.length) {
      const f = fallbackParse(text);
      ranking = pool.map(p => {
        const v = pubProfile(p);
        let s = 40;
        if (f.games.includes(v.game)) s += 25;
        if (f.partner.gender !== "any" && v.gender === f.partner.gender) s += 15;
        if (f.partner.voice && f.partner.voice !== "好听" && v.voice_tag === f.partner.voice) s += 8;
        if (f.partner.voice === "好听" && ["甜妹音", "御姐音", "奶音"].includes(v.voice_tag)) s += 5;
        if (f.partner.style && v.play_style === f.partner.style) s += 6;
        if (f.partner.roles.length && f.partner.roles.some(r2 => v.role.includes(r2))) s += 10;
        return { p, score: Math.min(s, 96), line: `${v.game} · ${v.role}位，和你的需求接近` };
      }).sort((a, b) => b.score - a.score);
      out = out || {};
      out.parsed_tags = out.parsed_tags || (() => {
        const f2 = f;
        return [...f2.games, f2.partner.gender === "female" ? "找女生" : f2.partner.gender === "male" ? "找男生" : "", f2.partner.voice, f2.partner.style, f2.time !== "any" ? f2.time : ""].filter(Boolean).slice(0, 6);
      })();
    }

    const top = ranking[0];
    const topV = pubProfile(top.p);
    const reasonLines = (out.top_reason_lines && out.top_reason_lines.length)
      ? out.top_reason_lines
      : [`TA 主玩${topV.game}，${topV.role}位、${topV.play_style}路线，和你的需求对得上。`, `TA 现在在线，发个招呼就能聊上。`];

    return json(res, 200, {
      parsedTags: out.parsed_tags || [],
      top: { profile: topV, score: top.score || 90, reasonLines },
      candidates: ranking.map(r => ({ profile: pubProfile(r.p), score: r.score || 60, line: r.line || "" })),
      degraded: (out && out.degraded) || "",
      _dbg: dbg || undefined,
    });
  } catch (e) {
    return json(res, 500, { error: String(e.message || e).slice(0, 200) });
  }
};
