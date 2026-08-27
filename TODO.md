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

- [x] ✅ **键盘作答用户被计时数据误伤评分（P0）—— 已修复 2026-08-27**
  - **实际比原记录严重一倍**：`thinkingTimeMsRef` 也只在 `toggleRec` 里赋值，键盘用户 `thinkingTimeMs` 同样恒为 0 → `thinkingTimeGuidance(0)` 落进 `s < 3` 分支 → 「思考时间不足 3 秒、过于仓促」。**LLM 收到的是两条捏造的批评，不是一条**
  - 用户可见症状：UI「用时」恒显示 `00:00`、「进度」恒为「充足」、语速恒为 0——用户打字好几分钟，界面坚称他用了 0 秒
  - **根因**：`seconds` 是说话计时器，却被三个消费者当作答时长用；而 `0` 同时承担「测得为零」与「根本没测」两种含义（null-当-zero）
  - **修法（三层）**：
    - `types/interview.ts` **删掉含混的 `durationSeconds`**，换成 `answerSeconds`（墙钟，恒 > 0）+ `speakingSeconds`（仅语音，0 = 用户在打字）。删而不留是关键——编译器会把全部 3 处引用指出来，谁也没法再不小心读到那个含混值
    - `InterviewStep.tsx` 加**从 `questionStartRef` 推导**的墙钟计时器（自增会在 interval 被节流时漂移）；抽出 `markThinkingDone()`，录音键与 textarea 首次 `onChange` 都调用（语音走程序化 `setTranscript`，不触发 onChange，所以不会误判）；UI 的用时/进度/thinkRing 改用墙钟，语速留在说话秒数且**无语音时显示「—」而非 0**
    - `generate-feedback/route.ts` 的 `buildTimingNote` 把 `0` 一律当「未测量」：无思考数据时改为指示模型就内容给建议（`thinkingTimeFeedback` 是 schema 必填，不能让它输出空）；无语音数据时明确写「作答方式不是评分依据」
  - 埋点：`durationSec` **保持原义（说话秒数）** 不变以免 Supabase 同名列前后两种口径，另加 `answerSec`。附带收益是分析侧终于能直接区分键盘/语音
  - **实测验证（同一份回答，各跑 3 次真实 API）**：

    | | 三次得分 | 均值 | 极差 |
    |---|---|---|---|
    | 键盘 | 78, 79, 86 | **81.0** | 8 |
    | 语音 | 78, 85, 82 | **81.7** | 7 |

    LLM 自身的重跑方差约 8 分，而键盘与语音的系统性差异是 **0.7 分**——与 0 无法区分。**修复前实测差 40 分（42 vs 82）**，即惩罚是被消除而非缩小。反馈文本中不再出现「仓促」「互动深度」「0 秒」等任何计时类判词
  - [ ] ⚠️ **UI 那三处改动未做可视化走查** —— 本环境的浏览器面板是无头的（`visibilityState: hidden`、视口 0×0），只做了类型检查与逻辑核对。**建议你在自己的 Chrome 上纯键盘走一题**，确认「用时」正常走秒、「进度」随时长变化、语速显示「—」
- [x] ~~**出题的 `category` 枚举仍是硬编码技术味标签（P1）**~~ —— 已在 v0.13.1 修复

## 🆕 v0.14.0 第一批（2026-08-12）· hybrid ASR 模式层 ✅
> 完整方案见 CHANGELOG [0.14.0]。**本批不含任何录音代码**，功能 dark launch（默认「仅浏览器转写」）。

- [x] **删死代码** `VoiceRecorder.tsx` + `useVoiceRecorder.ts`（273 行，单独提交）
- [x] **纯函数库**：`asr/limits.ts`（码率 24kbps、单段 300s）、`asr/types.ts`、`textDistance.ts`（含归一化，防标点差异伪造升级量）、`asr/hints.ts`、`voiceMode.ts`
- [x] **供应商适配层** `ASR_PROVIDER`（mock / openai / 后补），未知值降级不抛错
- [x] **`/api/transcribe`** POST（校验阶梯 7 级 + 严格日志纪律 + 内存纪律）与 GET 能力探测
- [x] **双模式弹窗 +「语音设置」芯片**，产品弹窗与浏览器权限弹窗严格分离
- [x] **隐私文案改写**（两种模式都说清楚）+ 第三方服务清单补齐
- [x] **移动端探测点**：`landed` 加 `mediaRecorder` / `webSpeech`
- [x] 埋点 `voice_mode_dialog_shown` / `voice_mode_selected`

