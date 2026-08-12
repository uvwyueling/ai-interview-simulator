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
            它们会被发送给 AI 模型服务商（DeepSeek）以生成内容，
            <span className="font-medium text-slate-800">我们不会存储简历 / JD 原文</span>，
            也不会将其用于模型训练。
          </p>
          <p>文件（TXT / DOCX / PDF）的解析在你的浏览器本地完成。</p>
        </Section>

        <Section title="语音作答">
          <p>
            面试页提供两种语音转文字方式，
            <span className="font-medium text-slate-800">默认是「仅浏览器转写」</span>，
            你可以随时在面试页的「语音设置」中切换。两种方式下，你都可以在提交前手动编辑文字。
          </p>
          <p>
            · <span className="font-medium text-slate-800">仅浏览器转写（默认）</span>：
            识别由浏览器内置的语音服务完成——这意味着音频会由
            <span className="font-medium text-slate-800">浏览器厂商自己的识别服务</span>处理
            （例如 Chrome 会发送给 Google）。我们只接收转写后的文字，
            <span className="font-medium text-slate-800">音频不会发送到本产品的服务器</span>。
          </p>
          <p>
            · <span className="font-medium text-slate-800">高准确转写（可选）</span>：
            在上述基础上，<span className="font-medium text-slate-800">额外</span>把一份压缩后的音频
            发送给高精度识别服务，以便更准确地识别中文里夹杂的英文、数字与专业名词。
            这份音频<span className="font-medium text-slate-800">仅在内存中处理</span>，
            转写完成、失败、超时或被你取消后<span className="font-medium text-slate-800">立即丢弃</span>，
            不写入存储、数据库、日志或错误上报，也不会用于训练。
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

        <Section title="你主动填写的联系方式与反馈">
          <p>
            如果你在反馈页主动填写了<span className="font-medium text-slate-800">联系方式（微信 / 邮箱 / 小红书号）</span>
            或对某条反馈写下的<span className="font-medium text-slate-800">差评原因</span>，
            这些内容会与匿名会话 ID 一起保存到一张独立的表中，
            仅用于我（产品负责人）与你个人沟通、改进本产品，
            <span className="font-medium text-slate-800">不会公开、不会转售、也不会用于 AI 训练</span>。
            这两项都是完全可选的——不填不影响任何功能。
          </p>
        </Section>

        <Section title="我们不做什么">
          <p>
            不需要注册账号 · 不存储简历原文 · 不长期保存音频（仅在内存中处理，转写后立即丢弃） · 不将你的数据用于 AI 训练 · 不向第三方出售数据。
          </p>
        </Section>

        <Section title="第三方服务">
          <p>
            · <span className="font-medium text-slate-800">DeepSeek API</span>：生成面试题与反馈。<br />
            · <span className="font-medium text-slate-800">浏览器内置语音识别服务</span>：语音转文字（Chrome 为 Google 的识别服务）。<br />
            · <span className="font-medium text-slate-800">高精度识别服务</span>：仅在你选择「高准确转写」时使用；供应商确定后会在此列明。<br />
            · <span className="font-medium text-slate-800">Supabase</span>：保存匿名使用统计。<br />
            · <span className="font-medium text-slate-800">Vercel</span>：应用托管。
          </p>
        </Section>

        <p className="text-[12px] text-slate-400 mt-10 pt-6 border-t border-slate-200">
          本产品处于实验 / 内测阶段，功能与本说明可能随时调整。如有疑问，请联系产品负责人(uvwyueling@126.com)
        </p>
      </div>
    </div>
  );
}
