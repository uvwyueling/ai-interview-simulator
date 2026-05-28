import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const RequestSchema = z.object({
  mainQuestion: z.string().min(1, "主问题不能为空"),
  thread: z
    .array(
      z.object({
        question: z.string().min(1),
        answer: z.string().min(1),
      })
    )
    .min(1, "对话记录不能为空"),
  resume: z.string().min(1, "简历不能为空"),
  jd: z.string().min(1, "岗位描述不能为空"),
  thinkingTime: z.number().min(0),
  speakingTime: z.number().min(0),
});

const DimensionBullets = z.array(z.string().min(1)).min(2).max(3);

const FeedbackSchema = z.object({
  overallScore: z.number().int().min(0).max(100),
  dimensions: z.object({
    communication: z.number().int().min(0).max(100),
    technicalDepth: z.number().int().min(0).max(100),
    logicalThinking: z.number().int().min(0).max(100),
    clarity: z.number().int().min(0).max(100),
    jobFit: z.number().int().min(0).max(100),
  }),
  dimensionDetails: z.object({
    communication: DimensionBullets,
    technicalDepth: DimensionBullets,
    logicalThinking: DimensionBullets,
    clarity: DimensionBullets,
    jobFit: DimensionBullets,
  }),
  strengths: z.array(z.string().min(1)).min(1).max(5),
  improvements: z.array(z.string().min(1)).min(1).max(5),
  thinkingTimeFeedback: z.string().min(1),
});

export type Feedback = z.infer<typeof FeedbackSchema>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function thinkingTimeGuidance(ms: number): string {
  const s = ms / 1000;
  if (s < 3) {
    return "思考时间不足 3 秒，说明候选人可能过于仓促。请在 thinkingTimeFeedback 中温和地指出，面试时可以先说「让我想一下」争取思考空间，不必急于开口。";
  }
  if (s > 15) {
    return `思考时间长达 ${s.toFixed(0)} 秒，超过 15 秒。请在 thinkingTimeFeedback 中建议候选人可以边整理思路边开口，用「我先从…说起」这类开场白引导面试官等待，避免长时间沉默。`;
  }
  return `思考时间 ${s.toFixed(1)} 秒，节奏良好。请在 thinkingTimeFeedback 中给予积极肯定。`;
}

function buildSystemPrompt(thinkingTimeMs: number, speakingTimeMs: number): string {
  const speakingSec = (speakingTimeMs / 1000).toFixed(0);
  return `你是一位拥有 10 年经验的资深技术面试官，正在对候选人的整轮面试作答（含追问环节）进行综合评估。

【计时数据】
- ${thinkingTimeGuidance(thinkingTimeMs)}
- 候选人本题总回答时长：${speakingSec} 秒（含所有追问回合）

【评分说明】
对话记录可能包含主问题和多轮追问，请综合评估整个对话，而非单独评价某一轮回答。

【评分维度定义】
- communication（沟通能力）：表达流畅性、语言组织能力
- technicalDepth（技术深度）：技术细节充分程度、是否展现深度思考
- logicalThinking（逻辑思维）：回答结构合理性、推理严谨性
- clarity（表达清晰度）：重点是否突出、是否简洁有力
- jobFit（岗位匹配度）：回答是否契合岗位核心要求

【dimensionDetails 要求】★ 重要
不要写空洞通用语（如"沟通流畅、表达清晰"），必须**援引候选人的具体回答片段或简历经历**作为证据，并指出与 JD 的对应关系。

每个维度输出 2–3 条 bullet（每条 25–60 字），覆盖以下角度任选其二：
1. 这一维度上候选人**做得好的具体行为或表达**（引用回答中的关键句/技术名词/项目细节）
2. 这一维度上**暴露出的不足**（哪一句、哪个环节本可以更好）
3. 结合 JD 要求**给出具体可执行的改进动作**（不是空泛的"加强沟通"，而是"下次可以在介绍架构前用一句话定位读者，例如…"）

【输出格式】
严格输出以下 JSON，不要包含任何其他文字、注释或 markdown 标记：
{
  "overallScore": <0-100 整数>,
  "dimensions": {
    "communication": <0-100 整数>,
    "technicalDepth": <0-100 整数>,
    "logicalThinking": <0-100 整数>,
    "clarity": <0-100 整数>,
    "jobFit": <0-100 整数>
  },
  "dimensionDetails": {
    "communication": ["针对沟通能力的具体评价1（援引回答证据）", "针对沟通能力的具体评价2"],
    "technicalDepth": ["针对技术深度的具体评价1", "针对技术深度的具体评价2"],
    "logicalThinking": ["针对逻辑思维的具体评价1", "针对逻辑思维的具体评价2"],
    "clarity": ["针对表达清晰度的具体评价1", "针对表达清晰度的具体评价2"],
    "jobFit": ["针对岗位匹配度的具体评价1（结合 JD）", "针对岗位匹配度的具体评价2"]
  },
  "strengths": ["具体优点1", "具体优点2"],
  "improvements": ["具体改进建议1", "具体改进建议2"],
  "thinkingTimeFeedback": "关于思考节奏的个性化反馈..."
}`;
}

