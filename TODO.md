# 开发 TODO 清单

## 📣 发帖引流前清单（用户 2026-06-11 提出 · 已与代码比对）
> 来源：用户手写清单 A–I。每条附 Claude 的实际代码核实结论。优先级沿用用户标注（🔴 发帖前必做 / 🟡 重要 / 🟢 分析纪律）。

- [x] **A · DeepSeek key 是否暴露在前端** 🔴 —— ✅ 已核查通过：key 仅在 lib/llmClient.ts（服务端），只被 3 个 API 路由 import；无 NEXT_PUBLIC_ 前缀、无硬编码；用真实 key 反查生产客户端 bundle（.next/static）零命中。**安全，无需改动。**（提醒：Vercel 的 DEEPSEEK_API_KEY 也须为普通变量）

### 🔴 发帖前必做
- [x] **B · 追问疲劳软化（方案 2️⃣ + 2a）** ✅ 已实现（v0.10.0，含品牌营销 persona 真实 API 验证）—— 用户答不上来时，让**下一轮追问**自动变软（教学式引导），而非提交前拦截、也非强按回原题。真面试官式的进退。
  - **触发信号**：前端把上一轮回答的非空字符数 `lastAnswerLen` 传给 `/api/generate-followup`；阈值 `30`（真实数据"塌缩尾巴"为 {12,12,37}，30 抓到 12/12 放过 37/48+，误伤低）
  - **LLM 三个决策全部在追问 prompt 里**（不加新路由、不改状态机）：① 上轮 <30 → **倾向继续追问**（2a：给"接得住"的机会）；② 下一问的题干**主动降级**——语气考察→引导、换更具体好接的角度、题干里给 1–2 个方向作脚手架；③ 硬上限每主题 3 次追问不变
  - **自校准埋点**：`followup_triggered` props 加 `wasSoftened: boolean`（前端按同一条件 `lastAnswerLen<30` 判断，与 LLM 侧同源）；不新增事件
  - **文件**：`api/generate-followup/route.ts`（Zod 加 `lastAnswerLen: number.optional()`；SYSTEM_PROMPT 嵌软化规则；lastAnswerLen 进 userMessage）+ `InterviewStep.tsx`（`runFollowUpJudgment` 算 lastAnswerLen 并进 fetch body）
- [x] **C · 反馈生成 25s 干等** ✅ 已实现（v0.11.0）—— 决策：**②进度提示 + ③首份优先**（不做真流式，因反馈是需完整校验的 JSON）。反馈页默认落 Q1 Tab（~24s 先出内容，汇总一键可达）；生成中骨架屏换成 EvaluatingPanel（转圈 + 轮换阶段文案 + 诚实预期"每题约 20–30 秒" + 真实 doneCount/total 进度条）。零后端改动
- [x] **E · 不建墙，改打真人/机器人标记** ✅ 已实现（v0.11.0）—— 决策：邀请墙劝退新用户，不建；改为埋点区分真假访问。新增 `first_interaction` 事件（首次真实手势触发一次）＝真人黄金信号；`landed` 加 `webdriver` 字段。Supabase 里 `有 landed 无 first_interaction ≈ 机器人`

