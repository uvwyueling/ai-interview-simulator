import Link from "next/link";

export const metadata = {
  title: "隐私与数据说明 · Echo Interview",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-[16px] font-semibold text-slate-900 mb-2">{title}</h2>
      <div className="text-[14px] text-slate-600 leading-relaxed space-y-2">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-canvas">
      <div className="max-w-2xl mx-auto px-6 py-12">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-indigo-600 transition mb-8"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          返回
        </Link>

        <h1 className="text-[26px] font-semibold tracking-tight text-slate-900 mb-1">
          隐私与数据说明
        </h1>
        <p className="text-[13px] text-slate-400 mb-8">
          Echo Interview · AI 模拟面试官（实验性内测产品）
        </p>

        <Section title="我们如何使用你的简历与 JD">
          <p>
            你上传的简历和岗位 JD，仅用于<span className="font-medium text-slate-800">本次面试题目与反馈的生成</span>：
            它们会被发送给 AI 模型服务商（Anthropic Claude）以生成内容，
            <span className="font-medium text-slate-800">我们不会存储简历 / JD 原文</span>，
            也不会将其用于模型训练。
          </p>
          <p>文件（TXT / DOCX / PDF）的解析在你的浏览器本地完成。</p>
        </Section>

        <Section title="语音作答">
          <p>
            语音转文字由浏览器内置的语音识别服务完成（如 Chrome 使用其自带的识别服务）。
            我们只接收转写后的<span className="font-medium text-slate-800">文字</span>，不录制、不上传你的音频。
            你可以在提交前手动编辑这些文字。
          </p>
        </Section>

        <Section title="匿名使用统计">
          <p>
            为持续改进产品，我们会收集<span className="font-medium text-slate-800">匿名的使用数据</span>——
            例如各步骤的完成情况、各环节耗时、对反馈的评分（👍/👎）等。
            这些数据<span className="font-medium text-slate-800">不包含你的简历、JD 或回答原文</span>，
            仅关联到一个随机生成的、存于你浏览器的匿名标识，
            并保存在我们的数据服务（Supabase）中。
          </p>
        </Section>

        <Section title="我们不做什么">
          <p>
            不需要注册账号 · 不存储简历原文 · 不录制音频 · 不将你的数据用于 AI 训练 · 不向第三方出售数据。
          </p>
        </Section>

        <Section title="第三方服务">
          <p>
            · <span className="font-medium text-slate-800">Anthropic（Claude API）</span>：生成面试题与反馈。<br />
            · <span className="font-medium text-slate-800">Supabase</span>：保存匿名使用统计。<br />
            · <span className="font-medium text-slate-800">Vercel</span>：应用托管。
          </p>
        </Section>

        <p className="text-[12px] text-slate-400 mt-10 pt-6 border-t border-slate-200">
          本产品处于实验 / 内测阶段，功能与本说明可能随时调整。如有疑问，请联系产品负责人。
        </p>
      </div>
    </div>
  );
}
