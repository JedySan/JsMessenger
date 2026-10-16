/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** Сервер Matrix, подставляемый в форму входа (необязательно) */
  readonly VITE_DEFAULT_SERVER?: string;
  /** Запасной адрес lk-jwt-service для звонков (необязательно) */
  readonly VITE_LIVEKIT_SERVICE_URL?: string;
}
