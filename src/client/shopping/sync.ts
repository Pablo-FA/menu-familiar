import { useSyncExternalStore } from "react";
import type { ShoppingItem, ShoppingListResponse } from "../../shared/api";
import { applyOps, retryDelay, type CreateFields, type PatchFields, type ShoppingOp } from "../../shared/shopping-sync";
import { api, ApiRequestError } from "../api";

/**
 * Lista de la compra con caché en el móvil y cola de cambios sin conexión.
 *
 * - La última lista que llegó del servidor se guarda en localStorage y se pinta al
 *   instante al abrir (también sin conexión).
 * - Todo cambio en una línea se aplica al momento, se guarda en una cola persistente
 *   y se envía en orden a POST /api/shopping/ops. Si no hay red, se reintenta con
 *   esperas crecientes, al volver la conexión y al volver a la app.
 * - Lo que se ve es siempre: última lista del servidor + cola pendiente encima.
 */

const LIST_KEY = "mf.shopping.list";
const QUEUE_KEY = "mf.shopping.queue";

export interface ShoppingState {
  /** undefined: todavía no se sabe (sin caché y sin respuesta). null: no hay lista. */
  list: ShoppingListResponse | null | undefined;
  pending: number;
  /** Sin conexión: el navegador lo dice o la última petición falló por red. */
  offline: boolean;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Sin almacenamiento (modo privado): la app sigue funcionando, solo sin caché.
  }
}

const makeItem = (op: Extract<ShoppingOp, { op: "create" }>): ShoppingItem => ({
  id: null,
  client_id: op.item_id,
  ingredient_id: op.fields.ingredient_id,
  name: op.fields.name,
  quantity_text: op.fields.quantity_text,
  aisle: op.fields.aisle,
  pantry: false,
  status: "buy",
  bought: false,
  manual: true,
  carried: false,
});

let server: ShoppingListResponse | null | undefined = read<ShoppingListResponse | null | undefined>(LIST_KEY, undefined);
let queue: ShoppingOp[] = read<ShoppingOp[]>(QUEUE_KEY, []);
let networkFailed = false;
let state: ShoppingState = compute();
const listeners = new Set<() => void>();

function compute(): ShoppingState {
  const list = server ? { ...server, items: applyOps(server.items, queue, makeItem) } : server;
  const offline = networkFailed || (typeof navigator !== "undefined" && navigator.onLine === false);
  return { list, pending: queue.length, offline };
}

function emit() {
  state = compute();
  for (const l of listeners) l();
}

function setServer(list: ShoppingListResponse | null) {
  server = list;
  write(LIST_KEY, list);
}

const isNetworkError = (err: unknown) => !(err instanceof ApiRequestError);

// ---------- Lectura ----------

let loading: Promise<void> | null = null;

/** Pide la lista al servidor (y antes envía la cola, si hay). */
export function loadList(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    try {
      if (queue.length > 0) await flush();
      if (queue.length > 0) return; // sigue sin poder enviar: no pisar lo local
      const list = await api.get<ShoppingListResponse | null>("/shopping");
      setServer(list);
      networkFailed = false;
    } catch (err) {
      if (isNetworkError(err)) networkFailed = true;
      else throw err;
    } finally {
      loading = null;
      emit();
    }
  })();
  return loading;
}

/** Sustituye la lista (tras crear o actualizar en el servidor). */
export function replaceList(list: ShoppingListResponse | null) {
  setServer(list);
  networkFailed = false;
  emit();
}

// ---------- Escritura ----------

const newId = () => (typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

function enqueue(op: ShoppingOp) {
  queue = [...queue, op];
  write(QUEUE_KEY, queue);
  emit();
  void flush();
}

export const targetOf = (item: Pick<ShoppingItem, "id" | "client_id">): number | string => item.id ?? (item.client_id as string);
export const itemKey = (item: Pick<ShoppingItem, "id" | "client_id">): string => item.client_id ?? String(item.id);

export function patchItem(item: ShoppingItem, fields: PatchFields) {
  enqueue({ id: newId(), item_id: targetOf(item), op: "patch", fields, at: new Date().toISOString() });
}

export function createItem(fields: CreateFields) {
  enqueue({ id: newId(), item_id: `c-${newId()}`, op: "create", fields, at: new Date().toISOString() });
}

export function deleteItem(item: ShoppingItem) {
  enqueue({ id: newId(), item_id: targetOf(item), op: "delete", fields: {}, at: new Date().toISOString() });
}

// ---------- Envío de la cola ----------

let flushing: Promise<void> | null = null;
let attempt = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

/** Envía la cola en orden. Si falla por red, reintenta más tarde (2 s, 4 s, 8 s… hasta 2 min). */
export function flush(): Promise<void> {
  if (flushing) return flushing;
  if (queue.length === 0) return Promise.resolve();
  flushing = (async () => {
    const sent = queue;
    try {
      const list = await api.post<ShoppingListResponse | null>("/shopping/ops", sent);
      const sentIds = new Set(sent.map((op) => op.id));
      queue = queue.filter((op) => !sentIds.has(op.id));
      write(QUEUE_KEY, queue);
      setServer(list);
      networkFailed = false;
      attempt = 0;
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 400) {
        // Operaciones que el servidor nunca aceptará: se descartan para no bloquear la cola.
        const sentIds = new Set(sent.map((op) => op.id));
        queue = queue.filter((op) => !sentIds.has(op.id));
        write(QUEUE_KEY, queue);
      } else {
        if (isNetworkError(err)) networkFailed = true;
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(() => {
          retryTimer = null;
          void flush();
        }, retryDelay(attempt));
        attempt += 1;
      }
    } finally {
      flushing = null;
      emit();
    }
    // Lo que se añadió a la cola mientras se enviaba.
    if (queue.length > 0 && !networkFailed) await flush();
  })();
  return flushing;
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    attempt = 0;
    emit();
    if (listeners.size > 0) void loadList();
    else void flush();
  });
  window.addEventListener("offline", emit);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    // Con la pantalla de la compra abierta se refresca; si no, solo se envía la cola.
    if (listeners.size > 0) void loadList();
    else void flush();
  });
}

export function useShopping(): ShoppingState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
