# AI Interview Simulator - Project Constitution

## 项目概述
AI 面试模拟器 Demo。用户上传简历+JD → AI 生成问题 → 语音回答 → AI 反馈+可视化评分。

## 技术栈
- Next.js 14 + React + TypeScript + Tailwind + shadcn/ui + Recharts
- 语音：Web Speech API
- AI：Next.js API Routes + DeepSeek（经其 Anthropic 兼容端点 https://api.deepseek.com/anthropic 调用，仍用 @anthropic-ai/sdk）。v0.9.0 起由 Claude 迁移至 DeepSeek（账单自管可见）。模型路由见 src/lib/models.ts

## 设计规范（必须遵守）
- 主色：Indigo-600, 辅色：Slate-50
- 圆角：rounded-lg, 最大宽度：max-w-4xl
- 字体：系统默认无衬线，标题 font-semibold

## 代码规范（3 条红线）
1. **所有变量必须有 TypeScript 类型** —— 防止运行时崩溃
2. **所有 API 调用必须有 try-catch + loading/error UI** —— 防止用户看到白屏
3. **所有 AI 输出必须用 Zod 验证** —— 防止 JSON 解析失败

## PEV 工作流（Plan-Execute-Verify）
每次任务必须：
1. **Plan**：列出输入/输出/错误场景
2. **Execute**：写代码
3. **Verify**：运行 `npm run build`，失败则修复直到通过
4. **完成**：更新 TODO.md
5. **版本日志**：在 `CHANGELOG.md` 顶部追加本次变更，遵循 Keep a Changelog 格式（Added / Changed / Fixed 分节）；同步更新 `frontend/package.json` 的版本号（新功能 → minor，Bug 修复 → patch，破坏性变更 → major）

## 禁止事项
- 硬编码 API 密钥
- 跳过 build 直接标记完成
- 返回原始错误给用户（必须包装为友好提示）
