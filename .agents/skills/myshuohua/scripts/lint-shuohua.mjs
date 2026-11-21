#!/usr/bin/env node
// 中文词句的机械检查。零依赖，够用就好。
//
//   node .agents/skills/myshuohua/scripts/lint-shuohua.mjs README.md docs
//   node .agents/skills/myshuohua/scripts/lint-shuohua.mjs --strict .
//   node .agents/skills/myshuohua/scripts/lint-shuohua.mjs --json .
//   node .agents/skills/myshuohua/scripts/lint-shuohua.mjs --glossary docs/wording-terms.json README.md
//   node .agents/skills/myshuohua/scripts/lint-shuohua.mjs --rules
//
// 退出码：0 干净，1 有 error（或 --strict 下有 warning），2 用法或读文件出错。
//
// 机械规则检查分号、句长、段落、完整句重复、固定短语和项目首选术语。
// 词用得对不对、句子骨架立不立得住，归 SKILL.md 和 references/。
// 内容和文件的对应关系不在这里，那是 mydocs 的 lint-docs.mjs（同在各自 skill 的 scripts/ 下）。

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// rules.json 与检查器不同层：脚本在 scripts/，规则在 skill 根。
const CONFIG = JSON.parse(readFileSync(join(HERE, '..', 'rules.json'), 'utf8'));
const RULE = new Map(CONFIG.rules.map((rule) => [rule.id, rule]));

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'vendor', 'testplace',
  '.venv', '__pycache__', 'target', '.next', 'bin', 'obj', 'coverage',
]);

const args = process.argv.slice(2);
if (args.includes('--rules')) {
  for (const rule of CONFIG.rules) console.log(`${rule.level.padEnd(8)} ${rule.id}\n         ${rule.why}`);
  process.exit(0);
}
if (args.includes('--help') || args.includes('-h')) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 14).join('\n').replace(/^\/\/ ?/gm, ''));
  process.exit(0);
}


const strict = args.includes('--strict');
const asJson = args.includes('--json');
const glossaryIndex = args.indexOf('--glossary');
let glossaryTerms = [];
if (glossaryIndex !== -1) {
  const path = args[glossaryIndex + 1];
  if (!path || path.startsWith('-')) {
    console.error('--glossary 需要 JSON 文件路径。');
    process.exit(2);
  }
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(data.terms) || data.terms.some((term) =>
      !term || typeof term.preferred !== 'string' || !term.preferred.trim()
      || !Array.isArray(term.avoid) || !term.avoid.length
      || term.avoid.some((variant) => typeof variant !== 'string'
        || !variant.trim() || variant === term.preferred))) {
      throw new Error('应为 { "terms": [{ "preferred": "首选词", "avoid": ["替代词"] }] }');
    }
    glossaryTerms = data.terms;
  } catch (error) {
    console.error('无法读取项目术语表 ' + path + '：' + error.message);
    process.exit(2);
  }
}
const targets = args.filter((arg, index) => !arg.startsWith('-') && (glossaryIndex < 0 || index !== glossaryIndex + 1));

function collect(target, out = []) {
  const stat = statSync(target);
  if (stat.isDirectory()) {
    for (const name of readdirSync(target)) {
      if (SKIP_DIRS.has(name)) continue;
      collect(join(target, name), out);
    }
  } else if (/\.(md|markdown)$/i.test(target)) {
    out.push(target);
  }
  return out;
}

// 把不该检查的东西换成等长空格，行号和列号就不会漂。代码里的分号、链接地址、HTML 都不算正文。
function mask(lines) {
  let fenced = false;
  let marker = '';
  return lines.map((line) => {
    const open = line.trimStart().match(/^(```+|~~~+)/);
    if (fenced) {
      if (open && open[1][0] === marker) fenced = false;
      return ' '.repeat(line.length);
    }
    if (open) {
      fenced = true;
      marker = open[1][0];
      return ' '.repeat(line.length);
    }
    return line
      // 徽章是图片，alt 和 URL 都不是正文。`[![CI](...)](...)` 这种嵌套要整个遮掉。
      .replace(/!\[[^\]]*\]\([^)]*\)/g, (m) => ' '.repeat(m.length))
      .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, (m) => ' '.repeat(m.length))
      .replace(/`[^`]*`/g, (m) => ' '.repeat(m.length))
      .replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length))
      .replace(/<[^>]+>/g, (m) => ' '.repeat(m.length))
      .replace(/\]\([^)]*\)/g, (m) => ' '.repeat(m.length))
      .replace(/https?:\/\/\S+/g, (m) => ' '.repeat(m.length));
  });
}

