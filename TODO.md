# 开发 TODO 清单

## Phase 1: 核心功能骨架
- [x] 1. 创建简历和 JD 输入页面（InputStep.tsx，含拖拽上传和示例数据）
- [x] 2. 集成 Cloud LLM 生成面试问题（/api/generate-questions，Zod 验证，已测试）
- [x] 3. 实现语音输入和计时功能（useVoiceRecorder hook + VoiceRecorder 组件，思考时间/回答时长计时）
- [x] 4. 实现 AI 反馈和可视化评分
  - [x] 后端：/api/generate-feedback（含重试逻辑、思考时间个性化反馈、简历定制示范回答）
  - [x] 前端：FeedbackStep 接入真实 API（并行获取每道题反馈，问题切换 Tab）
  - [x] 前端：InterviewStep 收集真实答案并传递给 FeedbackStep（React Context 全局状态 + 进度条）
- [x] 追问式面试流程（3 主问题 + 最多 3 次动态追问，Demo 模式跳过追问）
  - [x] 新增 /api/generate-followup（LLM 判断是否需要追问）
  - [x] 重构 InterviewContext（QuestionThread / Exchange 类型，advanceToNext 原子操作）
  - [x] 重构 InterviewStep（追问历史展示、AI 判断加载态、最大追问数限制）
  - [x] 重构 FeedbackStep（基于 completedThreads，每主题综合评分含追问链）
  - [x] 更新 /api/generate-feedback 接受对话 thread
  - [x] 更新 /api/generate-questions 生成 3 题
- [ ] 5. 部署到 Vercel

## Phase 2: 打磨体验
- [ ] 6. 添加加载动画和错误处理
- [ ] 7. 优化移动端适配
- [ ] 8. 添加示例数据方便演示
