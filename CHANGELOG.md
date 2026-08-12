# Changelog

All notable changes to this project will be documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.14.0] — 2026-08-12 · hybrid ASR 第二批（录音链路）

> 接上一批。录音、上传、替换初稿、指标全部就位。**供应商仍未定**，`ASR_PROVIDER=mock` 下整条链路可跑通且零花费；默认仍是「仅浏览器转写」。

### Added
- **`lib/voice/capture.ts`** —— MediaRecorder 封装，**只允许动态 `import()`**。浏览器模式下这个 chunk 根本不会被下载——结构性保证，可在 Network 面板核实，比「我们判断了一个布尔值」强得多，而这是一个关于用户音频是否离开本机的模块。
  - `audioBitsPerSecond: 24000` 显式设置（实测确认生效）。
  - **每一条退出路径都释放 track**。留着第二路麦克风流会让 Chrome 录音指示灯在用户停止后仍然亮着——配上新的隐私文案，那是信任 bug，不是资源泄漏。
- **`hooks/useAnswerAudio.ts`** —— 生命周期归属者。`recording→false` 有六条路径，**只有「用户主动点停止」该上传**，其余五条必须丢弃音频，所以不能挂在 `useEffect [recording]` 的 cleanup 上（那条 cleanup 六条都会跑）。`discard()` 幂等且任何 phase 可调用，于是那五处各自只需一行。
  - generation 计数器 + 调用方自己的 token 校验，**两道基于不同真相源的防护**：一次迟到的 `setTranscript` 落到下一题是这个功能能产生的最坏 bug。
- **规则 A** —— 触顶的段**绝不替换初稿**。录音器硬停在上限而用户还在说时，云端只拿到了前半段，用它替换会**静默删掉用户后半段回答**。
- **规则 B** —— 多段回答只替换尾部：`preSegmentRef + cloudText`，不是 `cloudText`。
- **可疑短结果保护** —— 云端结果短于初稿一半时判为异常并保留初稿。
- **边录边交确认弹窗** —— 直接提交会跳过高准确转写；确认后丢弃音频并把事件标为 `upgradeStatus:"skipped"`，让这部分采样偏差在数据里可见而非隐形。
- **转写评分 👍/👎** —— **仅在云端真的改动了转写时出现**。复用 context 既有 `ratings` 的 `tr:` 前缀，白拿刷新持久化与防重复计数，无需改 `InterviewContext`。
- **埋点**：`transcribe_started` / `transcribe_completed`（含 `asrUpgradeDistance` 与归一化版）/ `transcribe_failed`（12 种 reason）/ `transcript_rated`；`answer_submitted` 扩展 `voiceMode`、`upgradeStatus`、`segmentCount`、`userEditDistance`。**只出数字、枚举、布尔**。
  - `userEditDistance` **只在 `segmentCount===1 && upgraded` 时上报**：多段回答里升级后又口述追加的内容会被算成「编辑」，正好污染那个本该证明「转写够不够好」的数字。`segmentCount` 永远上报，使这个过滤在 SQL 里可见。

### Fixed
- **「跳过」按钮完全不起作用**（真机实练发现）—— 两个 bug 叠在一起，都与 mock 无关：
  - `fetchWithTimeout` 的 `fetch(url, { ...init, signal: controller.signal })` 把 `signal` 写在展开**之后**，**静默覆盖掉调用方传入的 signal**。这个工具函数一直是「接受 `signal` 然后丢弃」，于是 `cancelUpgrade()` abort 的是一个没人监听的 controller。现在会把外部 signal 链到内部 controller 上。其余三个调用点都没传过 signal，改动向后兼容
  - 即便 abort 生效，用户取消与超时**都表现为 `AbortError`**，`isTimeoutError()` 分不开；原判断写成 `aborted && !isTimeoutError(err)`，后半恒为 false，于是每次「跳过」都会被记成 `timeout`。改为只看自己那个 controller 的 `aborted`——它只由 `cancelUpgrade` 触发，超时用的是 `fetchWithTimeout` 内部另一个 controller
- **「跳过」在视线之外** —— 它原本只在麦克风按钮下方，而等待期间用户的视觉中心在右侧文字框（真机实练反馈：靠截图才发现）。现在文字框右上角「优化中」左边加了第二个，样式与行为完全一致。同样只在 `transcribing` 阶段出现——`stopping` 阶段还在收录音，没有东西可跳
- **「话音刚落就点停止」会把尾巴复制一遍**（真机实练发现）—— 停止时手动做了 `setTranscript(transcript + interimTranscript)`，但 `recognition.stop()` 之后 Chrome 会把待定音频**最终化并再发一次 `onresult(isFinal)`**，`onresult` 自己也会追加，于是同一段话进去两次（实测约 120 字重复）。等文字定稿再停就没事——正是这个复现条件指出了根因。原注释写的「停止会丢词」是错的：Chrome 不丢，它会补发。
  - 第一版修法（轮询等文本不再变化）**更糟且已废弃**：第一次比较可能平凡成立（最终化尚未到达时 `now === last`），于是拿短稿返回、升级结果把尾巴**覆盖删掉**。实测轨迹 `t≈2.0s "AAABBB"` → `t≈3.0s "AAA"`。重复只是难看，删字是真丢用户内容。
  - 最终版：不猜时间，**等 Web Speech 自己的 `onend`**（它在最终化之后才触发），其后仅做短轮询覆盖 React 提交延迟，另加 2 秒兜底防止个别引擎不报 end。定时器分不清「已完成」和「还没开始」，`onend` 分得清。
- **触顶结果被静默吞掉** —— 录音器自行硬停时 `onstop` 在没有等待者的情况下算出结果，`resolveStop` 还是 null，结果直接丢失；用户随后点停止只会拿到 `aborted`。初稿仍然安全，但**整个触顶情形不产生任何埋点、也不给用户任何解释**，等于不可见。现在把结果先寄存，`stop()` 到达时交付。实测修复后 `transcribe_failed(capped)` 与「本段较长…」提示都正确出现。
- **`upgradeStatus` 上报成 `none` 而非 `skipped`** —— 边录边交时 `setUpgradeStatus("skipped")` 是异步的，同一次调用里的 `track()` 读到的仍是旧闭包值。改为本地变量。这个标签存在的唯一目的就是让这类采样偏差可见，报错了等于没埋。
- **提交按钮把 MouseEvent 当成 `skipUpgradeConfirmed` 传入** —— 事件对象为真值，**每次点击都会跳过确认弹窗**。由 `next build` 的类型检查拦下。
- **`resetAnswer` 遗漏三项重置** —— 它不清 `speechError` / `grantedFiredRef` / `networkRetryRef`，与切题 effect 不一致，导致「重新作答」后仍残留过期错误与重试计数。既有缺陷，本次一并补齐。

### Changed
- 停止录音时**先提交 interim 再上传** —— 原先停止会丢掉尾部未定稿的词（只有「边录边交」路径在 `handleSubmit` 里补偿过）。同时让「初稿」成为一个确定的字符串，`asrUpgradeDistance` 才有意义。
- **三处 UI 冲突的解法**：`isUpgrading` 分支插在**粘性的 `speechError` 之上**（录音结束后 speechError 按构造已过期，机器状态严格更有信息量；转写失败走独立的 `transcribeNotice`，两个错误通道物理隔离）；「可直接编辑」徽章与文本框与 `canSubmit` 改由**同一个 `isEditable` 驱动**，三者不可能互相矛盾；文本框用 `readOnly` **而非 `disabled`**——文本仍可选中复制、不抢焦点、DOM 节点稳定，值替换就地发生而非重挂载导致滚动跳动。

### Verified
- `npm run build` 通过，无新增警告。
- **注入 mock（MediaRecorder / getUserMedia / SpeechRecognition）驱动真实构建产物**，沿用 v0.12.2 的验证方式：
  - 完整链路：`transcribe_started` → `transcribe_completed`，`asrUpgradeDistance=0`、`providerClass=mock`——mock 原样回声正是链路正确的证据。构造参数实测 `audioBitsPerSecond=24000`、`mimeType=audio/webm;codecs=opus`。
  - **四条丢弃路径逐条走完，每条之后 `tracksLive` 归零且无 `transcribe_started`**：识别致命错误、重新作答、边录边交、以及停止后的正常释放。
  - 规则 B：一题内录两段，第二段 `draftLen` 只等于新段长度（证明切片正确），第一段文本在最终结果中完好。
  - 规则 A：临时把上限调到 4 秒并录 5 秒，初稿保留、未被替换、提示出现、埋点为 `capped`。
  - 优化中：状态行「正在处理录音…」、文本框 `readOnly`、提交按钮禁用、「优化中」徽章四者同时成立。
  - 评分 UI 仅在 mutate 生效（云端真改动）时出现，点击后消失，事件只含数字。