### 🟡 重要（发帖前后）
- [ ] **D · "开口说话"埋点** —— 新增 `mic_permission_granted`，捕捉 interview_started 之后、首条 answer_submitted 之前（麦克风授权）的流失。（原 `first_recording_started` 已取消——I 的真人信号改用更早、更普适的 `first_interaction`，v0.11.0 已落地）
- [x] **F · 题库/生成器岗位通用性** ✅ 已实现（v0.10.0，含品牌营销 persona 真实 API 验证）—— **② 全改 + ① 轻改，不对称处理**（不做双 persona demo）。理由：生成器出戏＝反馈时刻的信任摧毁+公开差评（最贵）；demo 出戏＝零投入的首印象流失（便宜，已有"仅供预览"横幅缓冲）。
  - **② 全改（约 1–2h）· 面试官人设与出题/评分改为岗位自适应**（技术偏向贯穿 4 处，需一并改）：
    - `generate-questions` SYSTEM_PROMPT：「资深**技术**面试官」→「资深面试官（按 JD 判断岗位方向）」；删掉硬编码「第 2 题：系统设计或技术深度」，改为「按该岗位核心能力出题」。**三个 prompt 都加兜底**：如无法从 JD 判断岗位方向，就按通用面试官路线出题，避免技术假设
    - `generate-followup` SYSTEM_PROMPT：追问标准里「技术选型理由 / 技术知识盲区」→ 泛化为「该岗位关键能力的深度与证据」
    - `generate-feedback` SYSTEM_PROMPT：「资深**技术**面试官」+ 维度定义 `technicalDepth`「技术细节充分程度」→ 泛化为「该岗位核心专业能力的深度」
    - UI 维度标签：`types/interview.ts` 的 `DIMENSION_LABELS.technicalDepth`「技术深度」→「**专业深度**」。⚠️ **内部字段 key `technicalDepth` 保持不动**——零 Zod/schema 破坏、无数据迁移；PDF 报告与雷达图走 DIMENSION_LABELS 自动更新
  - **① 轻改（约 10min）· demo 横幅加一句预期管理**（不把示例题改通用，以免掩杀"题目为简历定制"这个核心卖点）：
    - 文案：「以上为虚拟技术岗候选人的演示——上传你自己的简历后，题目将完全围绕你的背景生成」
    - 位置：InterviewStep 的示例数据横幅处（demo 模式）
  - **暂不做**：双 persona demo（技术+非技术两套示例）——投入产出比低，待内测数据显示 demo 路径流失严重再议
- [ ] **G · 发帖前验证流程** —— 无痕浏览器走 landed→app_viewed→input_completed；手机真机点 xhs 那条链接；回 Supabase 确认 src 正确入库（与 v0.9.2 待验证项重合）
  - [ ] ⚠️ **亲自测反馈页加载优化（v0.11.0，本次未做可视验证）**：完整跑一次真面试到反馈页，确认 ① 默认落在 Q1 Tab（非汇总）② 生成中显示 EvaluatingPanel（转圈+阶段文案+"每题约 20–30 秒"+真实进度条）③ Q1 约 24s 先出内容、汇总一键可达。顺带确认点击后 Supabase 多出一条 `first_interaction`
- [ ] **H · 推广文案预期管理** —— 文案写明"准备 30–40 分钟、找个能出声的地方"（净面试约 26 分钟）。降跳出 + 对应 ab51ebf5 首次失败原因（开麦环境没准备好）

### 🟢 分析纪律（非代码待办，写 SQL 时的习惯）
- [ ] **I · 漏斗去噪口径** —— 所有漏斗数字先排除"无真实互动"的会话；真实互动信号＝ `first_interaction`（v0.11.0 已埋，无需再等 D）。典型过滤：`有 landed 无 first_interaction`（且 `webdriver=true`）= 机器人，从转化率分母剔除

## 🚀 内测前清单（Pre-Beta）— 当前焦点
> 资深 PM 判断（2026-06-09）：核心闭环稳固、已上线、有数据闭环、移动端可用、隐私表述诚实——
> **基本具备小范围内测条件**。但发布前需先清掉几个"会误导真实用户 / 污染内测数据"的问题（约 1–2 小时）。

### P0 · 发布前必做（否则污染数据或误导用户）✅ 已完成（v0.8.1，生产构建已验证）
- [x] 生产环境隐藏 DEMO 跳转条 —— 改为仅 `NODE_ENV !== "production"` 时渲染
- [x] 处理 Header 占位元素 —— 移除无效「教程」按钮 + 假头像「Z」，Header 现为 Logo + 步骤条
- [x] 明确语音/浏览器支持预期 —— 首屏徽章替换为"语音作答建议使用 Chrome 桌面端（其他浏览器可改用键盘输入）"

