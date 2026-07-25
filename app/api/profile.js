/* GET  /api/profile — 取回我的画像（登录后恢复身份）
   POST /api/profile — 创建/更新画像（需登录）：NL 自我介绍 → DeepSeek 解析 → 按 auth_id 落库 */
const { sb, deepseek, fallbackParse, pubProfile, authUser, json, readBody } = require("./_lib");

const SYS = `你是游搭平台的资料解析器。把用户的中文自我介绍解析为 json，字段：
{"games":[{"name":"游戏名","roles":["位置"],"rank":"段位或—"}],"gender":"male|female|secret","voice_tag":"低音炮|少年音|御姐音|甜妹音|奶音|不开麦|","play_style":"激进|稳健|娱乐|","active_hours":["下午|晚间|深夜|周末"],"mbti":"XXXX或空"}
游戏名归一化词表：三角洲行动、无畏契约、CS2、PUBG、Apex英雄、使命召唤：战区、战地6、彩虹六号、方舟：生存进化、Horizons Awakening、Novastone Legends。
段位（青铜/白银/黄金/铂金/钻石/大师等）写进对应 games[].rank。没提到的字段给空串/空数组/"—"，不要脑补。只输出 json。`;

module.exports = async (req, res) => {
  try {
    const u = await authUser(req);
    if (!u) return json(res, 401, { error: "请先登录" });
    const uid = u.id;

    if (req.method === "GET") {
      const rows = await sb(`profiles?auth_id=eq.${encodeURIComponent(uid)}&select=*&limit=1`);
      const p = rows && rows[0];
      return json(res, 200, { profile: p ? { ...pubProfile(p), rawIntro: p.intro, email: u.email } : null });
    }
    if (req.method !== "POST") return json(res, 405, { error: "GET/POST only" });

    const { nickname, rawIntro } = await readBody(req);
    if (!nickname || nickname.trim().length < 2) return json(res, 400, { error: "昵称至少 2 个字" });

    let parsed = null, degraded = false;
    if (rawIntro && rawIntro.trim()) {
      try {
        parsed = await deepseek(
          [{ role: "system", content: SYS }, { role: "user", content: rawIntro.trim() }],
          { temperature: 0.2, timeoutMs: 8000 }
        );
      } catch (e) {
        degraded = true;
        const f = fallbackParse(rawIntro);
        parsed = {
          games: f.games.map(n => ({ name: n, roles: f.my_roles, rank: "—" })),
          gender: "secret", voice_tag: f.partner.voice === "好听" ? "" : f.partner.voice,
          play_style: f.partner.style, active_hours: f.time === "any" ? [] : [f.time], mbti: "",
        };
      }
    }
    const row = {
      auth_id: uid,
      nickname: nickname.trim().slice(0, 12),
      gender: parsed?.gender || "secret",
      voice_tag: parsed?.voice_tag || null,
      games: parsed?.games || [],
      play_style: parsed?.play_style || null,
      active_hours: parsed?.active_hours || [],
      mbti: parsed?.mbti || null,
      intro: (rawIntro || "").trim(),
      is_bot: false,
      last_seen_at: new Date().toISOString(),
    };
    let saved = (await sb(`profiles?auth_id=eq.${encodeURIComponent(uid)}`, {
      method: "PATCH", prefer: "return=representation", body: JSON.stringify(row),
    }) || [])[0];
    if (!saved) saved = (await sb("profiles", { method: "POST", body: JSON.stringify(row) }))[0];
    return json(res, 200, { profile: { ...pubProfile(saved), rawIntro: saved.intro, email: u.email }, degraded });
  } catch (e) {
    return json(res, 500, { error: String(e.message || e).slice(0, 200) });
  }
};
