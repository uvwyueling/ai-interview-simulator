# 开发 TODO 清单

## 🆕 v0.13.0（2026-08-12）· 上传前的样例报告（P0-1）✅
> 来源：prod 埋点（7/24–7/28）**43 访客 → 15 真人 → 仅 4 人填简历**，12/15 的真人在粘贴简历前就走了。断点不在产品里，在"没人知道这一小时能换到什么"。

- [x] **首屏次级入口「30 秒看一份样例报告 →」+ 弹层就地预览**（桌面大 Modal / 移动全屏）——不走 step 切换，因为 `InputStep` 的 resume/jd 是本地 state，切 step 会 unmount 并抹掉已粘贴的草稿
- [x] **两套人设可切换**（技术岗 / 市场营销），内容由真实 API 跑一遍生成后固化进 `lib/sampleReports.ts`
- [x] **预期管理文案**——「完整体验约需 40–60 分钟 · 建议桌面版 Chrome · 找个能出声的地方」（对应旧清单 H 项）
- [x] **3 个埋点**：`sample_report_cta_clicked` → `sample_report_viewed`（在 effect 里发）→ `sample_report_completed`（dwell≥20s ∪ 滚到底 ∪ ≥2 区块穿过阅读带，带 `reason`）
- [x] **修 3 个实现 bug**：祖先 transform 把 fixed 弹层拽出视口（改 portal）／CTA 焦点被 React 卸载重置（改 effect）／阅读带信号恒为 0（threshold 改 rootMargin）
- [ ] ⚠️ **上线后回看 Supabase**：核心问题是"看样例是否提升上传意愿"。查同一 session 内 `sample_report_completed` → `input_completed` 的转化，与**没看样例的访客**对比。目标：真人 → `input_completed` 从 27% 提到 ≥50%
- [ ] ⚠️ **确认 `sample_report_viewed` 在生产只发一次**——dev 下 React StrictMode 会双发，生产构建不会，但上线首日应核对 `cta_clicked : viewed` 是否 ≈1:1

## 🆕 v0.13.1（2026-08-12）· 出题分类标签岗位中立化 ✅

- [x] **`category` 枚举换成岗位中立的五类**：项目经历 / 专业深度 / 方案设计 / 行为面试 / 岗位认知，每类附定义让模型正确映射；prompt 显式禁止给非技术岗打带「技术」字样的标签
- [x] **词表落到 `types/interview.ts` 的 `QUESTION_CATEGORIES`**（与 `DIMENSION_LABELS` 同处）；`Question.category` 保持 `string`，不做 z.enum——标签跑偏是观感问题，为它挂 Zod 会白烧一次重试
- [x] **同步改写死的 demo 数据**（`DEMO_POOL` / `DEMO_QUESTIONS` / `sampleReports.ts`），避免 demo 与真实面试两套词
- [x] **真实 API 复测**：两套人设均无技术味标签，原先出问题的营销题现归为「专业深度」

## 🔴 本轮生成样例时发现、尚未修复的产品问题

- [ ] **键盘作答用户被计时数据误伤评分（P0，影响真实用户）** —— `InterviewStep.tsx:235-239` 的计时器只在 `recording === true` 时递增，纯键盘作答的用户 `durationSeconds` 恒为 0 → `FeedbackStep.tsx:433` 算出 `speakingTime = 0` → `generate-feedback` 的 `buildTimingNote` 生成「候选人本题总回答时长：0 秒」→ LLM 判定"互动深度严重不足"并大幅压分。**实测对照：同一份回答，计时荒谬时总分 42（communication 60），计时正确时总分 82（communication 85），相差 40 分。**
  - 真实影响：session `f58e6cf6`（豆瓣来源，**唯一一个非伦敦的真实完整完成者**）全程键盘作答，5 题中 4 题 `durationSec: 0`；他完成后点了 contact_cta 但没提交
  - 修法二选一：① 计时改为"进入该题到提交"的墙钟时间，埋点上区分 `durationSec` 与 `speakingSec`（更根本）② `speakingTime === 0` 时让 `buildTimingNote` 输出"本题为键盘作答，无语音时长数据，请勿据此评价表达节奏"（更小、立即止血）
- [x] ~~**出题的 `category` 枚举仍是硬编码技术味标签（P1）**~~ —— 已在 v0.13.1 修复