### P1 · 强烈建议（发布前或内测首日）✅ 已完成（v0.8.2，生产构建已验证）
- [x] 最小新手引导 —— 面试首题顶部一行提示（点麦克风 · 会追问最多 3 次 · 可手动改文字），答题后自动消失
- [x] API 路由基础防滥用 —— lib/rateLimit 按 IP 内存限流（3 个 LLM 路由共享 40/min，track 200/min），429 + Retry-After。serverless 为尽力而为，公开上线再换 Upstash/KV
- [x] 隐私政策 / 数据用途简述 —— 新建 /privacy 页（简历不留存 / 音频不录制 / 匿名统计 / 无账号 / 不用于训练），输入页隐私条已链接

### 模型迁移 Claude → DeepSeek（v0.9.0）🔄 待实测
- [x] 改用 DeepSeek 的 Anthropic 兼容端点（保留 @anthropic-ai/sdk，只换 baseURL/key/模型名）
- [x] 模型路由：出题 v4-flash 非思考 / 追问 v4-flash 思考 / 反馈 v4-pro 非思考
- [x] 新增 lib/llmClient.ts；models.ts 重写；followup max_tokens→4096；移除失效的 cache_control
- [x] .env.example + CLAUDE.md 同步
- [ ] **用户侧**：① frontend/.env.local 加 DEEPSEEK_API_KEY（删 ANTHROPIC_API_KEY 依赖）② Vercel 配 DEEPSEEK_API_KEY ③ 设 spend limit
- [x] **实测验证**：本地实测出题 ✓ + 追问链（思考模式）✓（埋点确认 06-10 晚 Q1×3 追问 + Q2 追问均正常）；反馈路径（v4-pro）待完整跑一遍确认
- [x] 客户端 LLM 调用超时（v0.9.1）：questions 60s / followup 45s / feedback 90s，挂起 → 明确报错+重试 / 降级前进，不再无限转圈（针对 06-10 上游挂起事故的加固；helper 已用真实挂起服务器验证）

### 用户实测反馈（2026-06-10）✅ 已修复（v0.8.3）
- [x] 宽屏追问界面布局崩坏 —— grid 两列加 min-w-0（truncate/nowrap 撑爆 1fr 列的 min-content）
- [x] 误导性 JD 链接提示文案连虚线框删除（产品无抓链接能力）
- [x] PDF 解析线上失败 —— 排查：线上 worker 服务正常、本地管线正常；已切换 legacy 构建加固。用户复测结论：Chrome ✓ / Safari 仍失败（低于 legacy 支持下限）。v0.8.4 改为预期管理：Chrome 徽章文案覆盖 PDF + 失败报错指引改用 Chrome。不再深挖 Safari 兼容（内测阶段投入产出比低）
- [x] （顺带发现）dev 下 StrictMode 导致会话恢复失效 —— isHydrated 由 ref 改为 state
- [x] 成本优化（v0.8.5）：feedback 重试 3→2、维度证据 2-3→2（指令收紧/校验放宽防重试反噬）、简历+JD 做成缓存前缀（3 次反馈调用复用，~10% 价命中）。单场 ~$0.25→~$0.20
- [ ] 成本异常排查（用户侧，仍待办）：console.anthropic.com 查 Usage 确认 $4 为开发累计；给 key 设 spend limit（这才是防"静默花光"的根本）
- [ ] 复核：Supabase 无 followup_degraded → 第三题无追问是 AI 正常判断、非余额耗尽；反馈失败是余额在最后阶段耗尽

### 渠道归因埋点（v0.9.2）✅
- [x] 新增 landed / app_viewed 两个前置漏斗事件（app_viewed 为将来邀请墙预埋）
- [x] src（?src=douban/xhs，缺省 direct）first-touch 持久化，自动注入所有事件
- [x] 每事件 time_since_landed_ms（落地锚点 sessionStorage，触发时现算）
- [ ] 投放链接用 `?src=douban` / `?src=xhs`；DB 侧待网络恢复后在 Supabase 确认一条 landed 的 props

### P2 · 内测期间观察 / 迭代（非阻断）
- [ ] 历史进步追踪（Phase 1 已设计）—— 建议用内测先验证需求，再决定是否建
- [ ] AI 评分校准 —— 用内测期 👍👎 评分 + 真实反馈，检验评分是否合理、稳定
- [ ] 盯护栏指标 —— 追问降级率 / 反馈延迟 / 转写编辑率是否异常


