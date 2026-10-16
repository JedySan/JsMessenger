import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import Logo from "./Logo";
import { Modal } from "./ui";

const VERSION = __APP_VERSION__;

/** «О программе»: версия и лицензии сторонних компонентов. */
export default function AboutDialog({ onClose }: { onClose: () => void }) {
  const [licenses, setLicenses] = useState<string | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!show || licenses !== null) return;
    fetch("/THIRD_PARTY_LICENSES.txt")
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then(setLicenses)
      .catch(() => setLicenses("Файл лицензий не найден в этой сборке. Выполните npm run licenses и пересоберите приложение."));
  }, [show, licenses]);

  return (
    <Modal title="О программе" onClose={onClose} wide={show}>
      <div className="about">
        <Logo size={56} />
        <div>
          <div className="about-name">JsMessenger</div>
          <div className="about-ver">Версия {VERSION}</div>
        </div>
      </div>
      <p className="modal-text">
        Мессенджер на протоколе Matrix со звонками через LiveKit. Свободная программа под лицензией AGPL-3.0;
        исходный код — github.com/JedySan/JsMessenger. Использует matrix-js-sdk, LiveKit, React, Tauri и другие открытые компоненты.
      </p>
      {!show ? (
        <button className="choice" onClick={() => setShow(true)}>
          <FileText size={20} />
          <span>
            <b>Лицензии сторонних компонентов</b>
            <span>Полный список пакетов и тексты их лицензий</span>
          </span>
        </button>
      ) : (
        <pre className="licenses">{licenses ?? "Загружаю…"}</pre>
      )}
    </Modal>
  );
}