## 🔜 v0.14.0（下一轮）· hybrid ASR —— 规格已与用户对齐，待实现
> 决策：Web Speech 保留实时字幕体验，停止录音后调云端 ASR 做一次高精度转写并替换初稿。**阶段性**方案，供应商后定。

- [ ] **链路**：点录音 → Web Speech 出实时字幕 ＋ MediaRecorder 同步录压缩音频 → 停止 → 「正在优化转写…」→ POST `/api/transcribe` → 云 ASR 返回高精度文本 → 替换初稿 → 用户检查/编辑/提交
- [ ] **供应商适配层**：`ASR_PROVIDER` 环境变量切换（`mock` 本地/CI 验收 · `openai` 仅内部测试 · 最终供应商后补）。**不把 OpenAI 写死进产品架构**
- [ ] **热词**：从简历、JD、当前题目提取短词表作为 ASR 热词/提示词（React / TypeScript / CRDT / GMV / ROI / 字节跳动 …）
- [ ] **双模式 + 首次授权弹窗**：「高准确转写」与「仅浏览器转写」；进面试页前弹一次产品自己的模式选择说明，选完记住、面试页留低干扰的「语音设置」入口可切换。**产品弹窗与浏览器权限弹窗必须分开**——不要在产品弹窗里调 `getUserMedia()`
  - 默认值分两阶段：供应商与隐私条款未确认前**默认「仅浏览器转写」**；云 ASR 完成准确率/稳定性/隐私验证后，弹窗中预选「高准确转写（推荐）」
- [ ] **音频处理**：只在内存中暂存，转写完成或失败后立即丢弃；不落对象存储/数据库/日志，不缓存请求体，不把音频或转写原文写进错误监控；超时、取消、切题、报错时同样释放；限制单段时长与大小
  - ⚠️ **必须显式设 `audioBitsPerSecond`（建议 16000）**：MediaRecorder 用浏览器默认码率（webm/opus 约 128kbps）时，最长那条 257 秒的回答约 4.1MB，会贴上 Vercel 4.5MB 的请求体上限；16kbps 下同样长度只有约 514KB
- [ ] **隐私页与弹窗文案改写**：现有「不录制、不上传你的音频」必须改。**两方都要写明**——浏览器转写时音频由浏览器内置服务（如 Chrome 的 Google 识别）处理；高准确模式在此基础上额外发一份给高精度识别服务
- [ ] **埋点（5 项指标 + 转写评分 UI）**：`asrUpgradeDistance`（Web Speech 初稿 → 云 ASR 的编辑距离，证明升级值不值）、`userEditDistance`（云 ASR → 用户提交，证明够不够好）、`transcribeLatencyMs`、`transcribeFailed` / 降级率、`userEdited` 布尔值，加一个「这次转写准不准？」的 👍/👎（`transcript_rated`）。**只传数字，绝不传文本**
- [ ] **上线后重测面试时长**——当前 71 分钟的中位数是在旧 ASR 下跑出来的，ASR 改完再测一轮，届时再定要不要动面试长度（快速模式 / 减少题数）

## 🟡 已确认但本轮未做

- [ ] **ContactCTA 改造** —— `contact_cta_clicked` 绑在输入框 `onFocus`（`ContactCTA.tsx:65`），所以那 2 次是**"光标已点进输入框、准备填了才放弃"**，不是"没看到"。表已建好、0 行，故障排除，问题是劝退。改法：把「留个联系方式」换成说清回报的文案，并允许**只留言不留联系方式**（降门槛）
- [ ] **`latinRatio` 备选埋点** —— 回答里英文字符占比。用户本轮未采纳，但它是验证"中文里夹英文词就容易错"这个假设的唯一手段，一行正则的成本。若 v0.14.0 上线后 `userEditDistance` 仍高，再加

## 🆕 v0.12.2（2026-07-29）· 麦克风 churn 第二洞：network 可自愈 ✅
> 来源：7/27–7/28 埋点显示问题仍在——单会话 prompt_shown 76/101 对 answer_submitted 7/10（每题手动点 ~10 次），但 granted:prompt 已 1:1、auto_restart≈0、asrChars≈answerLen。定位：Web Speech(zh-CN) 流向 Google，国内弱网每 1–3 分钟丢 `network`，原代码当致命错 → 强制重点。