## 🆕 v0.14.0 第二批（2026-08-12）· 录音链路 ✅

- [x] **`lib/voice/capture.ts`** MediaRecorder 封装（只允许动态 import；24kbps 显式设置；每条退出路径释放 track）
- [x] **`hooks/useAnswerAudio.ts`** 生命周期与六条停止路径；generation + 调用方 token 双保险
- [x] **规则 A**：触顶不替换初稿 · **规则 B**：多段只替换尾部 · 可疑短结果保护
- [x] **边录边交确认弹窗**，确认后丢弃音频并标 `upgradeStatus:"skipped"`
- [x] **三处 UI 冲突**全部解决（isUpgrading 优先于粘性 speechError／isEditable 统一驱动／readOnly 而非 disabled）
- [x] **埋点四事件 + answer_submitted 扩展**，只出数字；`userEditDistance` 仅单段时上报
- [x] **转写评分 👍/👎**，仅在云端真改动时出现
- [x] 修复三个实现 bug：触顶结果被静默吞掉、`upgradeStatus` 报成 `none`、提交按钮把 MouseEvent 当参数传（每次点击都会跳过确认）

## 🔜 v0.14.0 第三批 · 接讯飞 provider（规格 2026-08-26 写 · **第 1 节已完成**，2–4 节待执行）

> 前两批把链路建好了但供应商是 `mock`。这一批把它换成真的。**规格依据是 2026-08-16 的真实探针实测**，不是文档推测。
>
> ⚠️ 当时那个探针脚本在会话 scratchpad 里，**现已被清空**。鉴权签名、上传/建任务/查询三个端点的具体参数需要重新照文档写一遍——但下面的结论是实测数据，仍然有效。

### 实测结论（决定了这一批的形状）

| 观察 | 数据 | 推论 |
|---|---|---|
| 延迟 | 100 秒音频，端到端 **5.7s / 7.4s**（轮询 4 次） | 落在可接受范围，比文档说的 20s 好得多 |
| 中文热词 | 唯一差异：`买点` → **`埋点`** ✅ | 有效，要留 |
| 英文热词 | Web Speech / DeepSeek / CRDT / GMV 全部零改善 | **无效**。「热词仅支持中文」这条限制在极速转写上同样成立 |
| 错误类型 | `deep seek`／`supa base`／`CRD t`／`vercel` | **不是听不出来，是大小写与分词**。与 Web Speech 把「Agent」听成「爱真」不是一个量级 |
| 格式 | 只收 wav/pcm/mp3；Chrome MediaRecorder 只出 webm/opus | **没有交集，必须浏览器端转码** |
| 体积 | WAV 16k/16bit/单声道，100 秒 = 3.09MB → 300 秒约 **9.6MB** | 超 Vercel 4.5MB 上限一倍，所以转码不能转 WAV |

由此三件事是耦合的：**转码走 MP3（已定 A 方案）**、**英文词表从「热词」改作「后处理纠正词典」**、**热词只送中文**。

---

### 1. 浏览器端 MP3 转码（`src/lib/voice/encodeMp3.ts`）✅ 2026-08-26

- [x] **只允许动态 `import()`** —— 已在生产包结构上核实：编码器落在独立 chunk（`a7f1ff53.*.js`，**158KB raw / 54KB gzip**），主 chunk 与共享 chunk 均搜不到 `Mp3Encoder`，首页 First Load JS 仍是 139KB（51.8→51.9KB，只是 hook 那点改动）
  - 注：npm 上 unpacked 471KB 是含 source map 与多份构建的体积，**实际过线只有 54KB gzip**，原先「约 50KB」的估计是对的
- [x] **依赖 `@breezystack/lamejs` v1.2.7**（具名导出 `Mp3Encoder`）
- [x] **链路**：webm/opus → `OfflineAudioContext(1, 1, 16000)` 解码兼重采样 → 逐帧降混+转 Int16 → lamejs 32kbps 单声道 → `Blob("audio/mpeg")`
- [x] **接入点在 `useAnswerAudio.finish()`**，不进 `capture.ts`
- [x] **路由未改**：`ALLOWED_AUDIO_TYPES` 已含 `audio/mpeg`
- [x] **内存纪律**：逐帧转换，不做整份 Int16 预拷贝（300s 可省约 9.6MB）；结束即释放 chunk 引用
- [x] **失败即降级**：新 reason `encode_failed`；UI 走既有兜底文案，无需新增

