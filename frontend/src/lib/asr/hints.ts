/**
 * Hotword extraction — the one advantage this product has over a generic
 * transcriber: the résumé and the JD already ARE the candidate's glossary.
 * Code-switched English (「我们用 CRDT 做的冲突消解」) and company/product names
 * are exactly the class of error a word list can fix.
 *
 * Runs CLIENT-SIDE on purpose. The alternative — posting the whole résumé + JD
 * alongside every audio segment — would put dozens of extra copies of the user's
 * PII on the wire and in server memory, to run a pure string function. The route
 * still re-validates count and length; the client is not trusted.
 *
 * The Chinese half is a frequency heuristic with a stoplist, not NLP. That's why
 * `hintCount` is tracked — so its contribution is visible rather than assumed.
 */
import { MAX_HINTS, MAX_HINT_LEN, MAX_HINTS_CHARS } from "./limits";

/** Common English that carries no recognition value. */
const LATIN_STOP = new Set([
  "the", "and", "for", "with", "from", "that", "this", "have", "has", "was",
  "were", "are", "you", "your", "our", "their", "his", "her", "its", "not",
  "but", "all", "any", "can", "will", "would", "should", "could", "may",
  "job", "role", "team", "work", "works", "working", "year", "years", "month",
  "months", "day", "days", "time", "new", "more", "most", "other", "such",
  "who", "how", "why", "what", "when", "where", "which", "about", "into",
  "over", "under", "than", "then", "also", "been", "being", "there", "here",
]);

/**
 * HR / résumé boilerplate. These are the highest-frequency Chinese n-grams in
 * any résumé and would otherwise crowd out every real proper noun.
 */
const CJK_STOP = new Set([
  "负责", "项目", "优化", "团队", "公司", "经验", "能力", "提升", "工作", "参与",
  "完成", "管理", "设计", "开发", "实现", "使用", "进行", "通过", "相关", "以上",
  "熟悉", "掌握", "了解", "精通", "要求", "职责", "岗位", "任职", "包括", "以及",
  "能够", "具备", "良好", "沟通", "协作", "推动", "支持", "分析", "数据", "业务",
  "产品", "用户", "服务", "系统", "平台", "方案", "策略", "内容", "运营", "技术",
  "主导", "搭建", "建设", "落地", "规划", "执行", "跟进", "输出", "复盘", "增长",
  "学历", "本科", "硕士", "专业", "毕业", "院校", "教育", "背景", "简历", "描述",
  "我们", "他们", "自己", "一个", "一些", "这个", "那个", "什么", "如何", "为什么",
  "可以", "需要", "应该", "已经", "正在", "并且", "但是", "因为", "所以", "如果",
]);

