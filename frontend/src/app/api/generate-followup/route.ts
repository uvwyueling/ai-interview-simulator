import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { MODELS, thinkingParam } from "@/lib/models";
import { getLLM } from "@/lib/llmClient";
import { rateLimit, getClientIp } from "@/lib/rateLimit";

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
  // Non-whitespace char count of the most recent answer. Enables softening when
  // the candidate is clearly struggling (B / plan 2a). Optional for backwards
  // compat with older clients — the prompt handles "unknown".
  lastAnswerLen: z.number().int().min(0).optional(),
});

const ResponseSchema = z.object({
  shouldFollowUp: z.boolean(),
  followUpQuestion: z.string().optional(),
});

// ─── Prompt ───────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `你是一位资深面试官（同时具备 HRBP 视角），正在对候选人进行深度面试。你会先根据岗位 JD 判断岗位方向（技术类、产品类、市场/运营类、设计类、职能类等），再据此选择追问的角度与语言。
如无法从 JD 判断岗位方向，就按通用面试官路线追问，避免技术假设。

你的任务：根据候选人对面试问题的回答，判断是否需要进一步追问。

【应该追问的情况】
1. 回答中提到了做法或方案，但没有说明具体实现细节、决策依据或权衡
2. 回答中缺少可验证的结果（没有具体数据、指标或业务影响）
3. 回答过于宏观，未体现候选人本人的贡献与角色
4. 该岗位关键能力的深度或证据尚未被回答充分展示

【不应追问的情况】
1. 候选人已给出充分的细节与量化结果
2. 话题已深入到最细颗粒度，继续追问意义不大
3. 回答已完整覆盖问题核心要求，且展示了清晰的思路

追问要简洁有针对性，聚焦单个问题点，不要追问多个方向。

【上一轮回答很短时的软化规则（当用户消息给出 lastAnswerLen 且 < 30 时）】
候选人很可能卡住了。像有经验的面试官一样"进退有度"：
1. **倾向继续追问**（给候选人一个"接得住"的机会），除非话题真的已到最细颗粒度或候选人明确表示无法回答。
2. 追问的**语气从考察转为引导**：不要连续追问"为什么/如何"这类抽象问题；换更具体、更好接的角度（问一个具体动作、场景、感受、或最直觉的想法）。
3. 追问的**题干里主动给 1–2 个方向作脚手架**，例如 "比如可以从 A 或 B 这两个角度入手"。这不是给答案，而是把入口打开。
4. 保持简洁——软化不等于变啰嗦。

输出格式（严格 JSON，不包含任何其他文字或 markdown）：
- 如需追问：{"shouldFollowUp": true, "followUpQuestion": "具体追问内容"}
- 不需追问：{"shouldFollowUp": false}`;

// ─── LLM call with retry ──────────────────────────────────────────────────────

async function callWithRetry(userMessage: string, maxAttempts = 2) {
  let lastError: Error = new Error("未知错误");

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const message = await getLLM().messages.create({
        // Thinking mode is on here (per routing) — raise max_tokens well above
        // budget_tokens so reasoning + the small JSON answer aren't truncated.
        model: MODELS.followup.id,
        max_tokens: 4096,
        thinking: thinkingParam(MODELS.followup.thinking),
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
  const rl = rateLimit(`llm:${getClientIp(request)}`, 40, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "请求过于频繁，请稍后再试" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

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

  const { mainQuestion, conversationThread, jd, lastAnswerLen } = parseResult.data;

  const threadText = conversationThread
    .map(
      (t, i) =>
        `第 ${i + 1} 轮${i > 0 ? "（追问）" : "（主问题）"}\n问：${t.question}\n答：${t.answer}`
    )
    .join("\n\n");

  const lastAnswerLine =
    lastAnswerLen !== undefined ? `\n\n【lastAnswerLen】${lastAnswerLen}` : "";
  const userMessage = `【主面试问题】\n${mainQuestion}\n\n【岗位 JD 方向】\n${jd}\n\n【完整对话记录】\n${threadText}${lastAnswerLine}`;

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