- **真机实练（Chrome，真实麦克风）确认两项此前只能"已知并接受"的风险**：
  - **两路麦克风流并发不影响 Web Speech。** 同一段话在两种模式下各录一遍，**实时字幕的出字速度与连贯性一致**——MediaRecorder 与 Web Speech 同时持流没有让 Chrome 降级识别。这是整个设计里最大的架构不确定性，现已排除。
  - **麦克风在两种模式下都正确释放**，停止后标签页录音红点均熄灭。此前只验过 mock 里我自己写的假 track，真实 `MediaStreamTrack.stop()` 的行为到此才算确认。

### Notes
- **`mock` 供应商原样回声，所以两种模式下最终文字完全相同**——转写准确率的对照在原理上还做不了，得等接入真实供应商。现阶段能对照的只有字幕手感、等待时长与麦克风释放（均已实测）。
- **码率 24kbps 仍是暂定值。** 整个商业理由建立在 `asrUpgradeCoreDistance` 显著为正上；码率过低会让你测到的是自己的压缩损失而非供应商质量。接真实供应商前须用同一段带英文词的中文录音跑 16/24/32 对比再锁定。
- **成本没有硬上限。** `lib/rateLimit.ts` 是尽力而为的内存实现、冷启动即重置、serverless 下每实例一份。对按音频秒数计费的路由是花钱风险，启用付费供应商前要上共享存储或加日计数。

---

## [0.14.0] — 2026-08-12 · hybrid ASR 第一批（模式层）

> 目标：Web Speech 保留实时字幕，用户**主动停止**录音后调云端 ASR 做一次高精度转写替换初稿。简历与 JD 是天然术语表，作为热词传给识别服务——中英混排恰恰是词表最能救的那类错误。
> **本批只交付模式层，不含任何录音代码。** 供应商与隐私条款落定前，默认「仅浏览器转写」，功能 dark launch。录音链路为第二批。

### Added
- **双模式 +「语音设置」** —— 首次进面试页弹一次产品自己的说明弹窗（「高准确转写」/「仅浏览器转写」），选择存 localStorage，面试页麦克风下方常驻一个模式芯片可随时切换。
  - **产品弹窗与浏览器权限弹窗严格分离** —— `VoiceModeDialog` 里绝不出现 `getUserMedia` / `MediaRecorder`，文件头注释写死了这条。两个授权语境叠在一起会把人吓跑，埋点里已经有一个用户直接拒绝了麦克风授权。
  - 供应商不可用时，高准确卡片**渲染为禁用 +「暂未开放」而不是隐藏**——隐藏会让将来的开放显得像一次静默变更。
  - 已存的 `cloud` 选择在供应商不可用时**只降级生效模式、不改写存储的偏好**，供应商恢复后自动尊重用户原选择，无需再问一次。
- **`GET /api/transcribe` 能力探测** —— 客户端问服务端「现在到底能不能做」，而不是读一个 build-time 开关。开关只表达意图：key 缺失或 `ASR_PROVIDER` 拼错时它照样声称可用，用户说完两分钟才发现。端点从 `isAsrConfigured()` 派生，不可能与 POST 的真实行为不一致。**失败一律 fail closed**。顺带避免引入本项目第一个 `NEXT_PUBLIC_` 变量。
- **`POST /api/transcribe`** —— multipart 接收音频 + 初稿 + 热词，交给可替换的供应商适配层。
  - **音频只在内存中存在**：`arrayBuffer()` 读一次往下传，返回即出作用域。不落对象存储、数据库、文件，不缓存请求体。
  - **日志纪律**（每个 catch 都写了注释）：只允许打 `err.name`、`AsrError.code`、上游 HTTP status。**绝不 `console.error(err)`** —— fetch/SDK 的 error 对象常把 request body 挂在上面，而这里的 body 就是用户的音频和他说过的话。
  - **不带 anonId / sessionId** —— 这个端点不需要与人关联。指标在浏览器算好后走 `/api/track`。
  - 独立限流桶 `transcribe:` 20/min，**不与 `llm:` 共用**：它按音频秒数计费、体积大两个数量级，不能和出题抢预算。
- **供应商适配层** —— `ASR_PROVIDER` 切换（`mock` 本地/CI 验收 · `openai` 仅内部测试 · 最终供应商后补）。**未知值返回 null 而非抛错**：生产环境拼错一个字母应该降级到浏览器模式，不该让面试页 500。OpenAI 用裸 `fetch` 而非 SDK——引入厂商 SDK 正是这层要避免的硬绑定。
- **热词提取** `lib/asr/hints.ts` —— 客户端运行（否则每段音频都要附带整份简历+JD，让 PII 在传输和服务端内存里多存几十份副本；路由仍重新校验数量与长度）。
- **移动端探测点** —— `landed` 加 `mediaRecorder` / `webSpeech` 两个布尔。微信内置浏览器和 iOS Safari 不支持 Web Speech 但支持 MediaRecorder，这批人今天只能打字。放在 `landed` 而非面试页是为了拿**最宽的分母**，包括那些根本没走到面试页的人。
- 埋点 `voice_mode_dialog_shown` / `voice_mode_selected`（含 `cloudAvailable`、`wasDefault`），量化上传音频的主动选择率。

### Changed
- **隐私文案改写，两种模式都说清楚** —— 原文「不录制、不上传你的音频」删除。现在明确：浏览器转写时音频由**浏览器厂商自己的识别服务**处理（Chrome 会发给 Google，这一点原文从未说明）；高准确转写在此基础上**额外**发一份给高精度识别服务，仅在内存中处理、完成或失败后立即丢弃。「我们不做什么」里的「不录制音频」改为「不长期保存音频」；第三方服务清单补上两条识别服务。
- `lib/textDistance.ts` 的距离指标同时输出**原始**与**归一化**两个数。Web Speech 的 zh-CN 不输出标点、多数云 ASR 输出「。，、」，裸编辑距离会把每个新增标点算成一次「升级」——等于凭空制造这个指标本来要检验的商业理由。实测同一句话 raw=4 / core=0。

### Removed
- `VoiceRecorder.tsx` + `useVoiceRecorder.ts`（273 行死代码，单独提交）—— 无任何 import，且是 InterviewStep 内联实现的旧版弱化副本（无 `grantedFiredRef` 保护、无 network 重试上限、无埋点）。删掉是因为它们正好叫「VoiceRecorder」：下一个做语音的人会理所当然地改进那个错的文件。

### Verified
- `npm run build` 通过，无新增警告。
- 校验阶梯逐条实测：415 非 multipart → 400 无音频 → 200 `upgraded:false`（音频过小，保持 happy path 单一形态）→ 415 MIME → 400 时长越界 → 503 未配供应商 → 413 体积超限，**全部返回中文友好文案，无原始错误**。
- `ASR_PROVIDER` 拼错为 `mokc` → `available:false`，页面正常、不 500；已存 `cloud` 的用户生效模式降级为 browser 而存储偏好保持 `cloud`。
- 浏览器实测：首次进面试页弹一次 → 选择后持久化、刷新不再弹 → 芯片与首题提示同步显示当前模式 → 设置入口可 Escape 关闭且不改动 → 切换后两处文案同步。
- dev server 日志中只有方法/路径/状态码，无音频、初稿或转写文本。
- Supabase 中 `landed` 已带 `mediaRecorder` / `webSpeech`。
- 热词在两套真实人设上核对：技术岗得到 FCP / CRDT / TypeScript / ByteSpark / 实时协作模块…，营销岗得到 campaign / ROI / GMV / KOL / CPM / 冷萃新品上市 / 小红书…（中文侧改用「按非中文字符切分取单元格」而非 n-gram：滑窗会产出「产品的前端架」「内容策」这类非词，作为热词会把识别往错的方向偏）。

### Notes
- 把初稿文本发到自己的服务器**不是新的数据类别**——`generate-followup` 早已 POST 完整回答文本。
- 翻转默认值为「高准确」前必须先在隐私页公布供应商名，并把 `echo_voice_mode_v1` 升到 `_v2`，让当初的选择被重新征询而不是被静默重新解释。