const LATIN_RE = /[A-Za-z][A-Za-z0-9+#.]{1,23}/g;

/** Terms mentioned in the question the user is answering right now matter most. */
const QUESTION_BOOST = 100;
const MAX_CJK_HINTS = 8;

function countLatin(text: string, into: Map<string, { hits: number; form: string }>) {
  // Split on separators first so CI/CD and A/B each contribute both halves.
  for (const chunk of text.split(/[/\\|、,，]/)) {
    const found = chunk.match(LATIN_RE);
    if (!found) continue;
    for (const raw of found) {
      const term = raw.replace(/\.+$/, ""); // trailing sentence dot, keep Node.js
      if (term.length < 2 || term.length > MAX_HINT_LEN) continue;
      const key = term.toLowerCase();
      if (LATIN_STOP.has(key)) continue;
      const prev = into.get(key);
      if (prev) {
        prev.hits += 1;
        // Keep the form carrying capitals — "TypeScript" beats "typescript".
        if (/[A-Z]/.test(term) && !/[A-Z]/.test(prev.form)) prev.form = term;
      } else {
        into.set(key, { hits: 1, form: term });
      }
    }
  }
}

/**
 * Chinese terms, taken from delimiter-bounded cells rather than n-grams.
 *
 * Sliding n-grams over prose overwhelmingly produce fragments, not terms: a
 * window crossing 「负责协作白板产品的前端架构」 yields 「负责协作」 and
 * 「产品的前端架」. Feeding non-words to an ASR as hotwords doesn't merely waste
 * budget — it biases recognition toward them, degrading the thing they exist to
 * improve. A maximality filter cleans up some of it and still leaks 「内容策」,
 * 「品牌营销经」, 「与达人投放」.
 *
 * So don't guess at word boundaries — use the ones the writer already supplied.
 * Résumés put proper nouns in delimited lists (「内容策略、达人投放、品牌定位」,
 * 「小红书 & 抖音生态」), so splitting on every non-Chinese character yields those
 * terms exactly, while running prose collapses into over-long cells that are
 * dropped by the length cap. High precision, no heuristics about wordhood.
 */
/**
 * Résumé bullets open with an action verb 「主导实时协作模块」, so the cell is a
 * clause and the term is what follows. Strip one leading verb; a cell that is
 * nothing but the verb (「降到」「基于」) drops out.
 */
const LEAD_VERBS = [
  "负责", "主导", "推动", "搭建", "参与", "完成", "使用", "基于", "实现", "建设",
  "落地", "规划", "执行", "跟进", "输出", "统筹", "对接", "带领", "支撑", "降到",
  "提升", "优化", "熟悉", "掌握", "精通", "了解", "具备", "能够", "擅长",
];

function stripLeadVerb(cell: string): string {
  for (const v of LEAD_VERBS) {
    if (cell.startsWith(v)) return cell.slice(v.length);
  }
  // Single-character auxiliaries that front a requirement 「有复杂状态管理」.
  if (/^[有能会需]/.test(cell)) return cell.slice(1);
  return cell;
}

function countCjk(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const raw of text.split(/[^一-龥]+/)) {
    // Cap at 8 before stripping: longer than that is running prose, not a term.
    if (raw.length < 2 || raw.length > 8) continue;
    const cell = stripLeadVerb(raw);
    if (cell.length < 2) continue; // was only the verb
    if (CJK_STOP.has(cell)) continue;
    counts.set(cell, (counts.get(cell) ?? 0) + 1);
  }
  return counts;
}

export function extractHints(resume: string, jd: string, question: string): string[] {
  if (!resume && !jd && !question) return [];

  const corpus = `${resume}\n${jd}`;
  const q = question.toLowerCase();

  // ── Latin ──
  const latin = new Map<string, { hits: number; form: string }>();
  countLatin(corpus, latin);
  countLatin(question, latin);
  // Array.from, not spread: tsconfig sets no `target`, so Map iteration via
  // spread needs downlevelIteration. Matches how the rest of the codebase does it.
  const latinRanked = Array.from(latin.entries())
    .map(([key, v]) => ({
      term: v.form,
      score: v.hits + (q.includes(key) ? QUESTION_BOOST : 0),
    }))
    .sort((a, b) => b.score - a.score);

  // ── Chinese proper nouns ──
  const cjk = countCjk(corpus);
  const cjkRanked = Array.from(cjk.entries())
    .map(([gram, hits]) => ({
      term: gram,
      score: hits * gram.length + (question.includes(gram) ? QUESTION_BOOST : 0),
    }))
    .sort((a, b) => b.score - a.score);

  // Drop any gram fully contained in a higher-ranked one ("字节跳动" wins over "字节").
  const cjkPicked: string[] = [];
  for (const { term } of cjkRanked) {
    if (cjkPicked.length >= MAX_CJK_HINTS) break;
    if (cjkPicked.some((kept) => kept.includes(term))) continue;
    cjkPicked.push(term);
  }

  // ── Merge under the caps ──
  const out: string[] = [];
  let chars = 0;
  for (const term of [...latinRanked.map((x) => x.term), ...cjkPicked]) {
    if (out.length >= MAX_HINTS) break;
    if (chars + term.length + 1 > MAX_HINTS_CHARS) break;
    out.push(term);
    chars += term.length + 1;
  }
  return out;
}
