# 游搭 YooDa

> 一句话，找到今晚的游戏搭子。

**🎮 在线 Demo：https://yooda.vercel.app** ｜ 📱 移动版：https://yooda.vercel.app/m

---

## 这是什么

下班想开黑——固定搭子今晚没空、微信群发「有人吗」没人回、小红书找搭子要翻 200 楼评论对暗号。游搭把这一切变成一句话：

> 「想找个女生一起玩三角洲，我打突击她打支援，最好声音好听点，现在就能上号」

LLM 解析你的需求 → 秒级**翻牌**一位搭子 → 卡片上写清「**为什么是 TA**」（游戏重合、位置互补、时段一致）→ 站内聊上就走，转战 KOOK / 游戏内语音开黑。

「游戏版 Soul」。不做陪玩、不做交易，只做匹配。第一站：**三角洲行动 + Steam 玩家**。

## 在线入口

| 入口 | 地址 |
|---|---|
| 桌面网页版（演示主入口） | https://yooda.vercel.app |
| 移动版 | https://yooda.vercel.app/m |
| 早期版本 V0.1（对照） | https://yooda.vercel.app/legacy/v0.1.html |

## 仓库导览

| 路径 | 内容 |
|---|---|
| `app/` | 现场演示原型（纯静态、离线可跑、无密钥）——**Vercel 部署目录**，文件映射见 `app/README.md` |
| `pitch/` | 发布会演示网页（cyber 黑客风、键盘翻页、GSAP 动效），本地打开 `pitch/index.html` 即用 |
| `docs/demo-plan.html` | 完整开发计划 v2——架构 / 数据模型 / API / LLM 规格 / 风险兜底，可直接投喂 AI 编码代理 |
| `docs/spec-v0.2.md` | 产品 SPEC V0.2 |
| `art-src/` | AI 生成的原始素材（31MB，不参与部署） |

## 技术栈

当前 `app/` 为纯前端离线原型。带后端的正式版按 `docs/demo-plan.html` 实施：

`Next.js 15` · `TypeScript` · `Tailwind` · `GSAP` · `Supabase (Postgres + Realtime)` · `DeepSeek API` · `Vercel`

## 协作流程

- 日常开发基于 `develop` 分支：从 `develop` 切出 `feat/{描述}` 或 `fix/{描述}` 分支，完成后合回 `develop`
- `main` 是发布分支，只通过 Pull Request 合入，不直接 push
- Commit message 格式：`type(scope): 描述`，例如 `feat(auth): 支持微信登录`、`fix(ui): 修复首页布局错位`

## 快速开始

```bash
git clone https://github.com/LiammingmingLiu/vibecoder-project.git
cd vibecoder-project
git checkout develop
open app/index.html        # 本地预览 demo（无需任何依赖）
open pitch/index.html      # 本地打开发布会演示页
```

部署（需 Vercel 权限）：`cd app && vercel deploy --prod`，然后确认别名指向 `yooda.vercel.app`。
