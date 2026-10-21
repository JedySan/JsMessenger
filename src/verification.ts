// Подтверждение сеансов между устройствами (сверка эмодзи, как в Element).
import type { MatrixClient } from "matrix-js-sdk";
import { CryptoEvent } from "matrix-js-sdk/lib/crypto-api";
import type { VerificationRequest } from "matrix-js-sdk/lib/crypto-api";
import { tr } from "./i18n";

type Listener = () => void;

/** Текущий открытый запрос подтверждения (входящий или исходящий). */
class VerificationStore {
  request: VerificationRequest | null = null;
  private listeners = new Set<Listener>();
  private attached: MatrixClient | null = null;

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((f) => f());
  }

  /** Подписка на входящие запросы (например, из Element на телефоне). */
  attach(client: MatrixClient) {
    if (this.attached === client) return;
    this.attached = client;
    client.on(CryptoEvent.VerificationRequestReceived, (req: VerificationRequest) => {
      // Не перебиваем уже идущее подтверждение
      if (this.request && this.request.pending) return;
      this.open(req);
    });
  }

  open(req: VerificationRequest) {
    this.request = req;
    this.emit();
  }

  close() {
    const r = this.request;
    this.request = null;
    this.emit();
    if (r && r.pending) r.cancel().catch(() => {});
  }
}

export const verification = new VerificationStore();

/** Начать подтверждение этого сеанса с другого своего устройства. */
export async function verifyWithOtherDevice(client: MatrixClient) {
  const crypto = client.getCrypto();
  if (!crypto) throw new Error(tr("Шифрование не инициализировано"));
  verification.open(await crypto.requestOwnUserVerification());
}

/** Подтвердить другое своё устройство отсюда. */
export async function verifyOtherDevice(client: MatrixClient, deviceId: string) {
  const crypto = client.getCrypto();
  if (!crypto) throw new Error(tr("Шифрование не инициализировано"));
  verification.open(await crypto.requestDeviceVerification(client.getSafeUserId(), deviceId));
}

/**
 * После подтверждения другое устройство присылает ключ резервной копии —
 * включаем копию и подтягиваем ключи старых сообщений.
 */
export async function restoreAfterVerification(client: MatrixClient): Promise<void> {
  const crypto = client.getCrypto();
  if (!crypto) return;
  // ключ приходит по сети не мгновенно — несколько попыток
  for (let i = 0; i < 6; i++) {
    try {
      const check = await crypto.checkKeyBackupAndEnable();
      if (check?.backupInfo) {
        await crypto.restoreKeyBackup();
        return;
      }
    } catch {
      /* ещё нет ключа — ждём */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

// Названия эмодзи сверки на русском (спецификация Matrix, 64 символа)
const SAS_RU: Record<string, string> = {
  Dog: tr("Собака"), Cat: tr("Кошка"), Lion: tr("Лев"), Horse: tr("Лошадь"), Unicorn: tr("Единорог"), Pig: tr("Свинья"),
  Elephant: tr("Слон"), Rabbit: tr("Кролик"), Panda: tr("Панда"), Rooster: tr("Петух"), Penguin: tr("Пингвин"),
  Turtle: tr("Черепаха"), Fish: tr("Рыба"), Octopus: tr("Осьминог"), Butterfly: tr("Бабочка"), Flower: tr("Цветок"),
  Tree: tr("Дерево"), Cactus: tr("Кактус"), Mushroom: tr("Гриб"), Globe: tr("Глобус"), Moon: tr("Луна"), Cloud: tr("Облако"),
  Fire: tr("Огонь"), Banana: tr("Банан"), Apple: tr("Яблоко"), Strawberry: tr("Клубника"), Corn: tr("Кукуруза"),
  Pizza: tr("Пицца"), Cake: tr("Торт"), Heart: tr("Сердце"), Smiley: tr("Улыбка"), Robot: tr("Робот"), Hat: tr("Шляпа"),
  Glasses: tr("Очки"), Spanner: tr("Гаечный ключ"), Wrench: tr("Гаечный ключ"), Santa: tr("Санта"),
  "Thumbs Up": tr("Палец вверх"), Umbrella: tr("Зонт"), Hourglass: tr("Песочные часы"), Clock: tr("Часы"),
  Gift: tr("Подарок"), "Light Bulb": tr("Лампочка"), Book: tr("Книга"), Pencil: tr("Карандаш"), Paperclip: tr("Скрепка"),
  Scissors: tr("Ножницы"), Lock: tr("Замок"), Key: tr("Ключ"), Hammer: tr("Молоток"), Telephone: tr("Телефон"),
  Flag: tr("Флаг"), Train: tr("Поезд"), Bicycle: tr("Велосипед"), Aeroplane: tr("Самолёт"), Rocket: tr("Ракета"),
  Trophy: tr("Кубок"), Ball: tr("Мяч"), Guitar: tr("Гитара"), Trumpet: tr("Труба"), Bell: tr("Колокольчик"),
  Anchor: tr("Якорь"), Headphones: tr("Наушники"), Folder: tr("Папка"), Pin: tr("Булавка"),
};
export function sasNameRu(name: string): string {
  return SAS_RU[name] ?? name;
}
