// Проверка перевода: русские строки вне tr()/plural() и ключи без перевода в словарях.
//   node scripts/i18n-check.mjs        — вывести проблемы, код выхода 1, если они есть
// Ключи собираются из исходников; словари — src/locales/*.ts.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";

const CYR = /[А-Яа-яЁё]/;
// выражения TypeScript, внутри которых обычные значения, а не типы
const TS_VALUE = new Set(["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "TSTypeAssertion", "TSInstantiationExpression"]);
// служебные строки, которые не переводятся (таблицы раскладки и т. п.)
const IGNORE_FILES = new Set(["src/i18n.ts"]);
const IGNORE_MARK = "i18n-ignore"; // комментарий в строке кода — не проверять её

function files(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f).split(path.sep).join("/"); // одинаково на Windows и Unix
    if (statSync(p).isDirectory()) return f === "locales" ? [] : files(p);
    return /\.(ts|tsx)$/.test(f) && !f.endsWith(".d.ts") ? [p] : [];
  });
}

function walk(n, parents, f) {
  if (!n || typeof n.type !== "string") return;
  f(n, parents);
  for (const k of Object.keys(n)) {
    if (["loc", "start", "end", "extra", "leadingComments", "trailingComments", "innerComments"].includes(k)) continue;
    const v = n[k];
    if (Array.isArray(v)) v.forEach((c) => walk(c, [...parents, n], f));
    else if (v && typeof v.type === "string") walk(v, [...parents, n], f);
  }
}

const keys = new Map();
const problems = [];
for (const file of files("src")) {
  if (IGNORE_FILES.has(file)) continue;
  const code = readFileSync(file, "utf8");
  const lines = code.split("\n");
  const ast = parse(code, { sourceType: "module", plugins: ["typescript", ...(file.endsWith(".tsx") ? ["jsx"] : [])] });
  walk(ast.program, [], (n, parents) => {
    if (n.type === "CallExpression" && n.callee.type === "Identifier") {
      if (n.callee.name === "tr" && n.arguments[0]?.type === "StringLiteral") keys.set(n.arguments[0].value, `${file}:${n.loc.start.line}`);
      if (n.callee.name === "plural" && n.arguments.slice(1).every((a) => a.type === "StringLiteral"))
        keys.set(n.arguments.slice(1).map((a) => a.value).join("|"), `${file}:${n.loc.start.line}`);
    }
    const isText =
      (n.type === "StringLiteral" && CYR.test(n.value)) ||
      (n.type === "JSXText" && CYR.test(n.value)) ||
      (n.type === "TemplateElement" && CYR.test(n.value.cooked));
    if (!isText) return;
    if (lines[n.loc.start.line - 1].includes(IGNORE_MARK)) return;
    const inAllowed = parents.some(
      (p) =>
        p.type === "ImportDeclaration" ||
        (p.type.startsWith("TS") && !TS_VALUE.has(p.type)) ||
        (p.type === "CallExpression" &&
          ((p.callee.type === "Identifier" && ["tr", "plural"].includes(p.callee.name)) ||
            (p.callee.type === "MemberExpression" && p.callee.object.name === "console"))),
    );
    if (!inAllowed) problems.push(`${file}:${n.loc.start.line}  не переведено: ${JSON.stringify(n.value?.cooked ?? n.value).slice(0, 90)}`);
  });
}

for (const f of readdirSync("src/locales")) {
  const lang = f.replace(/\.ts$/, "");
  const src = readFileSync(path.join("src/locales", f), "utf8");
  const dict = new Function(src.replace(/^[\s\S]*?=\s*\{/, "return {").replace(/\};?\s*export default[\s\S]*$/, "};"))();
  for (const [k, where] of keys) if (!(k in dict)) problems.push(`${where}  нет перевода (${lang}): ${JSON.stringify(k).slice(0, 90)}`);
  for (const k of Object.keys(dict)) if (!keys.has(k)) problems.push(`src/locales/${f}  лишний ключ: ${JSON.stringify(k).slice(0, 90)}`);
}

console.log(problems.join("\n") || "Перевод: всё в порядке");
console.log(`ключей: ${keys.size}`);
process.exit(problems.length ? 1 : 0);
