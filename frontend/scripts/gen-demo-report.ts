/**
 * One-off script: generate a demo PDF report HTML and save to /tmp/demo-report.html
 * Run with: npx tsx scripts/gen-demo-report.ts
 */
import fs from "node:fs";
import { generateReportHTML } from "../src/lib/generateReport";
import type { QuestionThread, Feedback } from "../src/types/interview";

// ── Mock data mirroring the app's MOCK_FEEDBACK ──────────────────────────────

const MOCK_FEEDBACK: Feedback = {
  overallScore: 80,
  dimensions: {
    communication: 82,
    technicalDepth: 76,
    logicalThinking: 88,
    clarity: 71,
    jobFit: 84,
  },
  dimensionDetails: {
    communication: [
      "采用「背景—动作—结果」三段式开场，让面试官在 10 秒内就抓到了项目脉络。",
      "在描述协作 OT 算法时使用了大量术语却未做铺垫，对非同领域听众形成理解门槛。",
    ],
    technicalDepth: [
      "提到了「路由代码分割」「IntersectionObserver 懒挂载」「OT 批处理」三层优化方案，体现出体系化的性能优化思路。",
      "未谈及取舍——如懒挂载对滚动体验的副作用，深度可再加强。",
    ],
    logicalThinking: [
      "三层优化按「网络传输 → 渲染层 → 业务层」顺序展开，符合性能分析的标准漏斗。",
      "量化指标完整（2.8 秒 → 0.9 秒、首包 -40%、合并 60% 操作），形成闭环论证。",
    ],
    clarity: [
      "结论先行（「最终首屏降到 0.9 秒」）是亮点，但中间段落信息密度过高。",
      "语速偏快导致关键数据被一带而过，下次可在量化指标前主动停顿 1 秒。",
    ],
    jobFit: [
      "JD 要求「性能优化经验」，候选人正好命中并给出量化成果，匹配度高。",
      "JD 同时要求「复杂状态管理 / 协作编辑」，建议在 OT 算法上展开冲突解决案例。",
    ],
  },
  strengths: [
    "回答采用「背景—动作—结果」三段式，听众容易跟上。",
    "提到了具体的量化指标，可信度高。",
    "使用「我主要做了三件事」，体现了主导意识。",
  ],
  improvements: [
    "介绍技术方案时，可以补充更多权衡与取舍的思考。",
    "部分段落语速偏快，建议在关键结论处刻意停顿。",
    "可以在结尾用一句反问与面试官形成双向交流。",
  ],
  thinkingTimeFeedback: "思考时间约 8 秒，节奏良好。说明你在开口前有清晰的组织意识，这是面试中很好的习惯。",
};

const MOCK_THREADS: QuestionThread[] = [
  {
    mainQuestion: {
      id: "q1",
      text: "请介绍你在 ByteSpark 实习期间最有挑战性的项目，你是如何解决核心技术难题的？",
      category: "项目经历",
      difficulty: "medium",
    },
    exchanges: [
      {
        question: {
          id: "q1",
          text: "请介绍你在 ByteSpark 实习期间最有挑战性的项目，你是如何解决核心技术难题的？",
          category: "项目经历",
          difficulty: "medium",
        },
        answer: {
          questionId: "q1",
          transcript:
            "在 ByteSpark 实习期间，我负责文档编辑器的性能优化专项。当时首屏加载时长达到 2.8 秒，远超产品要求的 1 秒目标。我主要从三个层面入手：第一，将同步路由改为基于路由的代码分割，减少首包体积约 40%；第二，用 IntersectionObserver 实现富文本块的懒挂载，避免一次性渲染大量 DOM；第三，对协作 OT 算法做批处理，将 60% 的小操作合并成批量提交。最终首屏降到 0.9 秒，达成目标，并在团队季度会上作为最佳实践分享。",
          durationSeconds: 85,
          thinkingTimeMs: 8000,
        },
      },
      {
        question: {
          id: "q1_fu1",
          text: "你提到了 OT 算法的批处理，能具体说说批处理的触发时机和合并策略是怎么设计的吗？",
          category: "项目经历",
          difficulty: "hard",
        },
        answer: {
          questionId: "q1_fu1",
          transcript:
            "我们设定了两个触发条件：时间窗口（50ms 内的操作合并为一批）和操作类型相似性（连续的文字插入操作自动合并）。具体实现上用了一个队列缓冲，每次操作先入队，50ms 后统一发送。对于光标移动这类高频但低价值的操作，我们直接丢弃中间帧，只保留最新位置。这样大约降低了 60% 的 WebSocket 消息量。",
          durationSeconds: 52,
          thinkingTimeMs: 4000,
        },
      },
    ],
  },
  {
    mainQuestion: {
      id: "q2",
      text: "如果要设计一个支持多人实时协作的白板应用，你会如何考虑前端架构和状态同步方案？",
      category: "系统设计",
      difficulty: "hard",
    },
    exchanges: [
      {
        question: {
          id: "q2",
          text: "如果要设计一个支持多人实时协作的白板应用，你会如何考虑前端架构和状态同步方案？",
          category: "系统设计",
          difficulty: "hard",
        },
        answer: {
          questionId: "q2",
          transcript:
            "我会选择 CRDT（无冲突复制数据类型）而不是 OT，主要原因是 CRDT 不需要中央服务器做 transform，可以去中心化。前端架构上，本地状态用 Zustand 管理，底层 CRDT 用 Yjs 库。网络层用 WebSocket 做实时同步，同时加一个 IndexedDB 做本地持久化，支持离线编辑后再合并。渲染层用 Canvas 而不是 DOM，因为白板元素数量可能很多，Canvas 性能更好。",
          durationSeconds: 78,
          thinkingTimeMs: 12000,
        },
      },
    ],
  },
  {
    mainQuestion: {
      id: "q3",
      text: "请解释 React 中 useCallback 与 useMemo 的区别，以及各自适用的场景。",
      category: "基础知识",
      difficulty: "easy",
    },
    exchanges: [
      {
        question: {
          id: "q3",
          text: "请解释 React 中 useCallback 与 useMemo 的区别，以及各自适用的场景。",
          category: "基础知识",
          difficulty: "easy",
        },
        answer: {
          questionId: "q3",
          transcript:
            "useCallback 缓存的是函数引用，useMemo 缓存的是计算结果。useCallback 主要用在将函数传给子组件时，避免子组件因为父组件重渲染而不必要地重渲染——前提是子组件用了 React.memo。useMemo 则用在计算开销较大的场景，比如对大数组做过滤或排序。不过我实际项目里发现，过早优化反而增加复杂度，一般先用 React DevTools 的 Profiler 确认确实有性能问题，再决定是否加这两个 hook。",
          durationSeconds: 60,
          thinkingTimeMs: 5000,
        },
      },
    ],
  },
];

const MOCK_FEEDBACKS: Feedback[] = [MOCK_FEEDBACK, MOCK_FEEDBACK, MOCK_FEEDBACK];

// ── Generate and save ─────────────────────────────────────────────────────────

const html = generateReportHTML(MOCK_THREADS, MOCK_FEEDBACKS, false);
const outPath = "/tmp/ai-interview-demo-report.html";
fs.writeFileSync(outPath, html, "utf-8");
console.log(`Report saved to: ${outPath}`);
