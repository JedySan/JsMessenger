#!/usr/bin/env node
// Собирает THIRD_PARTY_LICENSES.txt: все npm-пакеты, попадающие в приложение, и Rust-крейты
// macOS-сборки — с текстами лицензий. Запускается автоматически перед каждой сборкой.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "public", "THIRD_PARTY_LICENSES.txt");
const LICENSE_FILES = /^(licen[cs]e|copying|notice|ofl)([._-].*)?$/i;

function readLicenseTexts(dir) {
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => LICENSE_FILES.test(n)).sort();
  } catch {
    return [];
  }
  return names
    .map((n) => {
      try {
        const text = fs.readFileSync(path.join(dir, n), "utf8").trim();
        return text ? { name: n, text } : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// ---------- npm: production-зависимости рекурсивно ----------
function npmPackages() {
  const seen = new Map();
  const resolve = (name, fromDir) => {
    // ищем пакет вверх по node_modules, как это делает Node
    let dir = fromDir;
    for (;;) {
      const candidate = path.join(dir, "node_modules", name);
      if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir || !parent.startsWith(root)) return null;
      dir = parent;
    }
  };
  const walk = (name, fromDir) => {
    const dir = resolve(name, fromDir);
    if (!dir) return;
    const pj = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    const key = `${pj.name}@${pj.version}`;
    if (seen.has(key)) return;
    let license = pj.license ?? (Array.isArray(pj.licenses) ? pj.licenses.map((l) => l.type).join(" OR ") : "UNKNOWN");
    if (typeof license === "object") license = license.type;
    const repo = typeof pj.repository === "string" ? pj.repository : pj.repository?.url;
    seen.set(key, { name: pj.name, version: pj.version, license, url: pj.homepage ?? repo ?? "", texts: readLicenseTexts(dir) });
    for (const dep of Object.keys(pj.dependencies ?? {})) walk(dep, dir);
  };
  const app = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  for (const dep of Object.keys(app.dependencies ?? {})) walk(dep, root);
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- Rust: крейты, которые реально попадают в macOS-сборку ----------
function rustCrates() {
  const manifest = path.join(root, "src-tauri", "Cargo.toml");
  const byKey = new Map();
  for (const target of ["aarch64-apple-darwin", "x86_64-apple-darwin"]) {
    let meta;
    try {
      meta = JSON.parse(
        execFileSync("cargo", ["metadata", "--format-version", "1", "--manifest-path", manifest, "--filter-platform", target], {
          encoding: "utf8",
          maxBuffer: 256 * 1024 * 1024,
          stdio: ["ignore", "pipe", "ignore"],
        }),
      );
    } catch {
      return null; // cargo недоступен — раздел Rust пропускаем
    }
    // только то, что достижимо из нашего крейта по обычным (не dev/build) зависимостям
    const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
    const pkgs = new Map(meta.packages.map((p) => [p.id, p]));
    const stack = [meta.resolve.root];
    const reach = new Set();
    while (stack.length) {
      const id = stack.pop();
      if (reach.has(id)) continue;
      reach.add(id);
      for (const d of nodes.get(id)?.deps ?? []) {
        if (d.dep_kinds.some((k) => k.kind === null)) stack.push(d.pkg);
      }
    }
    for (const id of reach) {
      const p = pkgs.get(id);
      if (!p || id === meta.resolve.root) continue;
      const key = `${p.name}@${p.version}`;
      if (!byKey.has(key)) {
        byKey.set(key, {
          name: p.name,
          version: p.version,
          license: p.license ?? (p.license_file ? `см. ${p.license_file}` : "UNKNOWN"),
          url: p.repository ?? `https://crates.io/crates/${p.name}`,
          texts: readLicenseTexts(path.dirname(p.manifest_path)),
        });
      }
    }
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- сборка файла ----------
function section(title, list) {
  const lines = [];
  lines.push("=".repeat(78), title, "=".repeat(78), "");
  // сначала краткий перечень, затем полные тексты (одинаковые тексты не дублируем)
  for (const p of list) lines.push(`${p.name} ${p.version} — ${p.license}${p.url ? `  <${p.url.replace(/^git\+/, "")}>` : ""}`);
  lines.push("");
  const printed = new Map();
  for (const p of list) {
    lines.push("-".repeat(78), `${p.name} ${p.version} (${p.license})`, "-".repeat(78));
    if (!p.texts.length) {
      lines.push(
        `Текст лицензии не входит в пакет. Лицензия: ${p.license} — стандартный текст в разделе`,
        `«Стандартные тексты лицензий» в конце файла. Исходники: ${p.url}`,
        "",
      );
      continue;
    }
    for (const t of p.texts) {
      const prev = printed.get(t.text);
      if (prev) lines.push(`[${t.name}: текст совпадает с ${prev}]`);
      else {
        printed.set(t.text, `${p.name} ${p.version}`);
        lines.push(t.text);
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}

const npm = npmPackages();
const rust = rustCrates();
const header = [
  "JsMessenger — сторонние компоненты и их лицензии",
  `Сформировано: ${new Date().toISOString().slice(0, 10)}`,
  "",
  "JsMessenger распространяется под лицензией AGPL-3.0-or-later (см. LICENSE) и использует перечисленные",
  "ниже открытые компоненты. Все они распространяются",
  "под разрешительными лицензиями (MIT, Apache-2.0, BSD, ISC и т. п.), шрифт Onest — под SIL OFL 1.1.",
  "Компоненты под MPL-2.0 используются без изменений; их исходный код доступен по ссылкам ниже.",
  "",
].join("\n");

const body = [header, section(`npm-пакеты (${npm.length})`, npm)];
if (rust) body.push(section(`Rust-крейты macOS-сборки (${rust.length})`, rust));
else body.push("(Rust-крейты не перечислены: cargo недоступен при генерации)\n");

// ---------- стандартные тексты для пакетов, где файла лицензии нет ----------
const MIT = `MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the
following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial
portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO
EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN
AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE
OR OTHER DEALINGS IN THE SOFTWARE.`;
const BSD3 = `BSD 3-Clause License

Redistribution and use in source and binary forms, with or without modification, are permitted provided
that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the
   following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and
   the following disclaimer in the documentation and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or
   promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED
WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A
PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY
DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE
OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH
DAMAGE.`;
const ZLIB = `zlib License

This software is provided 'as-is', without any express or implied warranty. In no event will the authors
be held liable for any damages arising from the use of this software.

Permission is granted to anyone to use this software for any purpose, including commercial applications,
and to alter it and redistribute it freely, subject to the following restrictions:

1. The origin of this software must not be misrepresented; you must not claim that you wrote the original
   software. If you use this software in a product, an acknowledgment in the product documentation would be
   appreciated but is not required.
2. Altered source versions must be plainly marked as such, and must not be misrepresented as being the
   original software.
3. This notice may not be removed or altered from any source distribution.`;
// Apache-2.0 и MPL-2.0 — берём полные тексты из уже установленных пакетов
const fromFile = (rel) => {
  try {
    return fs.readFileSync(path.join(root, rel), "utf8").trim();
  } catch {
    return null;
  }
};
const apache = fromFile("node_modules/matrix-js-sdk/LICENSE") ?? "Apache License 2.0: https://www.apache.org/licenses/LICENSE-2.0";
const mpl = "Mozilla Public License 2.0: https://www.mozilla.org/MPL/2.0/";
body.push(
  [
    "=".repeat(78),
    "Стандартные тексты лицензий",
    "=".repeat(78),
    "",
    MIT,
    "",
    "-".repeat(78),
    BSD3,
    "",
    "-".repeat(78),
    ZLIB,
    "",
    "-".repeat(78),
    apache,
    "",
    "-".repeat(78),
    mpl,
    "",
  ].join("\n"),
);

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, body.join("\n"));
console.log(`THIRD_PARTY_LICENSES.txt: npm ${npm.length}, rust ${rust ? rust.length : "—"}, ${(fs.statSync(out).size / 1024).toFixed(0)} КБ`);