// ─── Core LLM call with retry ─────────────────────────────────────────────────

const client = new Anthropic();

async function callWithRetry(
  systemPrompt: string,
  userMessage: string,
  maxAttempts: number = 3
): Promise<Feedback> {
  let lastError: Error = new Error("未知错误");

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await client.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 3000,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      });

      if (response.stop_reason === "max_tokens") {
        throw new Error("响应被截断（输出超出长度限制），请重试");
      }

      const textBlock = response.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("响应中没有文本内容");
      }

      const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error("[generate-feedback] no JSON found in:", textBlock.text.slice(0, 300));
        throw new Error("响应中未找到 JSON 结构");
      }

      const parsed: unknown = JSON.parse(jsonMatch[0]);
      const validated = FeedbackSchema.safeParse(parsed);

      if (!validated.success) {
        const issues = validated.error.issues.map((i) => i.message).join(", ");
        throw new Error(`JSON 结构不符合预期：${issues}`);
      }

      return validated.data;
    } catch (err) {
      if (err instanceof Anthropic.APIError) throw err;

      lastError = err instanceof Error ? err : new Error(String(err));
      console.error(`[generate-feedback] attempt ${attempt}/${maxAttempts} failed:`, lastError.message);

      const msg = lastError.message.toLowerCase();
      if (msg.includes("authentication") || msg.includes("apikey") || msg.includes("authtoken")) {
        throw lastError;
      }

      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 600 * attempt));
      }
    }
  }

  throw lastError;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "请求格式错误，请发送有效的 JSON 数据" },
      { status: 400 }
    );
  }

  const parseResult = RequestSchema.safeParse(body);
  if (!parseResult.success) {
    const messages = parseResult.error.issues.map((e) => e.message).join("; ");
    return NextResponse.json({ error: messages }, { status: 400 });
  }

  const { mainQuestion, thread, thinkingTime, speakingTime, resume, jd } = parseResult.data;

  const threadText = thread
    .map(
      (t, i) =>
        `【第 ${i + 1} 轮${i === 0 ? "（主问题）" : "（追问）"}】\n问：${t.question}\n答：${t.answer}`
    )
    .join("\n\n");

  const systemPrompt = buildSystemPrompt(thinkingTime, speakingTime);
  const userMessage = `【主面试问题】\n${mainQuestion}\n\n【完整对话记录（含追问）】\n${threadText}\n\n【候选人简历】\n${resume}\n\n【岗位 JD】\n${jd}`;

  try {
    const feedback = await callWithRetry(systemPrompt, userMessage);
    return NextResponse.json(feedback);
  } catch (err) {
    console.error("[generate-feedback] final error:", err);

    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json(
        { error: "请求过于频繁，请稍后重试" },
        { status: 429 }
      );
    }
    if (err instanceof Anthropic.AuthenticationError) {
      return NextResponse.json(
        { error: "AI 服务配置错误，请联系管理员" },
        { status: 500 }
      );
    }
    if (err instanceof Anthropic.APIError) {
      return NextResponse.json(
        { error: "AI 服务暂时不可用，请稍后重试" },
        { status: 502 }
      );
    }
    const msg = err instanceof Error ? err.message.toLowerCase() : "";
    if (msg.includes("authentication") || msg.includes("apikey") || msg.includes("authtoken")) {
      return NextResponse.json(
        { error: "AI 服务配置错误，请联系管理员" },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { error: "生成反馈时发生错误，请稍后重试" },
      { status: 500 }
    );
  }
}