- [x] **`network` 改可自愈**——保留 ref 让 onend 静默重启（发 mic_auto_restart），瞬断无感续上
- [x] **连续失败上限 MAX_NETWORK_RETRIES=5**——超限停重启 + 弹「网络不稳定…改用键盘」；成功转写清零计数
- [x] **新增 `mic_recognition_error` 事件（reason + recovered）**——补上"非拒绝类错误全不埋点"的盲区，坐实 network 真凶
- [x] **验证**：mock 驱动瞬断自愈（无报错、granted 仍 1）+ 持续断网超限（auto_restart×5 后停、无死循环）
- [ ] ⚠️ **上线后回看 Supabase**：确认 `mic_prompt_shown` 向每题 ≈1 收敛、`mic_auto_restart` 与 `mic_recognition_error(reason=network)` 承接原来的手动重点；若 network 占比高，再评估换 ASR（治本）

## 🆕 v0.12.1（2026-07-25）· 麦克风录音核心 bug 修复 ✅
> 来源：Supabase 数据发现单会话 `mic_permission_granted` 触发 74 次、循环上 asrChars 全空、granted 与 prompt_shown 同毫秒。根因：`InterviewStep.tsx` 语音识别 effect 缺 `onend` 自动重启 + `no-speech` 被当致命错误。

- [x] **加 `onend` 静默自动重启**——Chrome 静音自停后无缝续听，用户无需再点；ref 身份校验防死循环、显式停止/切题不重启
- [x] **`no-speech` / `aborted` 视为良性**——思考停顿不再打死录音、不再弹「识别出错」
- [x] **埋点纠偏 `grantedFiredRef`**——`mic_permission_granted` 恢复每题 ≈1 次；新增 `mic_auto_restart` 观测事件
- [x] **验证**：mock SpeechRecognition 驱动全生命周期断言通过（granted 不暴涨、no-speech 不停录、denied 不死循环）
- [ ] ⚠️ **上线后回看 Supabase**：确认真实会话里 `mic_permission_granted` 回落到每题 ≈1 次、`answer_submitted.asrChars` 稳定有值、`mic_auto_restart` 频次在合理范围（顺带替换 v0.11.1 那条"待真机测麦克风授权埋点"的观察口径）

## 🆕 v0.12.0（2026-07-24）·「联系方式 + 差评原因 + 时区」三件套 ✅
> 用户提出：v0 阶段最便宜也最重要的三个定性/画像补齐。

- [x] **反馈页底部联系方式 CTA**（仅真面试展示）——「我请你喝咖啡」文案 + 联系方式输入框 + 可选留言；`contact_cta_shown/clicked/submitted` 三事件；已提交状态持久化，刷新不重复
- [x] **👎 就地展开原因输入框**（可选，附「跳过」）——反馈认可度 & 追问有用率两处评分都覆盖；`downvote_reason_submitted` 事件带 `ratingKey + target/index/followupDepth + reasonLen`
- [x] **时区自动注入**——`track()` 里像 `src/env` 一样自动带 `tz`，一处改动全事件生效；Intl 不可用兜底为空串
- [x] **`feedback_submissions` 单表 + `/api/contact`**——PII 与 events 表隔离；用 `session_id` 反查行为路径
- [x] Privacy 页补充 PII 使用说明
- [ ] ⚠️ **Supabase 建表 SQL**（用户侧待做）：v0.12.0 上线前必须在 SQL Editor 执行，否则表单能提交但看到「提交失败」

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
- [x] **D · "开口说话"埋点** ✅ 已实现（v0.11.1）—— 麦克风授权小漏斗：`mic_prompt_shown` → `mic_permission_granted`（onstart，带 latency）/ `mic_permission_denied`（onerror 分流 not-allowed，带 reason）。顺带修 UX bug：授权被拒时给可执行引导（"点地址栏锁形图标授权，或改用键盘"），不再误显"识别出错请重试"
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
  - [ ] ⚠️ **亲自测麦克风授权埋点（v0.11.1，需真实浏览器弹窗）**：面试页首次点麦克风时故意点"拒绝"→ 看错误提示是否为可执行引导（"点地址栏锁形图标授权…"）；再点一次麦克风、这次点"允许"→ 正常开始识别。Supabase 应能看到 `mic_prompt_shown / mic_permission_denied / mic_prompt_shown / mic_permission_granted` 依次出现
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
