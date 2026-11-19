// «Быстрые реакции»: выбрать, какие семь смайликов стоят в меню сообщения.
import { useState } from "react";
import { SmilePlus } from "lucide-react";
import { Modal } from "./ui";
import EmojiPanel from "./EmojiPanel";
import { DEFAULT_REACTIONS, getQuickReactions, setQuickReactions } from "../reactions";
import { tr } from "../i18n";

export default function ReactionsDialog({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState(getQuickReactions());
  const [slot, setSlot] = useState(0);
  const pick = (e: string) => {
    const next = [...list];
    const dup = next.indexOf(e);
    if (dup >= 0 && dup !== slot) next[dup] = next[slot]; // такой уже есть — меняем местами
    next[slot] = e;
    setList(next);
    setSlot((slot + 1) % next.length);
  };
  return (
    <Modal title={tr("Быстрые реакции")} icon={<SmilePlus size={18} />} onClose={onClose} wide>
      <p className="modal-text small-note">{tr("Выберите место и нажмите смайлик ниже — он встанет туда. Эти реакции видны в меню сообщения.")}</p>
      <div className="qr-slots">
        {list.map((e, i) => (
          <button key={i} className={"qr-slot" + (i === slot ? " on" : "")} onClick={() => setSlot(i)} aria-label={tr("Место {0}: {1}", i + 1, e)}>
            {e}
          </button>
        ))}
      </div>
      <div className="qr-panel">
        <EmojiPanel onPick={pick} onClose={() => {}} />
      </div>
      <div className="modal-actions">
        <button className="ghost" onClick={() => setList(DEFAULT_REACTIONS)}>
          {tr("Как было")}
        </button>
        <span className="spacer" />
        <button className="ghost" onClick={onClose}>
          {tr("Отмена")}
        </button>
        <button
          className="primary"
          onClick={() => {
            setQuickReactions(list);
            onClose();
          }}
        >
          {tr("Сохранить")}
        </button>
      </div>
    </Modal>
  );
}
