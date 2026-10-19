// После `tauri android init`: права в AndroidManifest.xml (камера, микрофон, уведомления, звук звонка).
// Проект src-tauri/gen/android генерируется заново при каждой сборке, поэтому правки — здесь.
import { readFileSync, writeFileSync } from "node:fs";

const file = "src-tauri/gen/android/app/src/main/AndroidManifest.xml";
let xml = readFileSync(file, "utf8");
const perms = [
  "android.permission.INTERNET",
  "android.permission.CAMERA",
  "android.permission.RECORD_AUDIO",
  "android.permission.MODIFY_AUDIO_SETTINGS",
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.VIBRATE",
];
const missing = perms.filter((p) => !xml.includes(`"${p}"`));
const lines = missing.map((p) => `    <uses-permission android:name="${p}" />`).join("\n");
// камера не обязательна: приложение ставится и на устройства без неё
const features =
  '    <uses-feature android:name="android.hardware.camera" android:required="false" />\n' +
  '    <uses-feature android:name="android.hardware.microphone" android:required="false" />';
xml = xml.replace(/<application/, `${lines}\n${features}\n\n    <application`);
writeFileSync(file, xml);
console.log(`AndroidManifest.xml: добавлено прав — ${missing.length}`);