---

## [0.13.1] — 2026-08-12

### Fixed
- **非技术岗的题目被打上带「技术」字样的分类标签** —— 出题 prompt 里 `category` 仍限定为「技术深度／项目经历／系统设计／行为面试／基础知识」，五类里三类是技术味的，非技术岗只能被塞进最接近的那个技术桶。实测：营销人设那道问「内容健康度如何衡量」的题，被打成了 **技术深度**。而 `DIMENSION_LABELS.technicalDepth` 早在 v0.10.0 就已改为「专业深度」——出题侧漏改了，两套词表自 v0.10.0 起一直不一致。
  - **换成一套岗位中立的五类**，每类都给出定义让模型正确映射：项目经历 / **专业深度**（技术岗即技术深度，非技术岗即其专业方法论）/ **方案设计**（技术岗即系统设计，非技术岗如 campaign、增长、运营方案设计）/ 行为面试 / **岗位认知**。prompt 里显式加了「不要给非技术岗的题目打上带『技术』字样的标签」
  - **词表落在 `types/interview.ts` 的 `QUESTION_CATEGORIES`**，和 `DIMENSION_LABELS` 放在一起。`Question.category` 仍是 `string` 而非该联合类型：标签跑偏纯属观感问题，为它挂掉 Zod 会白白烧掉一次重试甚至整场面试——约束由 prompt 施加，这里只作为共享参照
  - **同步改掉写死的 demo 数据**（`InputStep` 的 `DEMO_POOL`、`page.tsx` 的 `DEMO_QUESTIONS`、`lib/sampleReports.ts`），否则用户会在 demo 里看到一套词、在真实面试里看到另一套

### Verified
- `npm run build` 通过，无新增警告。构建本身拦下一个错误：App Router 的 route 文件不允许导出自定义常量，`QUESTION_CATEGORIES` 因此从 `generate-questions/route.ts` 移到了 `types/interview.ts`——那本来就是它该在的地方
- **真实 API 复测两套人设**：营销岗得到 `项目经历 / 专业深度 / 行为面试`，技术岗得到 `项目经历 / 专业深度 / 行为面试`，均无技术味标签；此前出问题的那道营销题现在正确归为「专业深度」
- 面试页分类徽章渲染正常（新旧标签均为四字，无布局风险）

---

## [0.13.0] — 2026-08-12

### Added
- **上传前的样例报告（P0-1）** —— 数据（prod，7/24–7/28）显示 **43 个访客 → 15 个真人 → 只有 4 个填了简历**：12/15 的真人在粘贴简历之前就走了。断点不在产品里，在"没人知道这一小时能换到什么"。现在首屏标题下加一个次级入口「30 秒看一份样例报告 →」，点开即见一份完整报告，**不需要上传任何东西**。
  - **弹层就地预览，不走 step 切换** —— 桌面端大尺寸 Modal、移动端全屏。关键约束：`InputStep` 的 `resume` / `jd` 是本地 `useState`，而 `page.tsx` 只在 `step === "input"` 时挂载它，**切 step 会 unmount，把访客已经粘好的简历直接抹掉**——那正好和这个功能的目的相反。弹层让 InputStep 保持挂载，草稿零损失，关闭零成本
  - **两套人设可切换（技术岗 / 市场营销）** —— 非技术岗的访客不该被一份前端工程师的报告劝退。营销那套的题目是预算分配逻辑、内容健康度阈值、KOL 投放取舍，零技术假设
  - **内容非手写，是真跑出来的** —— 两个虚构人设走了一遍真实链路（`generate-questions` → `generate-followup` → `generate-feedback`，DeepSeek），输出固化进 `lib/sampleReports.ts`。回答按"编辑过的口语"来写并**故意留缺口**，好让追问判定真的触发——它确实触发了：对一份完整回答判了不必追问，还自己抓到了一处"问题后半段没答"
  - **预期管理** —— 入口下方一行「完整体验约需 40–60 分钟 · 建议桌面版 Chrome · 找个能出声的地方」。实测中位时长 71 分钟，如实说会损失一些点击，但换来更少的半途弃跑
- **样例报告小漏斗（3 个事件）** —— `sample_report_cta_clicked`（有兴趣）→ `sample_report_viewed`（**在 effect 里发，不在点击里发**，这样渲染失败会表现为事件缺失）→ `sample_report_completed`（真读过，非跳出）。三者接已有的 `input_completed`，回答"给人看样例，到底有没有提高上传意愿"
  - `completed` 的三条判定任一即触发，并用 `reason` 区分：停留 ≥20s（`dwell`）/ 滚到底（`scrolled_to_end`）/ 至少 2 个核心区块穿过阅读带（`sections_read`），快速浏览者和慢读者都算得上，但"开了就关"不算

### Fixed
- **弹层被祖先 transform 拽出视口** —— `InputStep` 根 `<section>` 带 `.fade-up`，其 `animation-fill-mode: both` 让 `transform: translateY(0)` 永久留在元素上；**带 transform 的元素会成为 `position: fixed` 子元素的包含块**，于是 `fixed inset-0` 的遮罩相对 section 而非视口定位，页面一滚就飘（实测 modal top = **-33.5px**，底部 CTA 被切掉）。改为 `createPortal` 挂到 `<body>`，彻底摆脱任何祖先 transform
- **「用我的简历试试」按钮没把焦点送到简历框** —— 原实现在点击回调里用 `requestAnimationFrame` 抢时序，和 React 卸载 portal 的提交撞车，焦点被重置回 `<body>`（实测 `activeElement === BODY`）。改为由 `showSample` 翻转驱动的 `useEffect`，提交之后再聚焦，确定性生效
- **`sample_report_completed` 的"看过 N 个区块"信号恒为 0** —— 初版用 `threshold: 0.5`，但追问链、分维度点评这些区块**比滚动容器还高**，永远达不到 50% 可见度，于是 `sectionsSeen` 每次都是 0。改用 `rootMargin: "-35% 0px -35% 0px"` + `threshold: 0` 的中央阅读带，与区块高度无关
- **移动端弹层头部折行** —— 375px 下人设 tab 被拆成两行，读起来像坏了。tab 文案收敛为「市场营销」并给标题与 tab 加 `whitespace-nowrap`（37% 的流量在移动端）

### Verified
- `npm run build` 通过，无新增警告（`InterviewStep.tsx:392` 那条 exhaustive-deps 为既有）
- 浏览器实测：① 先粘贴草稿再开关弹层，草稿全程完好、关闭后焦点落在简历框 ② 三个事件按序上报、props 正确 ③ 阅读带信号在顶部为 0（不会"打开即算看过"）、滚到中段命中 2 个区块 ④ 人设切换、追问链展开、桌面/移动两种形态均正常

### Notes
- 本次生成样例时发现两处产品问题，均未在本版修复：**① 出题的 `category` 枚举仍是硬编码的技术味标签**（营销岗的题被打上「技术深度」，而 `DIMENSION_LABELS` 早在 v0.10.0 已改为「专业深度」）；**② 纯键盘作答的用户 `durationSeconds` 恒为 0**，反馈 prompt 收到"作答 0 秒"后会大幅压低评分——同一份回答实测相差 40 分（42 vs 82）。详见 TODO.md
- 岗位泛化（v0.10.0）这次拿到了真实 API 验证：营销人设的追问与评价全程无技术假设，谈的是归因模型、内容健康度阈值、跨部门协同

---

## [0.12.4] — 2026-07-29

### Fixed
- **进反馈页时滚动位置停在底部,「联系方式 CTA」被拍到脸上** —— 从面试页切到反馈页是 SPA 内的状态切换,浏览器**沿用了面试页往下滚的滚动位置**;而"反馈生成中"时页面很短(只有转圈面板 + 底部 CTA),于是用户一进反馈页第一眼就落在了底部的 CTA 上,有"图穷匕见"感。`FeedbackStep` 挂载时 `window.scrollTo(0, 0)` 复位到顶部——用户先看完自己的分数与反馈,再自然下滑发现 CTA。瞬间跳转(非平滑),避免刚进页面就看到一段多余的滚动动画。真实用户实练中发现(2026-07-29 Chrome 全流程)

---

## [0.12.3] — 2026-07-29

