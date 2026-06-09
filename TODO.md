# 开发 TODO 清单

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
- [ ] 7. 移动端适配（当前桌面优先，三步页面待响应式改造）

## Phase 3: 数据与度量 🔄
- [x] 匿名身份 + 自建埋点（lib/identity + analytics + db，POST/GET /api/track → Supabase）
- [x] 漏斗事件埋点（9 个核心事件）+ env 标记（prod/dev 区分）
- [x] 反馈结果持久化（H1：刷新不再重复生成、不再重复花钱；H3：feedback_viewed 每场只计一次）
- [ ] Phase 2 质量埋点：反馈页 👍/👎 评分 → 量化"追问有用率""反馈认可度"（指标体系第二层命脉）
- [ ] 护栏埋点补全：followup_degraded（追问降级率）、转写编辑率（editedChars）、各环节延迟

## 待办池（按优先级）
### 中
- [ ] 移动端适配（见 Phase 2 第 7 项）
- [ ] 隐私声明文案（简历数据用途说明，提升输入转化）
- [ ] "AI 判断中"时刷新的半完成态恢复（避免主问题重复作答）

### 低
- [ ] crypto.randomUUID 非 HTTPS 兜底（防 anonId 为空导致埋点丢失）
- [ ] PDF 简历在线解析（pdf.js）
- [ ] 提示词缓存降本（复用固定 System Prompt）
- [ ] 清理临时脚本 scripts/gen-demo-report.ts（确认是否保留）
