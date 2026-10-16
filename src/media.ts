// Загрузка медиа Matrix с авторизацией (authenticated media) и кэшем blob:-ссылок.
import type { MatrixClient } from "matrix-js-sdk";

const cache = new Map<string, Promise<string>>();

/** Миниатюра (аватар и т.п.) по mxc:// — кэшируется на всё время работы приложения. */
export function thumbnailUrl(client: MatrixClient, mxc: string, size: number): Promise<string> {
  const key = `${mxc}@${size}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const http = client.mxcUrlToHttp(mxc, size, size, "crop", false, true, true);
      if (!http) throw new Error("bad mxc");
      const res = await fetch(http, { headers: { Authorization: `Bearer ${client.getAccessToken()}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return URL.createObjectURL(await res.blob());
    })();
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}
