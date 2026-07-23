import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { MODELS, thinkingParam } from "@/lib/models";
import { getLLM } from "@/lib/llmClient";
import { rateLimit, getClientIp } from "@/lib/rateLimit";

const RequestSchema = z.object({
  resume: z.string().min(1, "简历内容不能为空"),
  jd: z.string().min(1, "岗位描述不能为空"),
});

const QuestionSchema = z.object({
  id: z.string(),
  text: z.string(),
  category: z.string(),
  difficulty: z.enum(["easy", "medium", "hard"]),
});

const ResponseSchema = z.object({
  questions: z.array(QuestionSchema).length(3),
});

export type Question = z.infer<typeof QuestionSchema>;
export type GenerateQuestionsResponse = z.infer<typeof ResponseSchema>;

const SYSTEM_PROMPT = `你是一位拥有 10 年经验的资深面试官，你会先根据岗位 JD 判断岗位方向（技术类、产品类、市场/运营类、设计类、职能类等），再据此挑选合适的考察角度。
如无法从 JD 判断岗位方向（例如 JD 过于笼统），就按通用面试官路线出题，避免技术假设。
根据候选人的简历和岗位 JD，生成 3 个深度定制的主面试问题。

这 3 道题将进行追问式深度面试：每道题回答后，AI 面试官会根据回答内容决定是否进一步追问（最多 3 次追问），以挖掘候选人的真实能力深度。因此这 3 道主问题应具备足够的延展空间。

要求：
1. 第 1 题：针对简历中最亮眼的项目/经历，考察具体做法与决策
2. 第 2 题：考察 JD 核心能力（该岗位的关键专业能力），有足够追问空间
3. 第 3 题：行为面试或岗位匹配度，考察软实力与职业成熟度
4. category 必须是以下之一：技术深度、项目经历、系统设计、行为面试、基础知识（可结合岗位灵活映射：技术岗常用「技术深度/系统设计」；非技术岗常用「项目经历/行为面试」）
5. difficulty 必须是以下之一：easy、medium、hard

严格按照以下 JSON 格式输出，不要包含任何其他文字、注释或 markdown 标记：
{
  "questions": [
    {
      "id": "q1",
      "text": "问题文本",
      "category": "项目经历",
      "difficulty": "medium"
    }
  ]
}`;

async function callWithRetry(userMessage: string, maxAttempts = 3) {
  let lastError: Error = new Error("未知错误");

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const message = await getLLM().messages.create({
        model: MODELS.questions.id,
        max_tokens: 1024,
        thinking: thinkingParam(MODELS.questions.thinking),
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      });

      const textBlock = message.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("响应中没有文本内容");
      }

      const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("响应中未找到 JSON 结构");

      const parsed: unknown = JSON.parse(jsonMatch[0]);
      const validated = ResponseSchema.safeParse(parsed);
      if (!validated.success) {
        const issues = validated.error.issues.map((i) => i.message).join(", ");
        throw new Error(`JSON 结构不符合预期：${issues}`);
      }

      return validated.data;
    } catch (err) {
      if (err instanceof Anthropic.APIError) throw err;

      lastError = err instanceof Error ? err : new Error(String(err));
      console.error(`[generate-questions] attempt ${attempt}/${maxAttempts} failed:`, lastError.message);

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

  const { resume, jd } = parseResult.data;
  const userMessage = `【候选人简历】\n${resume}\n\n【岗位描述 JD】\n${jd}`;

  try {
    const data = await callWithRetry(userMessage);
    return NextResponse.json(data);
  } catch (err) {
    console.error("[generate-questions] final error:", err);

    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "请求过于频繁，请稍后重试" }, { status: 429 });
    }
    if (err instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: "AI 服务配置错误，请联系管理员" }, { status: 500 });
    }
    if (err instanceof Anthropic.APIError) {
      return NextResponse.json({ error: "AI 服务暂时不可用，请稍后重试" }, { status: 502 });
    }
    return NextResponse.json({ error: "生成问题时发生错误，请稍后重试" }, { status: 500 });
  }
}
