/* 游搭 YooDa · 服务端公共库（零依赖，Vercel Node Functions）v3 */
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SB_ANON = process.env.SUPABASE_ANON_KEY;
const DS_KEY = process.env.DEEPSEEK_API_KEY;

/* ── Supabase PostgREST（service role，绕过 RLS）── */
async function sb(path, opts = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      Prefer: opts.method === "POST" ? (opts.prefer || "return=representation") : (opts.prefer || ""),
      ...(opts.headers || {}),
    },
  });
  if (!r.ok) {
    const body = (await r.text()).slice(0, 300);
    const err = new Error(`supabase ${r.status}: ${body}`);
    err.status = r.status; err.body = body;
    throw err;
  }
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

/* ── 认证：Bearer JWT → auth 用户；再拿业务 profile ── */
async function authUser(req) {
  const h = req.headers["authorization"] || "";
  const jwt = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!jwt) return null;
  const r = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { apikey: SB_ANON, Authorization: `Bearer ${jwt}` },
  });
  if (!r.ok) return null;
  return r.json(); // {id, email, ...}
}
async function authProfile(req) {
  const u = await authUser(req);
  if (!u) return { user: null, profile: null };
  const rows = await sb(`profiles?auth_id=eq.${encodeURIComponent(u.id)}&select=*&limit=1`);
  return { user: u, profile: (rows && rows[0]) || null };
}

/* ── DeepSeek（OpenAI 兼容）── */
async function deepseek(messages, { json = true, temperature = 0.2, maxTokens = 1024, timeoutMs = 6500, model = "deepseek-v4-flash" } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      signal: ctl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${DS_KEY}` },
      body: JSON.stringify({
        model, temperature, max_tokens: maxTokens,
        ...(json ? { response_format: { type: "json_object" } } : {}),
        messages,
      }),
    });
    if (!r.ok) throw new Error(`deepseek ${r.status} ${(await r.text()).slice(0, 160)}`);
    const d = await r.json();
    const c = d.choices?.[0]?.message?.content || "";
    return json ? JSON.parse(c) : c;
  } finally { clearTimeout(t); }
}

/* ── 词表与正则兜底解析 ── */
const GAME_WORDS = [
  ["三角洲行动", /三角洲|delta/i], ["无畏契约", /无畏|瓦(?![斯])|valorant/i], ["CS2", /cs2?|反恐/i],
  ["PUBG", /pubg|绝地|吃鸡/i], ["Apex英雄", /apex/i], ["使命召唤：战区", /战区|使命召唤|cod/i],
  ["战地6", /战地/i], ["彩虹六号", /彩虹六|r6/i], ["方舟：生存进化", /方舟|ark/i],
  ["Horizons Awakening", /horizons?/i], ["Novastone Legends", /novastone/i],
];
const VOICES = ["低音炮", "少年音", "御姐音", "甜妹音", "奶音", "不开麦"];
function fallbackParse(text) {
  const games = GAME_WORDS.filter(([, re]) => re.test(text)).map(([n]) => n);
  const gender = /女生|女搭子|小姐姐|妹子/.test(text) ? "female" : /男生|老哥|大哥|兄弟/.test(text) ? "male" : "any";
  const voice = VOICES.find(v => text.includes(v)) || (/声音好听|好听点/.test(text) ? "好听" : "");
  const style = /激进|猛|刚枪|莽|冲/.test(text) ? "激进" : /稳健|稳|苟|发育/.test(text) ? "稳健" : /娱乐|佛系|摸鱼|图个乐|随便/.test(text) ? "娱乐" : "";
  const time = /现在|马上|就能上/.test(text) ? "现在" : /今晚|晚上|下班/.test(text) ? "晚间" : /深夜|凌晨|半夜/.test(text) ? "深夜" : /周末/.test(text) ? "周末" : "";
  const roleM = text.match(/打?(突击|支援|侦察|工程|狙击|突破|指挥|治疗|辅助|决斗|控场|哨位)(位|手|兵)?/g) || [];
  return {
    games, my_roles: roleM.slice(0, 1).map(s => s.replace(/^打/, "").replace(/[位手兵]$/, "")),
    partner: { gender, roles: roleM.slice(1, 2).map(s => s.replace(/^打/, "").replace(/[位手兵]$/, "")), voice, style },
    time: time || "any", mode: games.length || gender !== "any" || voice || style ? "specific" : "random",
  };
}

/* ── 在线状态分档：on(<20s) / warm(<3min) / off ── */
function statusOf(lastSeen) {
  const dt = Date.now() - new Date(lastSeen || 0).getTime();
  return dt < 20000 ? "on" : dt < 180000 ? "warm" : "off";
}

/* ── profile 行 → 前端展示形状 ── */
function pubProfile(p) {
  const g0 = (p.games && p.games[0]) || {};
  return {
    id: p.id, nickname: p.nickname, gender: p.gender, voice_tag: p.voice_tag,
    games: p.games || [], game: g0.name || "三角洲行动", role: (g0.roles || [])[0] || "自由人",
    rank: g0.rank || "—", play_style: p.play_style || "稳健",
    time: (p.active_hours || [])[0] || "晚间", mbti: p.mbti, intro: p.intro || "",
    status: statusOf(p.last_seen_at),
  };
}

/* ── 拉黑集合（双向）── */
async function blockedSet(pid) {
  const rows = await sb(`blocks?or=(blocker.eq.${pid},blocked.eq.${pid})&select=blocker,blocked`);
  const s = new Set();
  (rows || []).forEach(b => { s.add(b.blocker === pid ? b.blocked : b.blocker); });
  return s;
}

function json(res, code, obj) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}
async function readBody(req) {
  if (req.body) return typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

module.exports = { sb, deepseek, fallbackParse, pubProfile, statusOf, blockedSet, authUser, authProfile, json, readBody };