## Phase 1: 核心功能骨架 ✅
- [x] 1. 创建简历和 JD 输入页面（InputStep.tsx，含拖拽上传和示例数据）
- [x] 2. 集成 Cloud LLM 生成面试问题（/api/generate-questions，Zod 验证，已测试）
- [x] 3. 实现语音输入和计时功能（useVoiceRecorder hook + VoiceRecorder 组件，思考时间/回答时长计时）
- [x] 4. 实现 AI 反馈和可视化评分
  - [x] 后端：/api/generate-feedback（含重试逻辑、思考时间个性化反馈）
  - [x] 前端：FeedbackStep 接入真实 API（并行获取每道题反馈，问题切换 Tab）
  - [x] 前端：InterviewStep 收集真实答案并传递给 FeedbackStep（React Context 全局状态 + 进度条）
- [x] 追问式面试流程（3 主问题 + 最多 3 次动态追问，Demo 模式跳过追问）
  - [x] 新增 /api/generate-followup（LLM 判断是否需要追问）
  - [x] 重构 InterviewContext（QuestionThread / Exchange 类型，advanceToNext 原子操作）
  - [x] 重构 InterviewStep（追问历史展示、AI 判断加载态、最大追问数限制）
  - [x] 重构 FeedbackStep（基于 completedThreads，每主题综合评分含追问链）
  - [x] 更新 /api/generate-feedback 接受对话 thread
  - [x] 更新 /api/generate-questions 生成 3 题
- [x] 5. 部署到 Vercel（已上线，配阿里云域名做国内访问中转）

## Phase 2: 打磨体验 ✅
- [x] 6. 加载动画和错误处理（骨架屏、ErrorCard 重试、追问判断动画、限流错峰）
- [x] 8. 示例数据 / Demo 模式（输入示例、Demo 快速通道、示例反馈预览标识）
- [x] 跨题汇总 Tab + 维度详情（每维度援引原文的证据 bullet）
- [x] 反馈三栏等高布局
- [x] sessionStorage 状态持久化（刷新不丢进度）
- [x] PDF 报告导出（打印就绪 HTML，零依赖）
- [x] 混合模型策略（followup→haiku，questions/feedback→sonnet，集中配置）
- [x] 7. 移动端适配（三步页面 + Header + Demo 跳转条响应式，375px 实测零横向溢出）

## Phase 3: 数据与度量 🔄
- [x] 匿名身份 + 自建埋点（lib/identity + analytics + db，POST/GET /api/track → Supabase）
- [x] 漏斗事件埋点（9 个核心事件）+ env 标记（prod/dev 区分）
- [x] 反馈结果持久化（H1：刷新不再重复生成、不再重复花钱；H3：feedback_viewed 每场只计一次）
- [x] 质量埋点：反馈页 👍/👎 评分 → 量化"反馈认可度""追问有用率"（feedback_rated 事件，评分持久化防重复计数）
- [x] 护栏埋点补全：followup_degraded（追问降级率）、转写编辑率（asrChars）、各环节延迟（followup/feedback latency + feedback_generated 成功事件）

## 待办池（按优先级）
### 中
- [x] 移动端适配（见 Phase 2 第 7 项）
- [x] 隐私声明文案（修正失实的"不上传"表述 + 顶部锁形隐私说明：仅本次生成、不留存、不用于训练）
- [x] "AI 判断中"时刷新的半完成态恢复（提取 runFollowUpJudgment + 挂载时检测半完成态并续跑判断）

### 低
- [x] crypto.randomUUID 非 HTTPS 兜底（identity 加 uuid() 降级，防 anonId 为空）
- [x] PDF 简历在线解析（pdfjs-dist，自托管 worker 到 public/，实测拖拽解析成功）
- [x] 提示词缓存降本（feedback system 重构为静态 + cache_control；questions/followup 同加）
- [x] 清理临时脚本 scripts/gen-demo-report.ts（已删除）