const SIZE = (text) => text.replace(/[\s*_`]/g, '').length;
// 有序列表也是列表。把它当正文，一个五步的部署清单会被算成一段 270 字的段落。
const isBullet = (line) => /^\s*(?:[-*+]|\d+[.)])\s+/.test(line);
const isTable = (line) => /^\s*\|/.test(line);

function sentences(line) {
  return line
    .split(/[。！？!?]+/)
    .map((part) => part.trim())
    .filter((part) => SIZE(part) > 3);
}

// 句长按「阅读单位」量，不按标点句量。中文技术文档常写「结论：三条解释」，
// 冒号后面本来就是另一句；把它算进前一句，33 条超长句里有 24 条是这么假出来的。
// bullet 的句数仍用 sentences()，否则一条带冒号的 bullet 会被数成两句。
function readingUnits(line) {
  return line
    .split(/[。！？!?：]+/)
    .map((part) => part.trim())
    .filter((part) => SIZE(part) > 3);
}

const findings = [];
// 文档里要引用坏例子，这类地方得能关掉某条规则。写法：
//   <!-- lint-ignore-file rule -->        整个文件不算这条
//   <!-- lint-disable-next-line rule -->  下一行不算
//   <!-- lint-disable rule --> ... <!-- lint-enable rule -->
let SUPPRESS = { file: new Set(), byLine: new Map() };

function suppressions(lines) {
  const file = new Set();
  const byLine = new Map();
  let open = new Set();
  lines.forEach((raw, index) => {
    const line = index + 1;
    if (open.size) byLine.set(line, new Set([...(byLine.get(line) ?? []), ...open]));
    for (const match of raw.matchAll(/<!--\s*lint-(ignore-file|ignore-next-line|disable-next-line|disable|enable)\s+([\w-]+(?:[\s,]+[\w-]+)*?)\s*-->/g)) {
      const ids = match[2].split(/[\s,]+/).filter(Boolean);
      const kind = match[1];
      if (kind === 'ignore-file') ids.forEach((id) => file.add(id));
      else if (kind === 'ignore-next-line' || kind === 'disable-next-line') {
        const next = line + 1;
        byLine.set(next, new Set([...(byLine.get(next) ?? []), ...ids]));
      } else if (kind === 'disable') ids.forEach((id) => open.add(id));
      else ids.forEach((id) => open.delete(id));
    }
  });
  return { file, byLine };
}

const add = (file, lines, rule, text, level, key) => {
  if (SUPPRESS.file.has(rule)) return;
  const candidates = Array.isArray(lines) ? lines : [lines];
  const line = candidates.find((n) => !SUPPRESS.byLine.get(n)?.has(rule));
  if (line === undefined) return;
  // 同一行同一个来源只报一次。一句里叠了三四个坏词时，读者改的是那一句，不是那三个词。
  const dedupe = key ?? rule;
  if (findings.some((item) => item.file === file && item.line === line && item.key === dedupe)) return;
  findings.push({ file, line, rule, key: dedupe, level: level ?? RULE.get(rule).level, text });
};

function checkFile(file, lines) {
  SUPPRESS = suppressions(lines);
  const body = mask(lines);
  const text = body.join('\n');
  const chars = SIZE(text);
  const per1000 = (n) => (chars ? (n * 1000) / chars : 0);
  const stats = { file, chars, semicolons: 0, p90: 0, longest: 0 };
  // 中文和英文的句子不能用一个尺子量。英文一百多个字符只是二十来个词，按中文的阈值全是误报。
  // 所以句长只量含中文的句子；术语大小写只在中文文档里找，英文的正常句首大写不算问题。
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  stats.zh = cjk + latin ? cjk / (cjk + latin) : 1;

  // semicolon-density
  const semicolonLines = [];
  body.forEach((line, index) => {
    const hits = line.match(/；/g);
    if (!hits) return;
    stats.semicolons += hits.length;
    semicolonLines.push(index + 1);
  });
  const density = per1000(stats.semicolons);
  if (density > RULE.get('semicolon-density').max && stats.semicolons > RULE.get('semicolon-density').max) {
    const where = semicolonLines.slice(0, 4).join(', ');
    add(file, semicolonLines, 'semicolon-density',
      `${stats.semicolons} 个分号 / ${(chars / 1000).toFixed(1)} 千字，上限 ${RULE.get('semicolon-density').max}（第 ${where} 行）`);
  }

  // sentence-length
  const lengths = [];
  body.forEach((line, index) => {
    if (!line.trim() || isTable(line)) return;
    for (const sentence of readingUnits(line)) {
      const size = SIZE(sentence);
      const han = (sentence.match(/[\u4e00-\u9fff]/g) ?? []).length;
      if (size < 20 || han / size < 0.2) continue;
      lengths.push(size);
      if (size > RULE.get('sentence-length').max) {
        add(file, index + 1, 'sentence-length', `这一句 ${size} 字，上限 ${RULE.get('sentence-length').max}：${sentence.slice(0, 40)}…`);
      }
    }
  });
  lengths.sort((a, b) => a - b);
  stats.longest = lengths.at(-1) ?? 0;
  stats.p90 = lengths[Math.floor(lengths.length * 0.9)] ?? 0;
  const p90 = RULE.get('sentence-length').p90;
  if (stats.p90 > p90) {
    add(file, 1, 'sentence-length', `句长 p90 ${stats.p90}，上限 ${p90}。整篇的句子偏长，先拆最长的几句`);
  }

  // bullet-sentences
  body.forEach((line, index) => {
    if (!isBullet(line)) return;
    const count = sentences(line).length;
    if (count > RULE.get('bullet-sentences').max) {
      add(file, index + 1, 'bullet-sentences', `这条 bullet 有 ${count} 句，上限 ${RULE.get('bullet-sentences').max}`);
    }
  });

  // paragraph-length：一段里塞了五六个独立事实，读者找不到主干。列表和表格各自成段，不参与。
  const paraRule = RULE.get('paragraph-length');
  if (paraRule) {
    let run = [];
    const flush = () => {
      if (!run.length) return;
      const han = run.reduce((total, item) => total + (item.text.match(/[\u4e00-\u9fff]/g) ?? []).length, 0);
      if (han > paraRule.max) {
        add(file, run[0].line, 'paragraph-length',
          `这一段 ${han} 个汉字，上限 ${paraRule.max}。按「谁 / 做了什么 / 什么条件」分段：${run[0].text.trim().slice(0, 36)}…`);
      }
      run = [];
    };
    body.forEach((line, index) => {
      const trimmed = line.trim();
      const prose = trimmed
        && !trimmed.startsWith('#')
        && !isTable(line)
        && !isBullet(line)
        && !/^[-*_]{3,}$/.test(trimmed)
        && /[\u4e00-\u9fff]/.test(line);
      if (prose) run.push({ line: index + 1, text: line });
      else flush();
    });
    flush();
  }


  // duplicate-sentences：拆段时重复复制了较长的完整句。仅比较正文中的高置信度重复，
  // 代码、引用、标题及表格不参与。语义相同但文字不同的内容仍需要人工审查。
  const duplicateRule = RULE.get('duplicate-sentences');
  if (duplicateRule) {
    const seen = new Map();
    body.forEach((line, index) => {
      if (!line.trim() || /^\s*[#>|]/.test(line) || isTable(line)) return;
      const content = line.replace(/^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/, '');
      const parts = content.split(/[。！？!?]+/);
      const originalParts = lines[index].split(/[。！？!?]+/);
      for (const [partIndex, part] of parts.entries()) {
        const key = part.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '');
        const han = (part.match(/[\u4e00-\u9fff]/g) ?? []).length;
        if (key.length < duplicateRule.minChars || han < duplicateRule.minHan) continue;
        const firstLine = seen.get(key);
        if (firstLine !== undefined) {
          const location = firstLine === index + 1 ? '本行前文' : '第 ' + firstLine + ' 行';
          const preview = originalParts.length === parts.length
            ? originalParts[partIndex].trim() : part.trim();
          add(file, index + 1, 'duplicate-sentences',
            '此句与' + location + '重复：' + preview.slice(0, 65));
        } else {
          seen.set(key, index + 1);
        }
      }
    });
  }

  // term-preference：项目可选术语表。命中仅提示复核，不自动替换词语。
  if (glossaryTerms.length) {
    for (const term of glossaryTerms) {
      const avoid = [...new Set(term.avoid)].sort((a, b) => b.length - a.length);
      body.forEach((line, index) => {
        const hit = avoid.find((variant) => line.includes(variant));
        if (!hit) return;
        add(file, index + 1, 'term-preference',
          '「' + hit + '」不是项目首选术语「' + term.preferred + '」；确认含义相同后统一',
          undefined, term.preferred);
      });
    }
  }

  // term-casing：自动找同一词的不同写法。英文文档里句首大写太常见，只在中文文档里做这件事。
  const termRule = RULE.get('term-casing');
  const explicitKeys = new Set();
  for (const term of termRule.terms) {
    for (const written of [term.canonical, ...term.variants]) {
      for (const word of written.match(/[A-Za-z][A-Za-z0-9.+#_-]*/g) ?? []) explicitKeys.add(word.toLowerCase());
    }
  }
  const forms = new Map();
  if (stats.zh > 0.3) body.forEach((line, index) => {
    for (const match of line.matchAll(/[A-Za-z][A-Za-z0-9.+#_-]*/g)) {
      const token = match[0];
      const key = token.toLowerCase();
      if (explicitKeys.has(key)) continue;
      // 句首大写不算写法不一致：Pull 在行首、pull 在句中，是同一句话法。
      const atStart = line.slice(0, match.index).replace(/^[\s>*+-]+/, '').length === 0;
      if (!forms.has(key)) forms.set(key, { seen: new Map() });
      const entry = forms.get(key);
      if (!entry.seen.has(token)) entry.seen.set(token, { count: 0, lines: [], onlyAtStart: true });
      const form = entry.seen.get(token);
      form.count += 1;
      form.lines.push(index + 1);
      form.onlyAtStart = form.onlyAtStart && atStart;
    }
  });
  for (const [key, entry] of forms) {
    const written = [...entry.seen.entries()].filter(([form, value]) => value.count >= termRule.minEach && !(value.onlyAtStart && form[0] === form[0].toUpperCase()));
    if (written.length < termRule.minForms) continue;
    add(file, written.flatMap(([, value]) => value.lines), 'term-casing',
      `「${key}」有 ${written.length} 种写法：${written.map(([form, value]) => `${form} ${value.count} 次`).join('、')}`);
  }
  for (const term of termRule.terms) {
    if (!text.includes(term.canonical)) continue;
    for (const variant of term.variants) {
      const hitLines = body.map((line, index) => index + 1).filter((n) => body[n - 1].includes(variant));
      if (!hitLines.length) continue;
      add(file, hitLines, 'term-casing', `写「${variant}」，别处写「${term.canonical}」。全篇统一一个`);
    }
  }

  // banned-phrases：固定短语。词表只收高置信度的，宁可漏报也不刷屏。
  // 词和句式分开：这里只认能枚举的，句子骨架的毛病在 references/language-zh.md 里讲。
  const phraseRule = RULE.get('banned-phrases');
  const phraseHits = new Map();
  for (const group of phraseRule.groups) {
    for (const word of group.words) {
      body.forEach((line, index) => {
        if (!line.includes(word)) return;
        const n = index + 1;
        if (!phraseHits.has(n)) {
          phraseHits.set(n, { hits: new Set(), fixes: new Set(), level: phraseRule.level });
        }
        const finding = phraseHits.get(n);
        finding.hits.add(`「${word}」${group.name}`);
        finding.fixes.add(group.fix);
        // High-confidence filler and marketing claims fail even without --strict.
        if (group.level === 'error') finding.level = 'error';
      });
    }
  }
  for (const [line, finding] of phraseHits) {
    add(file, line, 'banned-phrases',
      `${[...finding.hits].join('，')}。建议：${[...finding.fixes].join('；')}`,
      finding.level);
  }
  for (const pattern of phraseRule.patterns) {
    const re = new RegExp(pattern.re);
    let shown = 0;
    body.forEach((line, index) => {
      if (shown >= 5) return;
      const hit = line.match(re);
      if (!hit) return;
      add(file, index + 1, 'banned-phrases', `「${hit[0]}」属于${pattern.name}，${pattern.fix}`, pattern.level, pattern.name);
      shown += 1;
    });
  }

  return stats;
}

if (!targets.length) targets.push('.');

const files = [];
for (const target of targets) {
  try {
    collect(target, files);
  } catch (error) {
    console.error(`读不到 ${target}：${error.message}`);
    process.exit(2);
  }
}

const allStats = [];
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  allStats.push(checkFile(file, lines));
}

findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

if (asJson) {
  console.log(JSON.stringify({ findings, stats: allStats }, null, 2));
} else {
  let current = '';
  for (const finding of findings) {
    if (finding.file !== current) {
      current = finding.file;
      const stat = allStats.find((item) => item.file === finding.file);
      const shape = stat.p90 ? `，句长 p90 ${stat.p90}，最长 ${stat.longest}` : '';
      console.log(`\n${finding.file}  ${(stat.chars / 1000).toFixed(1)} 千字，分号 ${stat.semicolons}${shape}`);
    }
    console.log(`  ${String(finding.line).padStart(4)}  ${finding.level.padEnd(8)} ${finding.rule.padEnd(18)} ${finding.text}`);
  }
  const errors = findings.filter((item) => item.level === 'error').length;
  const warnings = findings.filter((item) => item.level === 'warning').length;
  const infos = findings.filter((item) => item.level === 'info').length;
  console.log(`\n${files.length} 个文件，${errors} 个 error，${warnings} 个 warning，${infos} 个 info`);
  if (!findings.length) console.log('没发现问题。');
}

process.exitCode = findings.some((item) => item.level === 'error') || (strict && findings.some((item) => item.level === 'warning')) ? 1 : 0;
