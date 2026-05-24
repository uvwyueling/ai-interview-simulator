import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

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
  questions: z.array(QuestionSchema).length(5),
});

export type Question = z.infer<typeof QuestionSchema>;
export type GenerateQuestionsResponse = z.infer<typeof ResponseSchema>;

const client = new Anthropic();

const SYSTEM_PROMPT = `你是一位拥有 10 年经验的资深技术面试官。
根据候选人的简历和岗位 JD，生成 5 个深度定制的面试问题。

要求：
1. 至少 2 个问题针对简历中的具体项目经历，要追问实现细节和技术决策
2. 至少 2 个问题考察 JD 中明确要求的核心技能
3. 问题要有梯度，覆盖不同难度
4. category 必须是以下之一：技术深度、项目经历、系统设计、行为面试、基础知识
5. difficulty 必须是以下之一：easy、medium、hard

严格按照以下 JSON 格式输出，不要包含任何其他文字、注释或 markdown 标记：
{
  "questions": [
    {
      "id": "q1",
      "text": "问题文本",
      "category": "技术深度",
      "difficulty": "medium"
    }
  ]
}`;

async function callWithRetry(userMessage: string, maxAttempts = 3) {
  let lastError: Error = new Error("未知错误");

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const message = await client.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 2048,
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