### Removed
- **`app_viewed` 事件** —— 退役第一个"建设期脚手架"埋点。它当初为一个从未上线的邀请墙预埋（本意是"越过墙、看到上传 UI"），但墙不存在，于是它一直紧跟 `landed` 后脚跟触发、纯冗余。`landed`（页面加载即触发）现在单独代表"进来了 / 看到 app"。删除内容：`EVENTS.APP_VIEWED` 常量、`trackAppViewed()` 函数、`echo_app_viewed` sessionStorage key，以及 `InputStep` 里的调用与随之空掉的 `useEffect` import

### Notes
- 埋点生命周期的第一次"拆脚手架"实践：漏斗从 `landed → app_viewed → first_interaction → …` 简化为 `landed → first_interaction → …`，不丢任何信号（两者本就前后脚触发）。历史数据里的 `app_viewed` 行仍在 Supabase，不受影响；新会话不再产生该事件
- 对比留作参照：mic 微漏斗（`mic_prompt_shown` 等 5 个）同属脚手架，但仍在调查中、**暂不退役**；`contact_cta_*` 属"年轻脚手架"，也未到退役期

---

## [0.12.2] — 2026-07-29

### Fixed
- **麦克风churn 的"第二个洞"：`network` 错误被当致命错误**（v0.12.1 修好了 granted 暴涨 + no-speech，但 7/27–7/28 埋点显示问题仍在——单会话 `mic_prompt_shown` 达 76/101，对 answer_submitted 约 7–10，即**每题手动点麦克风 ~10 次**；且 `mic_auto_restart` ≈ 0、`granted:prompt` 已回正为 1:1）。定位：Chrome 的 Web Speech（`zh-CN`）把音频流到 Google 服务器，国内/弱网下每 1–3 分钟丢一次 `network` 错误再重连；原 `onerror` 把 `network` 当致命 → `setRecording(false)` + 弹「识别出错」→ 用户被迫重点。佐证：这些会话 `asrChars ≈ answerLen`（848/848、652/652）说明麦克风与转写本身正常，只是连接反复瞬断。
  - **`network` 改为可自愈** —— 不再当致命，保留 recognition ref 让 `onend` 静默自动重启（发 `mic_auto_restart`），瞬断自动续上、用户无感、无需重点
  - **加连续失败上限 `MAX_NETWORK_RETRIES=5`** —— 连续 5 次 `network` 且期间无成功转写才判定"连接真的断了"，停止重启并弹可操作提示「网络不稳定导致语音识别中断，请检查网络后重试，或改用键盘输入」，避免网络全断时死循环。成功转写（`onresult` 出字）会清零计数，纯瞬断不会累积触顶

### Added
- **`mic_recognition_error` 观测事件**（带 `reason` + `recovered`）—— 补上此前的盲区：除权限拒绝（有专门事件）和 `aborted`（自身 stop 的噪声）外，所有 `onerror` 都记录原因。之前非拒绝类错误完全不埋点，才导致 `network` 这个真凶在数据里"隐形"、只能靠 prompt/granted 比值反推

### Verified
- Build 通过。真实打包产物注入 mock SpeechRecognition 驱动断言：
  - **瞬断自愈**：点 1 次麦克风 → `prompt_shown`×1、`granted`×1；两次 `network` 各记 `mic_recognition_error(network, recovered:true)` + `mic_auto_restart`，`start()` 续跑、`stop()`=0、录音存活、**用户无任何报错**；`onresult` 出字后计数清零
  - **持续断网**：连打 6 次 `network` → 前 5 次各自愈（`auto_restart`×5），第 6 次超上限 → 停止重启、显示「网络不稳定…」、`granted` 全程仍为 1、无死循环

### Notes
- 仍是治标：Web Speech 依赖 Google 在国内本就不稳，自愈只是把瞬断对用户隐藏。上线后回看 Supabase 应看到 `mic_prompt_shown` 向每题 ≈1 收敛、`mic_auto_restart` 与 `mic_recognition_error(reason=network)` 承接原来那些手动重点。若 `network` 占比确认很高，下一步才值得评估换 ASR（治本）

---

## [0.12.1] — 2026-07-25

### Fixed
- **麦克风"每答一题就重来"的核心录音 bug**（Supabase 数据发现：单会话 `mic_permission_granted` 触发 74 次、这些循环上 asrChars 全空、granted 与 prompt_shown 常同毫秒甚至顺序颠倒）。根因在 `InterviewStep.tsx` 的语音识别 effect：
  - **缺 `onend` 自动重启** —— Chrome 的 Web Speech API 即便 `continuous=true`，静音几秒也会自行 `onend` 结束。原代码没有重启逻辑：识别悄悄停了，但 `recording` 状态仍为 true（计时器在跳、麦克风图标亮着），却一个字都录不进。用户被迫停→再点，每次重建 recognition → `onstart` 再触发一次 `granted`，堆到 74 次。**修复：新增 `onend` 静默自动重启**（用户仍想录音时无缝续听，不重新触发 `mic_prompt_shown`；显式停止/切题时靠 ref 身份校验跳过重启，不死循环）
  - **`no-speech` 被当成致命错误** —— 原 `onerror` 里除权限拒绝外一律 `setRecording(false)` + 弹「语音识别出错，请重试」，而"开口前思考几秒"触发的 `no-speech` 也会走进这里，把录音打死。**修复：`no-speech` / `aborted` 视为良性、直接忽略**（交给 `onend` 续听），只有真错误才停并提示
- **埋点纠偏：`mic_permission_granted` 恢复为每次答题 ≈ 1 次** —— 新增 `grantedFiredRef` 守门，只有用户手动开录的**首次** `onstart` 才发 `granted`，内部自动重启不再重复发。之前 granted 实为"recognition 重启次数"而非"授权次数"（Web Speech API 授权会被浏览器记住，不会每次重申请——这点与最初 getUserMedia 的猜测不同，但观察到的 UX 症状完全吻合）

### Added
- **`mic_auto_restart` 观测事件** —— `onend` 静默重启时触发一次，量化"Chrome 静音自停"在真实会话里有多频繁，用于验证修复效果、也作为后续录音健康度的护栏指标

### Verified
- Build 通过。在真实打包产物里注入 mock SpeechRecognition 驱动完整生命周期断言：点一次麦克风 → `prompt_shown`×1、`granted`×1（尽管 `onstart` 触发 2 次也不再暴涨）；两次 `onend` → 各续跑一次、发 `mic_auto_restart`×2、`start()` 共调用 3 次、`stop()` 0 次；`no-speech` → 不产生事件、不停止、录音存活；权限拒绝 → `denied`×1、拒绝后 `onend` 不重启（无死循环）、可操作引导正常显示

---

## [0.12.0] — 2026-07-24

### Added
- **联系方式 CTA（反馈页底部）** —— 完成一次真实面试后（demo 模式不显示），底部出现一段可选表单：「这是我一个人做的 v0…我请你喝咖啡」+ 联系方式输入框 + 可选留言。零社群维护成本、筛出最愿意深聊的用户。已提交状态持久化（`contactSubmitted` 进 `InterviewContext`），刷新不重复出现
  - `contact_cta_shown` —— 用 `IntersectionObserver`（threshold 0.4）真正进入视口才打，比一渲染就打准
  - `contact_cta_clicked` —— 首次 focus 到任一输入框（意图信号）
  - `contact_submitted` —— 成功入库（含 `hasContact` / `hasMessage` / `messageLen` 元数据）
- **👎 差评原因输入框** —— 反馈认可度和追问有用率两处 `RatingButtons` 组件；点 👎 后就地展开可选 textarea（附「跳过」按钮）+ 提交，与 👎 打分本身解耦。这是最便宜的定性数据、抓在情绪最真实的时刻
  - `downvote_reason_submitted` —— 携带 `ratingKey` + `target/index/followupDepth` + `reasonLen`
- **时区自动注入** —— `track()` 每个事件自动带 `tz`（`Intl.DateTimeFormat().resolvedOptions().timeZone`），一处改动全事件受益。回答「这些人到底在哪」而无需 geo-IP、隐私友好；Intl 不可用时兜底为空串、不阻塞埋点
- **`feedback_submissions` 单表 + `/api/contact` 路由** —— 联系方式与差评原因共用一张 PII 表、用 `kind` 字段区分。events 表继续保持「零原始文本」不变量；用 `session_id` 反查该用户完整行为路径。Zod 校验 + rateLimit(10/min) + 包装错误 + `insertSubmission()` 与 `insertEvent()` 同款优雅降级