**spike 实测结论（页面已删除）**

- ✅ **假设 1 成立**：在 16kHz 的 `OfflineAudioContext` 上调 `decodeAudioData`，返回的 buffer 确实是 `sampleRate === 16000`。重采样是它自带的，不用手写
- ❌ **假设 2 被推翻**：解码后 `numberOfChannels === 2`。`capture.ts` 的 `channelCount: 1` 只是**请求**，不是保证。**降混分支是必需的**，不是防御性代码
- ✅ **假设 3 精确命中**：300s @32kbps = **1,200,384 字节**（1.20MB），Node 与 Chrome 两处结果逐字节一致
- ⚠️ **额外发现：`decodeAudioData` 会 detach 传入的 ArrayBuffer**，之后 `byteLength` 读到 0。任何需要原始字节数的地方必须在解码前取

**线程模型：主线程分片 + MessageChannel（不上 Worker）**

| 策略 | encodeMs(108s 音频) | 最长阻塞 |
|---|---|---|
| 不 yield | 1987 | **1987ms** |
| MessageChannel 每 50 帧 | 1931 | 82ms |
| MessageChannel 每 20 帧 | 1954 | 33ms |
| **MessageChannel 每 10 帧** | 1924 | **23ms** |

- **yield 本身零成本**（总耗时差落在噪声内），所以取最密的每 10 帧
- **必须用 MessageChannel，不能用 `setTimeout`**：后者嵌套后被钳到 ~4ms，后台标签页更是钳到 ~1s——实测时正是它把一次中断测试拖到编码结束之后
- Worker 不会让编码更快（同一颗 CPU），只能再抹掉那 23ms 抖动，不值当前的构建面

- [ ] ⚠️ **吞吐量仍有一个未定区间** —— 同一段代码 Node 测得约 120x 实时、Chrome 测得约 51x。差异几乎肯定来自**无头标签页的 CPU 降权**（两处产出的 mp3 字节数完全相同，说明干的活一样），但本环境无法测前台。据此 300s 的编码耗时在 **2.4s–5.8s** 之间。另：spike 用的是合成音频，不是真人语音
  - 不阻塞：响应性已由分片解决，与吞吐无关
  - **决策（2026-08-26）：不单独补测，并入第 2 节末尾的真机验收一次做完。** 理由不是省事——单独量编码只能得到一个无法据以行动的数字。真正要判断的是「这个等待能不能忍」，而那要编码 + 上传 + 讯飞那 5–7 秒加起来才成立
  - 推迟是安全的：`encodeMp3(blob, {signal})` 的接口当初就按「可换 Worker」设计，真要迁 Worker 只动该文件内部，不触碰 `useAnswerAudio` / `InterviewStep` / 服务端 provider。早测晚测返工成本一样
  - 届时若 P90 明显偏向 5s 一侧，再评估 Worker；埋点 `encodeMs` 已就位

- [x] ~~**`.env.local` 里两行 `ASR_PROVIDER` 的哑弹**~~ —— 用户已自行清掉重复行，现在只剩 `ASR_PROVIDER=xfyun`
  - ⚠️ **但它现在是实弹了**：第 2 节落地后 `xfyun` 是合法 case，**本地每次录音都会真的调讯飞并计费**。这是明确选择，不是意外
  - 🔴 **生产环境仍然不要配 `ASR_PROVIDER=xfyun`** —— 成本硬上限（见下方）没做，这层隔离**只存在于部署配置里，没有任何代码层面的保障**
  - 本地要临时回 mock 又不想动 `.env.local`：建一个 `.env.development.local` 写 `ASR_PROVIDER=mock`（Next 的加载优先级高于 `.env.local`，且已被 `.gitignore` 的 `.env*.local` 覆盖），用完删掉

### 2. 讯飞 provider（`src/lib/asr/providers/xfyun.ts`）✅ 2026-08-27

