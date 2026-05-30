import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { MODELS } from "@/lib/models";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const RequestSchema = z.object({
  mainQuestion: z.string().min(1, "主问题不能为空"),
  conversationThread: z
    .array(
      z.object({
        question: z.string().min(1),
        answer: z.string().min(1),
      })
    )
    .min(1, "对话记录不能为空"),
  jd: z.string().min(1, "岗位描述不能为空"),
  resume: z.string().min(1, "简历不能为空"),
});

const ResponseSchema = z.object({
  shouldFollowUp: z.boolean(),
  followUpQuestion: z.string().optional(),
});

// ─── Prompt ───────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `你是一位资深技术面试官（同时具备 HRBP 视角），正在对候选人进行深度面试。

你的任务：根据候选人对面试问题的回答，判断是否需要进一步追问。

【应该追问的情况】
1. 回答中提到了技术方案，但没有说明具体实现细节或技术选型理由
2. 回答中缺少量化结果（没有具体数据、指标或业务影响）
3. 回答过于宏观，未体现候选人的个人贡献与角色
4. 存在明显的技术知识盲区需要验证

【不应追问的情况】
1. 候选人已给出充分的技术细节与量化结果
2. 话题已深入到最细颗粒度，继续追问意义不大
3. 回答已完整覆盖问题核心要求，且展示了清晰的思路

追问要简洁有针对性，聚焦单个问题点，不要追问多个方向。

输出格式（严格 JSON，不包含任何其他文字或 markdown）：
- 如需追问：{"shouldFollowUp": true, "followUpQuestion": "具体追问内容"}
- 不需追问：{"shouldFollowUp": false}`;

// ─── LLM call with retry ──────────────────────────────────────────────────────

const client = new Anthropic();

async function callWithRetry(userMessage: string, maxAttempts = 2) {
  let lastError: Error = new Error("未知错误");

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const message = await client.messages.create({
        model: MODELS.lightweight,
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      });

      const textBlock = message.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") throw new Error("无文本内容");

      const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("未找到 JSON 结构");

      const parsed: unknown = JSON.parse(jsonMatch[0]);
      const validated = ResponseSchema.safeParse(parsed);
      if (!validated.success) throw new Error("JSON 格式不符合预期");

      return validated.data;
    } catch (err) {
      if (err instanceof Anthropic.APIError) throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
      console.error(
        `[generate-followup] attempt ${attempt}/${maxAttempts} failed:`,
        lastError.message
      );
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 600));
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
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const parseResult = RequestSchema.safeParse(body);
  if (!parseResult.success) {
    const messages = parseResult.error.issues.map((e) => e.message).join("; ");
    return NextResponse.json({ error: messages }, { status: 400 });
  }

  const { mainQuestion, conversationThread, jd } = parseResult.data;

  const threadText = conversationThread
    .map(
      (t, i) =>
        `第 ${i + 1} 轮${i > 0 ? "（追问）" : "（主问题）"}\n问：${t.question}\n答：${t.answer}`
    )
    .join("\n\n");

  const userMessage = `【主面试问题】\n${mainQuestion}\n\n【岗位 JD 方向】\n${jd}\n\n【完整对话记录】\n${threadText}`;

  try {
    const result = await callWithRetry(userMessage);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[generate-followup] final error:", err);

    if (err instanceof Anthropic.RateLimitError) {
      // On rate limit, default to not following up (safe fallback)
      return NextResponse.json({ shouldFollowUp: false });
    }
    if (err instanceof Anthropic.APIError) {
      return NextResponse.json({ shouldFollowUp: false });
    }
    // Any other error: safe default to advance
    return NextResponse.json({ shouldFollowUp: false });
  }
}