### Changed
- Privacy 页新增一节「你主动填写的联系方式与反馈」——明确说明这两项完全可选、仅用于与用户个人沟通、不公开不转售不用于 AI 训练
- 联系方式 CTA 文案微调：从「哪里不好用 → 我请你喝咖啡」改为**先给用户回馈价值**再邀约（「你觉得哪里不好用，告诉我，下次你就能练得更顺」），再问「愿意聊 20 分钟吗？」。原版是纯利他视角、把用户当采访对象；新版让用户看到"反馈 → 产品变好 → 自己受益"的闭环，降低"这跟我有什么关系"的心理门槛。仅文案变更，埋点与提交链路未动

### Notes
- ⚠️ **需要用户先在 Supabase 执行 SQL 建表**，否则 `/api/contact` 会走友好降级路径（返回 503 + 中文报错），前端表单能提交但看到「提交失败，请稍后再试」。SQL 见交付说明
- Build 通过；本地 preview 验证：👎 展开原因框 ✓、`/api/contact` 路由被调用 ✓（返回预期的 503 + 友好错误，表未建符合优雅降级）、`tz` 出现在每个事件 props ✓（`Asia/Shanghai`）。ContactCTA 因隐藏于 demo 模式外，未做可视验证——代码路径与已验的评分/原因面板同构

---

## [0.11.1] — 2026-07-23

### Added
- **D · Mic-permission mini-funnel** (3 new events) — previously the whole "click mic → grant/deny → start speaking" segment was invisible; only the aftermath (`answer_submitted`) was tracked:
  - `mic_prompt_shown` — user clicked mic, `recognition.start()` about to be called
  - `mic_permission_granted` — the browser actually started listening (fired from `recognition.onstart` — the only reliable "granted" signal, since clicking the button ≠ granted while the popup is still up). Carries `latencyMs` = popup hesitation time
  - `mic_permission_denied` — `onerror` with `error === "not-allowed"` or `"service-not-allowed"`, tagged with the specific reason. Fires every denial (not deduped) — repeated attempts are meaningful
  - The "silent" leak (shown but no granted/denied — user closed the popup / bailed) shows up naturally as `mic_prompt_shown - granted - denied`

### Fixed
- **UX bug found in passing**: `recognition.onerror` used to blanket-say "语音识别出错，请重试" for any error — including permission denials, where the app is not "broken" and asking the user to retry the same denied action is unhelpful. Now permission-denial errors show an actionable copy pointing to the browser's address-bar lock icon, and suggest the keyboard fallback

### Changed
- `types/speech.d.ts`: added `onstart`, typed `onerror` with `SpeechRecognitionErrorEvent` (was `Event`) so the error code is available — required for the denial-vs-other split

---

## [0.11.0] — 2026-07-23

### Added
- **E · Human/bot signal (no invite wall)** — instead of gating access, sessions are now tagged so bots can be filtered in Supabase:
  - New `first_interaction` event — fires once per visit on the first real gesture (`pointerdown` / `keydown` / `touchstart`). A session with `landed` but no `first_interaction` ≈ a bot/crawler. This is also the funnel-denoise signal I (replaces the previously-planned `first_recording_started`, which was later/stricter)
  - `landed` now carries `webdriver: navigator.webdriver` (cheap automation signal)

### Changed
- **C · Feedback wait no longer a dead stare** (perceived-speed fix for the ~24s/question v4-pro generation; no backend change):
  - **First-result priority** — the feedback page now defaults to the **Q1 tab** instead of 汇总. Q1 returns first (~24s), so the user sees real content fast; 汇总 (which needs all 3) stays one click away
  - **Live progress panel** — the static skeleton during generation is replaced by an `EvaluatingPanel`: a spinner + rotating stage text ("正在评估五个能力维度…" etc.) + an honest estimate ("每题约需 20–30 秒") + a REAL progress bar (`doneCount/total`, since the 3 calls return staggered)
  - Real streaming was deliberately rejected: feedback is a single Zod-validated JSON, so a half-streamed object can't be shown or validated — progress + first-result priority deliver the perceived-speed win without that complexity

### Notes
- Verified: build passes; input page boots clean (E's global listeners don't break page load). Deeper visual verification (the loading panel mid-generation; first_interaction firing on click) not done this run — Preview tooling unavailable here and it would need a real interview / real gesture. Changes are low-risk (C is presentational + a trivial `isLoading` branch; E mirrors the working `app_viewed`). Confirm in the next real run

---

## [0.10.0] — 2026-06-11

### Changed
- **F · Job-neutral prompts (② full change)** — the "resume résumé + JD" pipeline no longer assumes a technical role. All three server prompts (generate-questions, generate-followup, generate-feedback) now open with "先根据岗位 JD 判断岗位方向 …；如无法判断就按通用面试官路线，避免技术假设". The hardcoded "第 2 题：系统设计或技术深度" is gone; feedback's `technicalDepth` dimension is redefined as "该岗位核心专业能力的深度". UI label `DIMENSION_LABELS.technicalDepth` "技术深度" → "**专业深度**". **Internal key `technicalDepth` unchanged** — zero Zod/schema break, no data migration; radar chart and PDF report auto-pick up the label via existing plumbing
- **F · Demo banner expectation-setting (① light change)** — banner in the mock interview now says "以上为虚拟技术岗候选人的演示——上传你自己的简历后，题目将完全围绕你的背景生成", protecting non-technical demo visitors from thinking the product only serves technical roles
- **B · Adaptive follow-up softening (plan 2️⃣ + 2a)** — when the last answer is short (non-whitespace chars `< 30`), the follow-up prompt shifts from "考察" to "引导": it prefers to continue (giving the candidate a chance to reconnect), switches to a more concrete/answerable angle, and provides 1–2 directions as scaffolding in the question stem itself. Not a UI popup — the softening lives inside the next follow-up question so it feels like an interviewer reading the room, not an interruption
- API `generate-followup` request schema gained `lastAnswerLen: z.number().int().min(0).optional()`; frontend computes it in `runFollowUpJudgment` and sends alongside
- `followup_triggered` event now carries `wasSoftened: boolean` and `lastAnswerLen: number` for self-calibration (are we softening too often? does softening actually lift the next answer?)

### Verified
- Real API sanity check with a non-technical persona (品牌营销专员 candidate + JD): a normal-length answer draws an abstract deep-dive follow-up ("关键词筛选的逻辑…如何平衡品牌词/品类词/场景词"); a 9-char answer ("就是一个口红推广") draws a softened one that opens with "**能简单展开一下吗**" and provides three scaffolding angles ("哪个平台/什么人群/你具体负责了哪部分"). Both prompts stayed marketing-professional — no drift into technical questioning. F and B both behave as designed

---

## [0.9.2] — 2026-06-11

### Added
- **Two front-of-funnel events** so we can see drop-off before the existing `input_completed → interview_completed → feedback_viewed` steps:
  - `landed` — fires on page load (top of funnel). Props: `viewport_width` (raw `window.innerWidth`, not bucketed), `referrer` (raw `document.referrer`), plus `src` (auto, see below)
  - `app_viewed` — fires when the upload UI actually renders, i.e. past any (future) invite wall; once per visit
- **Acquisition source tracking** (`src`) — read from the landing URL's `?src=` (e.g. `?src=douban`, `?src=xhs`), defaults to `direct`. First-touch, persisted in `sessionStorage`, and **auto-injected into every event** so the whole funnel can be sliced by source — not just converted users
- **`time_since_landed_ms`** auto-injected into every event — `Date.now()` minus a landing timestamp anchored once per visit (`sessionStorage`); computed at fire time, no running timer

### Notes
- No backend/schema change — `/api/track`'s `props` is an open record; new events carry `env` like all others (`props->>'env'='prod'` filtering unchanged)
- `landed` fires per page load (refreshes repeat it — dedupe with `count(distinct anonId)`); `app_viewed` is once per visit
- ⚠️ There is **no invite wall in the code yet** — `landed → app_viewed` currently fire back-to-back. The instrumentation is pre-wired: once a wall renders before `InputStep`, `app_viewed` automatically becomes "passed the wall" with no further changes
- Verification: client-side state confirmed in a real browser (`src=douban` captured & persisted, landing anchored, `app_viewed` guarded once). DB-side insert not re-confirmed this run — the machine briefly lost network to Supabase; the POST path is unchanged from the events already flowing all session

---

## [0.9.1] — 2026-06-11