- [x] **照 `providers/openai.ts` 的形状**：裸 fetch 不引 SDK，`isXfyunConfigured()` + `xfyunProvider`
- [x] **异步任务制三段**：上传 → `pro_create` → 轮询 `query`，轮询可被 `AbortSignal` 中断
- [x] **成功判据 `code === 0` 且 `task_status ∈ {3,4}`**（字符串与数字都吃）
- [x] **结果拼接** `lattice[].json_1best.st.rt[].ws[].cw[].w`，对象与 JSON 字符串两种形态都吃
- [x] **前置格式守卫**：非 mp3/wav 直接拒，不白花一次上传
- [x] **热词只送中文**（provider 内部按 `/[一-龥]/` 过滤，不动 `extractHints`、不改 wire 格式）
- [x] **`provider.ts` 加 case** + **`.env.example` 补三个变量**
- [x] **日志纪律**：实测审计通过，日志里只有 `[transcribe] provider failed: <code> <status> AsrError`，无响应体、无转写原文、无初稿

**探针坐实的事实（脚本在 scratchpad，未进仓库）**

| 项 | 结论 |
|---|---|
| 鉴权 | HMAC-SHA256 + `digest`，签名串 `host/date/POST {path} HTTP/1.1/digest`。⚠️ 与讯飞另一个转写产品 lfasr 的 `signa`/HmacSHA1 **完全不同**，凭据不通用 |
| MP3 | `encoding:"lame"` 实测接受，第 1 节的格式选择不用返工 |
| `json_1best` | 实测是**对象**（代码仍容错字符串形态） |
| 延迟 | 22.3s 音频 → 端到端 1.5–2.5s；112.2s → 4.3s。拟合 `≈1.5s + 秒数×0.025`，外推 300s ≈ **9s** |

- [x] ⚠️ **真实调用发现并修复一个实现 bug：错误分类被 HTTP 状态码短路** —— 讯飞失败时返回的是 **HTTP 400，而 vendor code 在 body 里**。原实现在 `!res.ok` 时直接按状态码映射成 `upstream`，body 从未被读取，于是 `20304 → unsupported_media` 那条映射**永远不会触发**。
  - 后果不只是文案：它把「用户录了一段静音」和「供应商挂了」归进同一个桶，**污染失败率指标**——前者是用户行为，后者是事故
  - 已改为：`!res.ok` 时先解析 body 取 vendor code，有则按 code 映射，没有再退回状态码映射。body 只用来取那个数字，绝不记日志

- [ ] 🟡 **静音的用户文案仍不准确** —— 20304 现在正确归类为 `unsupported_media`，但路由对应的文案是「音频格式不受支持」，而真实成因往往是**用户录了一段没声音的音频**（路由的 `MIN_AUDIO_BYTES` 拦不住，静音 MP3 也有 24KB）。分类已经对了（不再算作供应商故障），只剩文案不贴切。要根治得给 `AsrErrorCode` 加一个成员，会牵动路由的 switch 与文案，本次没做

- [x] ✅ **`dhw` 热词在真人语音上确认有效**（2026-08-27，用户提供的 109.7s 真实录音）
  - 带与不带热词的两版转写，**437 字中恰好 1 处差异**：`上线之后我看`**`买点`**`发现` → `上线之后我看`**`埋点`**`发现`。与 8/16 的发现逐字一致
  - **TTS 音频完全测不出这件事**——合成语音上带与不带逐字节相同。合成音过于干净、识别器已高置信，热词偏置没有介入的余地。**结论：热词类实验必须用真人语音，TTS 只能验管线不能验效果**
  - 由此第 4 节「热词分流」的前提成立：中文热词确有增益，值得把被拉丁词挤占的配额还给中文
- [x] **真人语音延迟与合成语音一致**：109.7s → 4.3s（4 轮询），落在 `≈1.5s + 秒数×0.025` 的拟合上

**真人语音的错误分类（第 3 节纠正词典的真实素材）**

| 原话 | 识别为 | 纠正词典能修? |
|---|---|---|
| Next.js | `next点js` | ⚠️ 能，但要把口述的「点」当作分隔符处理 |
| Supabase | `sup base` | ✅ 分词 |
| DeepSeek | `deep seek` | ✅ 分词 |
| CRDT | `CRD t` | ✅ 分词 |
| GMV / ASR / MediaRecorder | `gmv` / `asr` / `media recorder` | ✅ 大小写 + 分词 |
| A/B test | `ab test` | ✅ 需把 `/` 纳入归一化 |
| **Vercel** | **`veral`** | ❌ **音近错误，精确匹配修不了** |
| **之前** | **`之后`** | ❌ **语义反转，任何后处理都修不了** |

