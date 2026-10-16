// Подтверждение сеансов между устройствами (сверка эмодзи, как в Element).
import type { MatrixClient } from "matrix-js-sdk";
import { CryptoEvent } from "matrix-js-sdk/lib/crypto-api";
import type { VerificationRequest } from "matrix-js-sdk/lib/crypto-api";

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
  if (!crypto) throw new Error("Шифрование не инициализировано");
  verification.open(await crypto.requestOwnUserVerification());
}

/** Подтвердить другое своё устройство отсюда. */
export async function verifyOtherDevice(client: MatrixClient, deviceId: string) {
  const crypto = client.getCrypto();
  if (!crypto) throw new Error("Шифрование не инициализировано");
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
  Dog: "Собака", Cat: "Кошка", Lion: "Лев", Horse: "Лошадь", Unicorn: "Единорог", Pig: "Свинья",
  Elephant: "Слон", Rabbit: "Кролик", Panda: "Панда", Rooster: "Петух", Penguin: "Пингвин",
  Turtle: "Черепаха", Fish: "Рыба", Octopus: "Осьминог", Butterfly: "Бабочка", Flower: "Цветок",
  Tree: "Дерево", Cactus: "Кактус", Mushroom: "Гриб", Globe: "Глобус", Moon: "Луна", Cloud: "Облако",
  Fire: "Огонь", Banana: "Банан", Apple: "Яблоко", Strawberry: "Клубника", Corn: "Кукуруза",
  Pizza: "Пицца", Cake: "Торт", Heart: "Сердце", Smiley: "Улыбка", Robot: "Робот", Hat: "Шляпа",
  Glasses: "Очки", Spanner: "Гаечный ключ", Wrench: "Гаечный ключ", Santa: "Санта",
  "Thumbs Up": "Палец вверх", Umbrella: "Зонт", Hourglass: "Песочные часы", Clock: "Часы",
  Gift: "Подарок", "Light Bulb": "Лампочка", Book: "Книга", Pencil: "Карандаш", Paperclip: "Скрепка",
  Scissors: "Ножницы", Lock: "Замок", Key: "Ключ", Hammer: "Молоток", Telephone: "Телефон",
  Flag: "Флаг", Train: "Поезд", Bicycle: "Велосипед", Aeroplane: "Самолёт", Rocket: "Ракета",
  Trophy: "Кубок", Ball: "Мяч", Guitar: "Гитара", Trumpet: "Труба", Bell: "Колокольчик",
  Anchor: "Якорь", Headphones: "Наушники", Folder: "Папка", Pin: "Булавка",
};
export function sasNameRu(name: string): string {
  return SAS_RU[name] ?? name;
}
