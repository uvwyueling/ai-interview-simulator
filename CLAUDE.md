# AI Interview Simulator - Project Constitution

## 项目概述
一个帮助用户练习面试的 AI Demo 应用。
用户上传简历和岗位 JD → AI 生成定制化问题 → 用户语音回答 → AI 给出反馈和可视化评分。

## 技术栈（不可更改）
- 前端框架：Next.js 14 + React + TypeScript
- 样式：Tailwind CSS
- UI 组件：shadcn/ui
- 图表：Recharts
- 语音：Web Speech API（浏览器原生）
- AI 后端：Next.js API Routes + Claude API（通过 Cloud LLM）

## 设计规范（必须严格遵守）
- 主色调：Indigo-600 (#4F46E5) 和 Slate-50 (#F8FAFC)
- 字体：系统默认无衬线字体，标题 font-semibold
- 圆角：统一使用 rounded-lg（8px）
- 间距：使用 Tailwind 标准间距，避免魔法数字
- 布局：最大宽度 max-w-4xl，居中显示

## 代码规范
- 使用函数式 React 组件，不使用 class 组件
- 所有变量和函数必须有 TypeScript 类型
- 错误处理必须使用 try-catch，不能静默失败
- 每个 API 调用必须有加载状态和错误状态 UI

## 文件命名
- 组件：PascalCase（如 InterviewCard.tsx）
- 工具函数：camelCase（如 formatTime.ts）
- 样式常量：UPPER_SNAKE_CASE

## 开发节奏
1. 每次只实现一个功能点
2. 完成后必须运行 npm run build 检查错误
3. 更新 todo.md 标记完成状态