- [ ] 🔴 **`之前 → 之后` 这类语义反转值得单独记一笔** —— 它把「12 个真人在上传简历**之前**就走了」变成了「**之后**」，意思完全相反。这不是纠正词典能覆盖的类别，也说明**「高准确转写」不等于「准确」**，用户仍需自己校对。产品文案不应暗示转写结果可以不看

### 3. 英文词表改作后处理纠正词典（新增 `src/lib/asr/correct.ts`）

> 本次最有价值的发现：**那份英文词表作为 ASR 热词无用，作为转写后的纠正词典非常有用**。纯字符串匹配，零 API 调用、零成本、结果可预测——比最早设想的「LLM 后处理」便宜得多，而且刚好覆盖实测出来的全部错误类型。

- [ ] **纯函数 `correctTranscript(text: string, hints: string[]): string`** —— 无 I/O、无 import，可单测
- [ ] **算法**：取 hints 里的拉丁词作为规范形（`extractHints` 已经保了大小写形式，`TypeScript` 胜过 `typescript`）；把规范形归一化为「小写 + 去空格」作为 key，在转写文本里找忽略大小写、允许内部有空格的匹配，替换回规范形
  - 覆盖实测四类：`vercel`→`Vercel`（大小写）、`deep seek`→`DeepSeek`（分词）、`supa base`→`Supabase`（分词）、`CRD t`→`CRDT`（分词 + 大小写）
- [ ] ⚠️ **边界必须卡死** —— 匹配两端只能是非拉丁字符或字符串首尾，否则 `ai` 这种短词会把 `available` 打成 `AIlable`。**并且设最短长度（建议 ≥3）与单次替换上限**，防止病态输入
- [ ] **只对 `providerClass === "cloud"` 生效** —— 在路由拿到 `result` 之后应用，`mock` 不走这条路径，否则 mock 的验收测试会被纠正逻辑污染
- [ ] **注意它会计入 `asrUpgradeDistance`** —— 纠正是升级的一部分，这没问题（指标衡量的是 draft→最终）。但复盘那个数字时要记得它含两个来源：讯飞的识别增益 + 我们的确定性纠正

### 4. 热词分流：中文进热词，英文进纠正词典（改 `src/lib/asr/hints.ts`）

- [ ] **不加新的 wire 字段** —— `AsrInput.hints` 保持一个数组，在**使用点**按正则分流：讯飞 provider 只取中文项作热词，`correctTranscript` 只取拉丁项。路由、hook、FormData 都不用动
- [ ] ⚠️ **但 `extractHints` 的配额要重新平衡** —— 现在合并顺序是**拉丁在前、中文在后**（`hints.ts:160`），拉丁项数量无上限，`MAX_HINTS`(30) / `MAX_HINTS_CHARS`(400) 一卡，`MAX_CJK_HINTS`(8) 那 8 个中文词可能**一个都进不来**
  - 在实测之前这只是「排序偏好」，实测之后它是 bug：**中文是唯一真正有效的热词，却排在无效的拉丁词后面被挤掉**
  - 改法：两侧各留保底配额（建议中文 ≥8 席先占，拉丁填剩余），而不是单一队列先到先得
- [ ] **`MAX_HINTS_CHARS`(400) 的注释要改** —— 它现在写的理由是「Whisper 家族 prompt 约 224 token」。换供应商后这个理由不成立，讯飞的热词表有它自己的上限，照文档重标

### 5. 验收（`mock` 与 `xfyun` 两套都要过）

- [ ] `npm run build` 通过
- [ ] **`ASR_PROVIDER=mock` 下全链路仍然可跑** —— 这是回归防线：mock 现在也会经过 MP3 编码这一步，编码坏了要在这里就暴露，而不是等到真供应商
- [ ] **Network 面板核实**：浏览器模式下 `encodeMp3` chunk 与编码器依赖**都没有被下载**
- [ ] **真机走一遍完整面试**（Chrome + 真麦克风），确认：编码耗时可接受、录音指示灯正常熄灭、「跳过」在轮询进行中仍能立即中断
- [ ] **纠正词典单测**：四类实测错误全部修对，且边界用例（短词、拉丁词嵌在长英文单词里）不误伤
- [ ] **用同一段带英文词的中文录音跑 16/24/32/48 kbps 采集码率过真实讯飞**，同时锁定 `AUDIO_BITS_PER_SECOND` 与 MP3 码率两个值（见第 1 条）