### Added
- **Client-side timeouts on all LLM calls** (`lib/fetchWithTimeout.ts`) — hardening from the 2026-06-10 incident, where hung upstream calls left the UI spinning on "AI 判断中" forever and even error tracking never fired (a fetch that never settles hits neither `.then` nor `.catch`). Per-route caps sized to each call's normal latency envelope, not one-size-fits-all:
  - generate-questions: 60s (normal 5–13s) → clear error + retry
  - generate-followup: 45s (normal 3–6s, thinking) → existing degrade path (advance without follow-up); `followup_degraded` now distinguishes `reason: "timeout"` vs `"network"`
  - generate-feedback: 90s (v4-pro legitimately takes 30–60s for 1–2K tokens) → ErrorCard + retry; `feedback_failed` now carries `reason`
- Friendly timeout error copy ("生成超时（AI 服务可能繁忙）…") instead of raw DOMException text

### Notes
- Helper runtime-verified against a deliberately hanging local server: aborts at the cap (±5ms), `isTimeoutError` classifies abort vs generic network errors correctly, fast responses pass through untouched

---

## [0.9.0] — 2026-06-10

### Changed
- **Switched the AI backend from Claude to DeepSeek** (so billing is visible in the user's own DeepSeek console). Done via DeepSeek's **Anthropic-compatible endpoint** (`https://api.deepseek.com/anthropic`) — we keep `@anthropic-ai/sdk` and only repoint the backend, so request/response parsing, Zod validation, retry, and error handling are unchanged
- **New model routing** (`src/lib/models.ts`), per product decision:
  - generate-questions → `deepseek-v4-flash`, non-thinking
  - generate-followup → `deepseek-v4-flash`, **thinking** (reason about whether to probe)
  - generate-feedback → `deepseek-v4-pro`, non-thinking
- New `src/lib/llmClient.ts` — lazy singleton pointing the Anthropic SDK at DeepSeek (`DEEPSEEK_API_KEY` + base URL)
- `generate-followup` `max_tokens` 512 → 4096 (thinking mode needs room for reasoning + the JSON answer)
- Removed now-inert `cache_control` blocks (DeepSeek ignores them and caches context automatically); feedback request simplified back to a single user message
- Env: `ANTHROPIC_API_KEY` → `DEEPSEEK_API_KEY` (`.env.example` updated); `CLAUDE.md` tech-stack line updated to reflect the switch

### Notes
- ⚠️ Not yet runtime-tested — requires `DEEPSEEK_API_KEY` (cannot be verified without the user's key). Verify: model id strings resolve, thinking on/off behaves per routing, and feedback JSON still parses. See migration checklist handed to the user
- Thinking/non-thinking is toggled via the `thinking` field; DeepSeek ignores `budget_tokens`

---

## [0.8.5] — 2026-06-10

### Changed
- **Feedback cost optimization** (per-interview cost ~$0.25 → ~$0.20):
  - Retries on `/api/generate-feedback` reduced 3 → 2 (sonnet output is the dominant cost; retries are the worst-case multiplier)
  - Output trimmed via prompt: each dimension now asked for exactly 2 evidence bullets (was 2–3). Schema kept at max 3 ("instruct tight, validate loose") so an occasional extra bullet does NOT trigger an expensive validation-failure retry
  - Résumé + JD moved into a dedicated cached content block (`cache_control`) ahead of the volatile task content; the 3 staggered feedback calls in a session now read the ~3–4K-token résumé/JD prefix at ~10% price (calls 2 & 3 hit cache)

### Notes
- These are modest savings (~15–20%/interview). They do NOT explain the earlier $4 draw-down (that is accumulated dev-testing spend — confirm on console.anthropic.com Usage). The durable safeguard is a spend limit on the key
- The follow-up loop was deliberately left unchanged: it runs on Haiku and does not send the résumé; its growing conversation thread is volatile and inherently uncacheable, so prompt caching can't help it

---

## [0.8.4] — 2026-06-10

### Changed
- **Chrome guidance now covers PDF parsing too** — user re-test confirmed PDF parsing works in Chrome but still fails in their Safari even with the pdf.js legacy build (Safari below the legacy build's support floor). Instead of adding another standalone hint, the existing trust badge was generalized: "推荐 Chrome 桌面端：语音作答与 PDF 解析体验最佳（其他浏览器可粘贴文本、键盘作答）"
- **PDF failure error is now actionable** — "无法解析 PDF（Safari 等部分浏览器暂不支持），请改用 Chrome，或复制文字后粘贴" (Chrome users never see it; Safari users get a clear next step at the moment of failure)

---

## [0.8.3] — 2026-06-10

### Fixed
- **Wide-screen interview layout blowout** — added `min-w-0` to both grid columns. Grid `1fr` = `minmax(auto,1fr)`: the conversation-history panel's `truncate` (nowrap) text inflated the right column's min-content width, exploding it and squeezing the question card into a vertical strip on wide viewports. Verified at 2200px: columns hold the intended 1.1:1 ratio with long follow-up history present
- **PDF parsing hardened for older browsers** — switched to pdf.js **legacy build** (+ matching legacy worker). The main build requires `Promise.withResolvers` (Chrome 119+ / Safari 17.4+) and threw on older browsers, the likely cause of the production "无法解析 PDF" report (production worker serving and the parse pipeline both verified healthy). Error message now mentions outdated browsers as a cause
- **Dev-mode session restore was broken under React StrictMode** — the hydration guard was a ref; StrictMode's double effect pass made the second SAVE run see `isHydrated=true` while closing over blank default state, overwriting the stored session before the second HYDRATE re-read it. Changed the guard to React state (uncommitted in the second pass → save correctly skips). Production behavior unchanged

### Removed
- **Misleading JD hint "支持粘贴 BOSS / LinkedIn / 拉勾 链接"** (with its dashed box) — the product has no link-fetching capability; pasted URLs were treated as plain text

---

## [0.8.2] — 2026-06-09

### Added
- **Basic abuse protection** (`lib/rateLimit.ts`) — in-memory per-IP rate limiting on the API routes: a shared 40-req/min cap across the 3 LLM routes (`generate-questions/feedback/followup`) and 200/min on `/api/track`. Returns 429 with `Retry-After`. Best-effort on serverless (documented); back with Upstash/Vercel KV for hard limits at public launch
- **`/privacy` page** — honest data-use statement (résumé/JD sent to Claude but not stored, voice handled by the browser's recognition service, anonymous analytics in Supabase, no account, no training use). Linked from the input-screen privacy chip ("隐私说明")
- **First-time onboarding hint** on the interview screen's first question — one line explaining mic answering, follow-ups (max 3), and editable transcript; auto-hides after the first answer

### Notes
- Pre-beta hardening (P1). Verified against a production build

---

## [0.8.1] — 2026-06-09

### Fixed
- **DEMO step-jumper no longer ships to production** — the floating "DEMO 输入/面试/反馈" bar (a dev tool) was rendered unconditionally; real users could teleport into the mock feedback page, confusing them and polluting funnel analytics. Now gated behind `process.env.NODE_ENV !== "production"`

### Changed
- **Removed dead header UI** for beta polish: the no-op "教程" button and the fake "Z" avatar (implied a logged-in account that doesn't exist). Header is now Logo + step bar
- **Set voice/browser expectations up front** — replaced the vague "支持中英文双语面试" trust badge with "语音作答建议使用 Chrome 桌面端（其他浏览器可改用键盘输入）", since Web Speech is Chrome-only and iPhone Safari users won't get voice

### Notes
- Pre-beta cleanup (P0). Verified against a production build: no DEMO bar, clean header, browser hint present

---

## [0.8.0] — 2026-06-09

### Added
- **PDF résumé parsing** — `.pdf` uploads are now parsed in-browser via `pdfjs-dist`; extracted text fills the résumé box. Worker is self-hosted at `/public/pdf.worker.min.mjs` (no external CDN — works in mainland China). Scanned/image PDFs are detected and the user is asked to paste text. Dropzone hint and file picker updated to include PDF. Verified end-to-end (drag → parse → text)

### Fixed
- **Mid-judging refresh recovery (M3)** — refreshing while "AI 判断是否追问" was in flight left a dangling state (answer saved, no follow-up pending) that could make the user re-answer the main question. The judging logic is extracted into `runFollowUpJudgment`, and `InterviewStep` now detects this unique state on mount and resumes the judgment automatically
- **`crypto.randomUUID` fallback** — `lib/identity.ts` now degrades to a Math.random-based UUID when `crypto.randomUUID` is unavailable (non-HTTPS contexts), preventing empty `anonId` → dropped analytics events

### Changed
- **Prompt caching** — `generate-feedback` system prompt refactored to be fully static (per-call timing data moved into the user message) and marked with `cache_control: ephemeral`, so the 3 staggered feedback calls in a session reuse the cached prefix; `generate-questions` and `generate-followup` system prompts also marked cacheable. Note: real savings scale with prompt size — the feedback prompt (largest, repeated) benefits most
- Collapse the redundant spaces pdf.js inserts between glyph runs when assembling résumé text

### Removed
- Temporary `scripts/gen-demo-report.ts` (one-off PDF-report preview helper)

### Dependencies
- Added `pdfjs-dist`

---

## [0.7.0] — 2026-06-09

### Added
- **Mobile responsiveness** — all three steps (input / interview / feedback), the header, and the demo step-jumper now render cleanly on phones. Verified at 375px with **zero horizontal overflow** across every screen

### Fixed
- Hero `<h1>` overflowed the viewport on mobile (34px CJK text exceeded 375px); now `text-[26px] sm:text-[34px]` with a `sm:` line break
- Header was cramped on mobile: logo title/subtitle wrapped vertically and the "教程" label broke mid-character. Logo text is now `whitespace-nowrap`, the tutorial link is hidden below `sm`, the mobile progress bar shrinks (`w-16 sm:w-40`), and header padding tightens (`px-4 sm:px-6`)
- Demo step-jumper button labels (输入/面试/反馈) wrapped vertically on narrow widths; added `whitespace-nowrap`

### Changed
- Added a global `overflow-x: hidden` safety net on `html, body`
- Hero subtitle and privacy badge scale down one step on mobile (`text-[13px]/[11px] sm:…`)

---

## [0.6.0] — 2026-06-09

### Added
- **Guardrail instrumentation (metrics layer 3)**:
  - `followup_degraded` event — fired when the follow-up API errors/times out and the app advances without a follow-up; carries `reason` (`http_*` / `network`) and `latencyMs`. Lets us measure 追问降级率
  - `feedback_generated` event — success counterpart to `feedback_failed`, with `latencyMs` and `exchanges`. Closes the feedback funnel and captures generation latency
  - Stage latency: `latencyMs` added to `followup_triggered`, `followup_degraded`, `feedback_generated`, `feedback_failed` (questions already had it)
  - `asrChars` on `answer_submitted` — cumulative characters contributed by speech recognition; with `answerLen` it yields the 转写编辑率 (ASR-quality proxy): `1 - asrChars/answerLen`
- **Privacy notice** on the input screen — a lock-badge line under the hero: "简历内容仅用于本次生成面试题与反馈，不留存、不用于训练"

### Fixed
- **Corrected a misleading privacy claim** — the input footer previously said "数据仅本地处理，不上传", which was inaccurate (the résumé is sent server-side to the model for generation). Replaced with an honest statement: "简历仅用于本次面试生成，不留存、不用于训练"

### Changed
- `answer_submitted` `answerLen` now counts non-whitespace characters (consistent with `asrChars`)

---

## [0.5.0] — 2026-06-08

### Added
- **Quality feedback instrumentation (Phase 2)** — 👍/👎 controls on the feedback page to quantify the two second-layer metrics that matter most for an AI product:
  - **反馈认可度 (feedback approval)** — a thumbs rating under each question's feedback and under the cross-question summary ("这份反馈对你有帮助吗？")
  - **追问有用率 (follow-up usefulness)** — for any question that had follow-ups, each follow-up question is listed with its own thumbs rating ("AI 的追问是否切中要害？")
- New `feedback_rated` analytics event with `{ target: "feedback" | "followup", usefulness: 1 | -1, index, followupDepth?, isDemo }`
- Reusable `RatingButtons` component (SVG thumbs, matches the app's icon style)
- Ratings persisted in `InterviewContext` (`ratings` map, keyed e.g. `fb:0` / `fb:summary` / `fu:0:1`) with a `setRating` action

### Changed
- Ratings only fire `feedback_rated` when the value actually changes — refresh (restored ratings) and re-clicking the same choice never double-count, consistent with the v0.4.2 feedback_viewed guard

### Notes
- Analytics queries: 反馈认可度 = ratio of `usefulness=1` where `target='feedback'`; 追问有用率 = same where `target='followup'` (filter `props->>'env'='prod'` and `props->>'isDemo'='false'` for real signal)

---

## [0.4.2] — 2026-06-08

### Fixed
- **Refreshing the feedback page no longer re-generates all feedback** (H1) — feedback results are now persisted in `InterviewContext` (sessionStorage) per thread. On refresh, already-generated feedback is restored and reused; only threads without a cached result are requested. Previously a refresh re-called `/api/generate-feedback` for every question, costing extra LLM spend and making the user wait again
- **`feedback_viewed` is now counted once per interview, not on every refresh** (H3) — guarded by a persisted `feedbackViewedTracked` flag, fixing inflated funnel numbers

### Changed
- `InterviewContext` now owns `feedbacks` (per-thread results) and `feedbackViewedTracked`; both are persisted and reset on `startInterview` / `reset`. New actions: `setFeedbackAt(index, feedback)`, `markFeedbackViewed()`
- `FeedbackStep` reads feedbacks from context instead of local state; mount effect skips threads that already have a cached result and staggers only the requests it actually makes
- `TODO.md` refreshed to reflect actual progress (deploy, loading states, demo data, persistence, PDF export, analytics all done; remaining items reorganized by priority)

---

## [0.4.1] — 2026-06-08

### Added
- **Environment tag on analytics events** — `track()` now auto-injects `env: "prod" | "dev"` into every event's `props`, derived from `process.env.NODE_ENV` (zero-config, inlined at build time). Lets analytics separate real production traffic from local testing: `where props->>'env' = 'prod'`. No call-site changes; no DB migration (stored in existing `props` jsonb).

---

## [0.4.0] — 2026-06-02

### Added
- **Analytics foundation (Phase 1)** — anonymous-ID + self-hosted event sink for measuring the product funnel without an account system
- `src/lib/identity.ts` — anonymous identity: `anonId` (localStorage, persists across visits → returning-user/retention proxy) + `sessionId` (sessionStorage, per-visit → funnel analysis); SSR-guarded, silent-fail in private mode
- `src/lib/analytics.ts` — fire-and-forget `track(event, props)` client; uses `keepalive` to survive page unload; never throws, never sends PII (lengths/scores/durations/flags only)
- `src/lib/db.ts` — isolated Supabase (Postgres) data-access layer; uses server-only `SUPABASE_SERVICE_ROLE_KEY`; graceful no-op when env unset; swap-friendly if backend changes
- `POST /api/track` — validates events with Zod and inserts into Supabase; `GET /api/track` returns per-event counts for dev verification (no PII)
- Funnel instrumentation across the flow: `input_completed`, `questions_generated`, `interview_started`, `answer_submitted`, `followup_triggered`, `interview_completed`, `feedback_viewed`, `feedback_failed`, `report_exported`
- `.env.example` documenting required env vars (`ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`)

### Notes
- New dependency: `@supabase/supabase-js`
- Privacy: analytics events carry only derived metadata — resume / JD / answer raw text is never sent
- Requires a Supabase project + `events` table + service-role key in `.env.local` (see setup steps); without them the app runs fine and tracking is a silent no-op

---

## [0.3.5] — 2026-05-30

### Added
- **PDF export** — "导出报告 PDF" button opens a print-ready HTML document in a new tab containing the full report (all questions, conversation threads, scores, dimension bars, strengths / improvements / dimension details, thinking-time note); user saves as PDF via the browser's print dialog
- `src/lib/generateReport.ts` — standalone HTML template generator; zero new npm dependencies (pure inline styles, system fonts with CJK fallback stack)
- Print hint banner in the generated report guides the user to Ctrl+P / ⌘+P with a one-click "打印 / 保存 PDF" button (hidden when actually printing via `@media print`)
- Export button shows a spinner and "生成中…" label while feedbacks are still loading; disabled until at least one feedback is ready

### Changed
- Export button is now active in demo mode (exports the mock feedback so the feature is always demonstrable)
- Report includes each question's full conversation thread (main Q + all follow-ups) so the PDF is self-contained without needing to open the app

---

## [0.3.4] — 2026-05-30

### Added
- **sessionStorage persistence for interview state** — all user-facing state (step, resume, JD, questions, in-progress exchanges, completed threads, pending follow-up question) is now written to `sessionStorage` on every change and restored on page load; refreshing mid-interview no longer loses answers
- `readSession` / `writeSession` / `clearSession` helpers in `InterviewContext` with SSR guard (`typeof window`) and silent-fail error handling for private-browsing / quota restrictions

### Changed
- `reset()` now calls `clearSession()` so starting a new interview fully wipes the previous session
- `isJudging` is deliberately **not** persisted — it is transient API-call state that cannot be resumed after a refresh; it always resets to `false`

### Notes
- Uses `sessionStorage` (not `localStorage`) — state is scoped to the current browser tab and cleared automatically when the tab is closed, preventing stale data from surfacing in future visits
- Effect ordering in `InterviewProvider` is load-bearing: the save effect is declared **before** the hydration effect so React runs it first on initial mount; at that point `isHydrated.current` is still `false`, so the save is skipped — preventing blank defaults from overwriting a valid stored session before hydration can read it

---

## [0.3.3] — 2026-05-30

### Added
- `src/lib/models.ts` — centralised model routing config; all API routes now import from here instead of hardcoding model strings

### Changed
- **Mixed-model strategy implemented**: `generate-followup` stays on `claude-haiku-4-5` (speed-critical, binary output); `generate-questions` and `generate-feedback` upgraded to `claude-sonnet-4-6` (quality-critical, main deliverable)
- `generate-questions` `max_tokens` reduced from 2048 → 1024 (sonnet is more reliable; 3-question JSON fits easily)
- `generate-feedback` `max_tokens` reduced from 3000 → 2000 (sonnet output is more concise; feedback JSON stays well under 1200 tokens in practice)

---

## [0.3.2] — 2026-05-28

### Changed
- **Feedback page grid now locks all three columns to a fixed `640px` height on `lg+` screens** so they remain visually aligned. Previously the radar (column B) would "sink" vertically because column C's tall content stretched the grid row and the radar's `flex-1 items-center` centered itself in the extra space
- **Column C (维度详情) restructured into "fixed header + scrollable body"** — the "维度详情" title now stays anchored at the top of the card while the bullet content scrolls inside. Replaces the earlier fragile `sticky / -mx-6` approach with a clean two-section flex layout
- **Column A (FeedbackCard) wrapped in a scroll container** with `lg:overflow-y-auto lg:min-h-0` so longer strengths / improvements lists scroll inside the column instead of overflowing the grid
- Column B (radar) given `lg:overflow-hidden` + `min-h-0` so the radar stays neatly framed within its column height and never pushes neighbours

### Notes
- Mobile / small screens (`< lg`) keep the natural stacked layout with no fixed heights — only desktop gets the locked grid

---

## [0.3.1] — 2026-05-28

### Changed
- **Feedback page redesigned from 2-column to 3-column layout (25 : 45 : 30)** — text feedback / radar chart / dimension details are now three independent siblings, giving each region the horizontal space it actually needs. Previously the per-dimension details sat below the radar in a shared right column, which buried the most actionable content
- Radar chart enlarged (`max-w-[400px] → 480px`) and now occupies the full vertical space of the middle column for stronger visual presence
- Dimension detail rows simplified: the redundant purple progress bar is removed; score now reads inline as `沟通能力 (82/100)`, freeing more breathing room for the bullet evidence
- Dimension detail bullets bumped from `text-[12px] → text-[13px]` to match the strengths / improvements bullets in column A — consistent reading rhythm across the page
- `ErrorCard` updated to span 3 columns (was 2) to remain full-width inside the new grid
- New loading skeleton for the dimension details column so the page no longer feels lopsided while feedbacks stream in

---

## [0.3.0] — 2026-05-28

### Added
- **Cross-question summary tab in `FeedbackStep`** — when more than one main question has been completed, a "汇总" tab is shown first by default. It aggregates per-dimension scores via averaging, merges all per-dimension bullet evaluations across questions, and deduplicates strengths / improvements to give the user a single overall capability picture
- **Per-dimension bullet evaluations** — `Feedback.dimensionDetails` now carries 2–3 grounded bullet points for each of the five dimensions (沟通能力 / 技术深度 / 逻辑思维 / 表达清晰度 / 岗位匹配度). Bullets must quote concrete answer fragments or résumé experiences and reference JD requirements — no generic platitudes
- Radar card now renders an interactive per-dimension detail list (dimension name + score + progress bar + bullet evidence) replacing the previous compact 5-column footer

### Changed
- **`/api/generate-feedback` system prompt rewritten**: removed the `modelAnswer` requirement (it was lengthy and pushed the radar below the fold), added strict instructions for the new `dimensionDetails` field, and now requires JD context for the `jobFit` dimension
- `/api/generate-feedback` request schema now requires `jd`; `FeedbackStep` updated to forward `jd` from `InterviewContext`
- `Feedback` type: `modelAnswer` removed; `dimensionDetails: DimensionDetails` added (5 keys mirroring `FeedbackDimensions`, each an array of bullet strings)
- `FeedbackCard` no longer renders the "示范回答" section — the radar chart now appears almost immediately after the page loads, addressing the perceived slowness

### Removed
- "示范回答" module from the feedback page and from the LLM output schema (token cost reduced, generation latency improved)

---

## [0.2.1] — 2026-05-28

### Added
- Prominent "示例数据 · 仅供预览" notice banner at the top of `InterviewStep` (when entered via demo jumper) and `FeedbackStep` (when no real interview has been completed) — explains that the displayed content is mock data and provides a "返回上传 →" CTA back to the input step
- `jumpToStep` action now consumed inside `InterviewStep` and `FeedbackStep` to power the banner's back-to-input button

### Changed
- Clarified the HR / first-time-visitor experience: demo previews are preserved (so reviewers can grasp the product within ~1 minute) but are now unambiguously labelled, preventing the previous risk of HR mistaking mock data for personalised AI output

---

## [0.2.0] — 2026-05-26

### Added
- **Dynamic follow-up interview system** — after each answer the LLM (acting as a senior HRBP) decides in real time whether to probe deeper; up to 3 follow-ups per main question
- New API route `/api/generate-followup` — receives the full conversation thread and JD, returns `{ shouldFollowUp, followUpQuestion? }`
- `Exchange` and `QuestionThread` types in `types/interview.ts` to model multi-round Q&A chains
- Conversation history panel in `InterviewStep` showing all previous exchanges for the current topic
- "AI 判断中" animated overlay while the follow-up decision is in flight
- Follow-up depth badge (e.g. "追问 1") and per-round tip text in the interview UI
- "+N追问" badge on feedback tabs so reviewers see which topics had deeper exploration

### Changed
- Interview flow redesigned from **5 fixed questions → 3 main questions + dynamic follow-ups**
- `InterviewContext` fully refactored: state now tracks `currentMainIndex`, `currentExchanges`, `completedThreads`, `isJudging`, and `pendingFollowUpQuestion` instead of a flat `answers[]` list
- `startInterview` gains an `isDemo: boolean` parameter; demo mode skips all follow-up API calls (zero extra cost)
- `/api/generate-questions` now generates **3** questions (was 5); system prompt updated to request questions with good follow-up potential
- `/api/generate-feedback` input changed from `{ question, transcript }` to `{ mainQuestion, thread[] }` — evaluates the entire conversation chain holistically
- `FeedbackStep` now iterates over `completedThreads` instead of `answers`; each tab covers one main question's full exchange chain
- `InputStep` demo fast-path picks **3** from the preset pool (was 5)
- Progress bar label changed to "主题 X / 共 N 题"

### Fixed
- `advanceToNext` receives `finalExchanges` as a parameter to avoid stale-closure bugs when multiple state updates are batched

---

## [0.1.0] — 2026-05-25

### Added
- Resume + JD input step with drag-and-drop DOCX/TXT upload (mammoth.js parsing)
- `/api/generate-questions` — LLM generates 5 tailored interview questions with Zod validation and retry logic
- Voice recording via Web Speech API (`SpeechRecognition`) with live interim transcript and editable textarea after recording
- Thinking-time and speaking-time tracking per question
- `/api/generate-feedback` — per-question AI feedback with STAR model answer, 5-dimension radar chart, and personalised thinking-time commentary
- `FeedbackStep` with parallel staggered API calls (1.2 s offset), per-question tabs, skeleton loaders, and retry on error
- Browser compatibility warning banner for Safari / Firefox (Web Speech API unsupported)
- Demo fast-path: when both inputs are sample data the app skips the API and picks from a preset question pool
- Demo step-jumper toolbar (fixed bottom bar) for development
