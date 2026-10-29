// После подписи установщика Windows его содержимое меняется — пересчитываем latest.yml и .blockmap,
// иначе автообновление (electron-updater) отвергнет файл с «неверной» контрольной суммой.
//   node scripts/win-update-latest.mjs release/electron/JsMessenger-1.2.3-Setup.exe
import fs from "node:fs";
import path from "node:path";
import { buildBlockMap } from "app-builder-lib/out/targets/blockmap/blockmap.js";

const exe = process.argv[2];
if (!exe || !fs.existsSync(exe)) {
  console.error("Укажите подписанный установщик: node scripts/win-update-latest.mjs путь/к/Setup.exe");
  process.exit(1);
}
const dir = path.dirname(exe);
const name = path.basename(exe);
const latest = path.join(dir, "latest.yml");

const { sha512, size } = await buildBlockMap(exe, "gzip", `${exe}.blockmap`);
let yml = fs.readFileSync(latest, "utf8");
const lines = yml.split("\n");
let inFile = false;
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (/^\s*- url: /.test(l)) inFile = l.trim().endsWith(name);
  else if (/^\S/.test(l)) inFile = false;
  if (inFile && /^\s+sha512: /.test(l)) lines[i] = l.replace(/sha512: .*/, `sha512: ${sha512}`);
  if (inFile && /^\s+size: /.test(l)) lines[i] = l.replace(/size: .*/, `size: ${size}`);
  if (/^sha512: /.test(l)) lines[i] = `sha512: ${sha512}`;
}
yml = lines.join("\n");
if (!yml.includes(sha512)) {
  console.error(`В ${latest} не нашёлся ${name}`);
  process.exit(1);
}
fs.writeFileSync(latest, yml);
console.log(`latest.yml: ${name} — ${size} байт, sha512 обновлён`);