## 🔴 v0.14.0 上线前必做

- [ ] ⚠️ **转写超时按录音长度重新标定** —— 真实供应商的延迟**与音频时长成正比**（Whisper 这类约为音频时长的 1/10~1/5，再加上传）。当前三个值是拍的：客户端 20s（`CLIENT_TRANSCRIBE_TIMEOUT_MS`）、服务端给供应商 18s（`SERVER_PROVIDER_TIMEOUT_MS`）、Vercel 函数上限 30s（路由 `maxDuration`）。实测最长的 257 秒回答很可能超过 18s，结果是**最需要高精度的长回答反而必然超时降级**。
  - 决策（2026-08-12）：**现在不动**，接了真供应商测出延迟曲线再调——现在改是猜。届时考虑改成 `基础 + 音频时长 × 系数`，并注意服务端预算必须留在 `maxDuration` 以内，否则会被平台杀掉、拿不到我们自己的 504
  - 更新（2026-08-16 实测，**已不再是猜**）：讯飞 100 秒音频端到端 **5.7s / 7.4s**（含上传 + 4 次轮询）。线性外推 257 秒约 15–19s，**确实会贴上甚至越过 18s 的服务端预算**——原先的担心被证实。可用的标定起点：`SERVER_PROVIDER_TIMEOUT_MS ≈ 6s + 音频秒数 × 0.07`，封顶留在 `maxDuration`(30s) 以内
  - ⚠️ 两个会让这条实测数偏大的因素，标定时要扣掉：① 探针传的是 **3.09MB 的 WAV**，改 MP3 后同样时长只有约 0.4MB，上传那一段会明显变快；② 轮询间隔是探针自己拍的，provider 实现里可以调。**所以第三批做完要用真实链路重测一次再定死**

- [ ] ⚠️ **码率实测再锁定** —— 24kbps 是暂定值。整个商业理由建立在 `asrUpgradeCoreDistance` 显著为正上；码率过低会让你测到的是自己的压缩损失而非供应商质量。用同一段带英文词的中文录音跑 16/24/32 过真实供应商再定
  - 更新（2026-08-26）：**接讯飞后这条的方向可能反转**。因为必须浏览器端转码成 MP3，采集端 opus 的码率不再决定上传体积（MP3 那一级才决定），24k 当初「防止贴 Vercel 上限」的理由随之失效；而两级有损叠加反而要求给解码器**更干净**的输入。所以测试区间要往上扩到 **16/24/32/48**，并同时锁定 MP3 那一级的码率。详见第三批规格第 1 条
- [ ] ⚠️ **成本硬上限** —— `rateLimit` 是尽力而为的内存实现、冷启动即重置、serverless 每实例一份。对按音频秒数计费的路由是花钱风险。启用付费供应商前要么上共享存储（Upstash/Vercel KV），要么加粗粒度日计数
- [ ] ⚠️ **翻转默认值前先公布供应商名** —— 现在文案写「高精度识别服务」，这只在默认关闭且需主动开启时站得住。同时把 `echo_voice_mode_v1` 升到 `_v2`，让当初的选择被重新征询而非静默重新解释
  - 供应商已定为**讯飞**（2026-08-16 实测选定）。`privacy/page.tsx` 的「第三方服务」里那条占位「高精度识别服务：供应商确定后会在此列明」到时要改成实名，弹窗文案同步
- [x] **真机走一遍完整面试** ✅ 2026-08-12（Chrome + 真实麦克风）
  - ✅ **两路流并发不影响 Web Speech**：两种模式下实时字幕的出字速度与连贯性一致。这是设计里最大的架构不确定性，已排除
  - ✅ **麦克风正确释放**：两种模式停止后录音红点均熄灭
  - ✅ 由此发现并修复「话音刚落即停止导致尾巴重复」的 bug（详见 CHANGELOG）
  - [ ] 仍待测：优化等待时长的可接受度（mock 瞬时返回，需 `ASR_MOCK_DELAY_MS` 或真供应商才有意义）
- [ ] **上线后重测面试时长** —— 71 分钟的中位数是旧 ASR 下的，改完再测一轮，届时再定要不要动面试长度（快速模式／减少题数）

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
