import { Check, ChevronDown, CloudOff, Ellipsis, House, Plus, RefreshCw, ShoppingBag } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AISLE_LABEL, AISLES, type Aisle } from "../../shared/aisles";
import type { ShoppingCandidatesResponse, ShoppingItem, ShoppingListResponse, ShoppingUpdateResponse } from "../../shared/api";
import { addDays, longDate, madridNow } from "../../shared/dates";
import { dateRangeLabel } from "../../shared/week";
import { api } from "../api";
import { useToast } from "../components/Toast";
import { useScrollScene } from "../components/useScrollScene";
import { navigate } from "../router";
import { ItemRow } from "./ItemRow";
import { AddItemSheet, AisleSheet, ItemActionsSheet, MoreMenu, NewListSheet } from "./sheets";
import styles from "./Shopping.module.css";
import { createItem, deleteItem, flush, itemKey, loadList, patchItem, replaceList, useShopping } from "./sync";

type SheetState =
  | { kind: "new" }
  | { kind: "add" }
  | { kind: "aisle"; key: string }
  | { kind: "actions"; key: string }
  | null;

/** Tras marcar, la línea espera un poco antes de irse al final de su sección. */
const REORDER_DELAY_MS = 600;
const HIDE_KEY = "mf.shopping.hideBought";

const byName = (a: ShoppingItem, b: ShoppingItem) => a.name.localeCompare(b.name, "es");

function readHide(): boolean {
  try {
    return localStorage.getItem(HIDE_KEY) === "1";
  } catch {
    return false;
  }
}

/** "del 5 al 11 de octubre", "del 28 de septiembre al 4 de octubre", "el 5 de octubre". */
function longRange(from: string, to: string): string {
  if (from === to) return `el ${longDate(from)}`;
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  return `del ${sameMonth ? Number(from.slice(8, 10)) : longDate(from)} al ${longDate(to)}`;
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

export function Shopping() {
  const { list, offline } = useShopping();
  const toast = useToast();
  const [sheet, setSheet] = useState<SheetState>(null);
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);
  const [hideBought, setHideBought] = useState(readHide);
  const [doneOpen, setDoneOpen] = useState(false);
  const [homeOpen, setHomeOpen] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Estado "comprado" con el que se ordena, congelado un momento tras marcar.
  const [frozen, setFrozen] = useState<Map<string, boolean>>(new Map());

  useEffect(() => {
    void loadList().catch(() => toast({ message: "No se ha podido cargar la lista" }));
  }, [toast]);

  useEffect(() => {
    try {
      localStorage.setItem(HIDE_KEY, hideBought ? "1" : "0");
    } catch {
      // sin almacenamiento: solo dura esta sesión
    }
  }, [hideBought]);

  const items = useMemo(() => list?.items ?? [], [list]);
  const byKey = useMemo(() => new Map(items.map((i) => [itemKey(i), i])), [items]);
  const buy = items.filter((i) => i.status === "buy");
  const review = items.filter((i) => i.status === "review").sort(byName);
  const home = items.filter((i) => i.status === "home").sort(byName);
  const checked = buy.filter((i) => i.bought).length;
  const total = buy.length;
  const percent = total > 0 ? Math.round((checked / total) * 100) : 0;

  const title =
    total === 0 ? "Nada por comprar" : checked === 0 ? `${total} por comprar` : checked === total ? "Todo en el carro" : `${checked} de ${total} en el carro`;
  const counts = [review.length > 0 ? `${review.length} por revisar en casa` : null, home.length > 0 ? `${home.length} ya en casa` : null]
    .filter(Boolean)
    .join(" · ");

  // Secciones en el orden de la tienda.
  const sections = useMemo(() => {
    const groups = new Map<Aisle, ShoppingItem[]>();
    for (const item of items) {
      if (item.status !== "buy") continue;
      const aisle = (AISLES as readonly string[]).includes(item.aisle) ? (item.aisle as Aisle) : "otros";
      const group = groups.get(aisle);
      if (group) group.push(item);
      else groups.set(aisle, [item]);
    }
    const sortedBought = (i: ShoppingItem) => frozen.get(itemKey(i)) ?? i.bought;
    return AISLES.filter((a) => groups.has(a)).map((aisle) => {
      const rows = [...(groups.get(aisle) ?? [])].sort((a, b) => Number(sortedBought(a)) - Number(sortedBought(b)) || byName(a, b));
      const done = rows.every((r) => r.bought);
      return { aisle, rows, done, bought: rows.filter((r) => r.bought).length };
    });
  }, [items, frozen]);

  const completed = sections.filter((s) => s.done && !s.rows.some((r) => frozen.get(itemKey(r)) === false));
  const completedSet = new Set(completed.map((s) => s.aisle));
  const firstPending = sections.find((s) => !completedSet.has(s.aisle))?.aisle ?? null;

  // ---------- Acciones sobre líneas ----------

  function toggle(item: ShoppingItem) {
    const key = itemKey(item);
    setFrozen((prev) => new Map(prev).set(key, item.bought));
    window.setTimeout(() => {
      setFrozen((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
    }, REORDER_DELAY_MS);
    patchItem(item, { bought: !item.bought });
  }

  function setHome(item: ShoppingItem) {
    setOpenRow(null);
    const previous = { status: item.status, bought: item.bought };
    patchItem(item, { status: "home" });
    toast({ message: `${item.name} · en casa`, action: { label: "Deshacer", onClick: () => patchItem(item, previous) } });
  }

  function remove(item: ShoppingItem) {
    setOpenRow(null);
    deleteItem(item);
    toast({
      message: `${item.name} quitado`,
      action: {
        label: "Deshacer",
        onClick: () => createItem({ name: item.name, quantity_text: item.quantity_text, aisle: item.aisle, ingredient_id: item.ingredient_id }),
      },
    });
  }

  function moveTo(item: ShoppingItem, aisle: Aisle) {
    setSheet(null);
    setOpenRow(null);
    if (aisle === item.aisle) return;
    const previous = item.aisle;
    patchItem(item, { aisle });
    toast({
      message: `${item.name} → ${AISLE_LABEL[aisle]}`,
      action: { label: "Deshacer", onClick: () => patchItem(item, { aisle: previous }) },
    });
  }

  // ---------- Lista entera (necesitan conexión) ----------

  async function updateList() {
    setMenuAnchor(null);
    setBusy(true);
    try {
      await flush();
      const res = await api.post<ShoppingUpdateResponse>("/shopping/update", {});
      replaceList(res.list);
      const parts = [
        res.added > 0 ? plural(res.added, "añadido", "añadidos") : null,
        res.removed > 0 ? plural(res.removed, "quitado", "quitados") : null,
        res.changed > 0 ? plural(res.changed, "cantidad cambiada", "cantidades cambiadas") : null,
      ].filter(Boolean);
      toast({ message: parts.length > 0 ? `Lista actualizada · ${parts.join(", ")}` : "La lista ya está al día" });
    } catch {
      toast({ message: "No se ha podido actualizar la lista" });
    } finally {
      setBusy(false);
    }
  }

  async function createList(body: { from: string; to: string; excluded: { date: string; slot: string }[]; carry: boolean }) {
    await flush();
    const created = await api.post<ShoppingListResponse>("/shopping", body);
    replaceList(created);
    setSheet(null);
    setDoneOpen(false);
    toast({ message: `Lista creada · ${plural(created.items.filter((i) => i.status === "buy").length, "cosa", "cosas")} por comprar` });
  }

  // ---------- Escena de scroll ----------

  const headerRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const blurTintRef = useRef<HTMLDivElement>(null);
  const blurStrongRef = useRef<HTMLDivElement>(null);
  useScrollScene({ headerRef, barRef, blurTintRef, blurStrongRef });

  // Tocar fuera de las filas cierra la abierta (tocar otra fila la cierra en su propio click, sin marcar).
  useEffect(() => {
    if (openRow === null) return;
    const close = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest("[data-row-key]")) setOpenRow(null);
    };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [openRow]);

  const sheetItem = sheet && "key" in sheet ? byKey.get(sheet.key) : undefined;
  const hasList = list !== null && list !== undefined;

  const rowProps = (item: ShoppingItem) => {
    const key = itemKey(item);
    return {
      item,
      open: openRow === key,
      onOpenChange: (open: boolean) => setOpenRow(open ? key : null),
      anotherOpen: openRow !== null && openRow !== key,
      closeOthers: () => setOpenRow(null),
      onToggle: () => toggle(item),
      onAisle: () => {
        setOpenRow(null);
        setSheet({ kind: "aisle", key });
      },
      onHome: () => setHome(item),
      onRemove: () => remove(item),
      onActions: () => setSheet({ kind: "actions", key }),
    };
  };

  return (
    <main className={styles.page}>
      <div ref={blurTintRef} className={styles.blurTint} aria-hidden="true" />
      <div ref={blurStrongRef} className={styles.blurStrong} aria-hidden="true" />

      <div ref={barRef} className={`${styles.bar} glass-bar`} inert>
        <div className={styles.barText}>
          <p className={styles.barTitle}>Compra</p>
          <p className={styles.barStatus}>{hasList ? title : "Sin lista"}</p>
        </div>
        {hasList && (
          <>
            <div className={styles.barTrack} aria-hidden="true">
              <div className={styles.barFill} style={{ width: `${percent}%` }} />
            </div>
            <button type="button" className={styles.barPlus} onClick={() => setSheet({ kind: "add" })} aria-label="Añadir a la lista">
              <Plus size={22} strokeWidth={2.2} aria-hidden="true" />
            </button>
          </>
        )}
      </div>

      <div ref={headerRef}>
        <div className={styles.header}>
          <h1 className={styles.title}>Compra</h1>
          {hasList && (
            <>
              <button type="button" className={`${styles.circleButton} glass`} onClick={() => setSheet({ kind: "add" })} aria-label="Añadir a la lista">
                <Plus size={21} strokeWidth={2.1} aria-hidden="true" />
              </button>
              <button
                type="button"
                className={`${styles.circleButton} glass`}
                aria-label="Más opciones"
                aria-haspopup="menu"
                onClick={(e) => setMenuAnchor(e.currentTarget.getBoundingClientRect())}
              >
                <Ellipsis size={21} aria-hidden="true" />
              </button>
            </>
          )}
        </div>
        {hasList && (
          <p className={styles.subline}>
            Para {dateRangeLabel(list.from_date, list.to_date)} · {plural(list.meals_count, "comida", "comidas")}
          </p>
        )}
      </div>

      {offline && (
        <p className={`${styles.offline} glass`} role="status">
          <CloudOff size={18} aria-hidden="true" />
          Sin conexión · lo que marques se guarda en el móvil
        </p>
      )}

      {list === undefined && !offline && <p className={styles.muted}>Cargando…</p>}
      {list === undefined && offline && <p className={styles.muted}>No hay una lista guardada en este móvil.</p>}
      {list === null && <EmptyState offline={offline} onCreate={() => setSheet({ kind: "new" })} />}

      {hasList && (
        <>
          {list.changes && (
            <section className={`${styles.card} glass`} aria-label="El menú ha cambiado">
              <div className={styles.cardTop}>
                <span className={`${styles.chip40} ${styles.amberChip}`} aria-hidden="true">
                  <RefreshCw size={19} />
                </span>
                <div className={styles.cardText}>
                  <p className={styles.cardTitle}>El menú ha cambiado</p>
                  <p className={styles.cardSub}>{list.changes.first}</p>
                </div>
              </div>
              <button
                type="button"
                className={`pill-button pill-button--primary ${styles.btn44}`}
                onClick={() => void updateList()}
                disabled={offline || busy}
              >
                {offline ? "Necesita conexión" : "Actualizar la lista"}
              </button>
            </section>
          )}

          <section className={`${styles.summary} glass`} aria-label="Resumen">
            <div className={styles.summaryTop}>
              <p className={styles.summaryTitle}>{title}</p>
              {checked > 0 && <span className={styles.percent}>{percent}%</span>}
            </div>
            <div
              className={styles.track}
              role="progressbar"
              aria-label="En el carro"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={checked}
            >
              <div className={styles.fill} style={{ width: `${percent}%` }} />
            </div>
            {counts && <p className={styles.summaryLine}>{counts}</p>}
          </section>

          {review.length > 0 && (
            <section className={`${styles.card} glass`} aria-labelledby="review-title">
              <div className={styles.cardTop}>
                <span className={styles.chip40} aria-hidden="true">
                  <House size={19} />
                </span>
                <div className={styles.cardText}>
                  <h2 id="review-title" className={styles.cardTitle}>
                    Revisa en casa
                  </h2>
                  <p className={styles.cardSub}>Lo sueles tener. ¿Queda suficiente?</p>
                </div>
                <span className={styles.countPill}>{review.length}</span>
              </div>
              <ul className={styles.reviewList}>
                {review.map((item) => (
                  <li key={itemKey(item)} className={styles.reviewRow}>
                    <span className={styles.reviewText}>
                      <span className={styles.reviewName}>{item.name}</span>
                      {item.quantity_text && <span className={styles.reviewQty}>{item.quantity_text}</span>}
                    </span>
                    <span className={styles.choice} role="group" aria-label={`${item.name}: ¿queda suficiente?`}>
                      <button type="button" onClick={() => patchItem(item, { status: "home" })}>
                        Hay
                      </button>
                      <button type="button" onClick={() => patchItem(item, { status: "buy", bought: false })}>
                        Comprar
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {sections.map((section) => {
            const isDone = completedSet.has(section.aisle);
            const showDoneButton = completed.length > 0 && (section.aisle === firstPending || (firstPending === null && section === sections[0]));
            const rows = hideBought ? section.rows.filter((r) => !r.bought || frozen.get(itemKey(r)) === false) : section.rows;
            return (
              <div key={section.aisle}>
                {showDoneButton && (
                  <DoneButton names={completed.map((s) => AISLE_LABEL[s.aisle])} open={doneOpen} onToggle={() => setDoneOpen(!doneOpen)} />
                )}
                {(!isDone || doneOpen) && rows.length > 0 && (
                  <section className={styles.section} aria-label={AISLE_LABEL[section.aisle]}>
                    <h2 className={styles.sectionHead}>
                      <span>{AISLE_LABEL[section.aisle]}</span>
                      <span className={styles.sectionCount}>
                        {section.bought} de {section.rows.length}
                      </span>
                    </h2>
                    <ul className={`${styles.sectionCard} glass`}>
                      {rows.map((item) => (
                        <ItemRow key={itemKey(item)} {...rowProps(item)} />
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            );
          })}

          <button type="button" className={styles.addButton} onClick={() => setSheet({ kind: "add" })}>
            <Plus size={18} aria-hidden="true" /> Añadir algo que no está en las recetas
          </button>

          {home.length > 0 && (
            <section className={styles.homeBlock}>
              <button type="button" className={`${styles.homeButton} glass`} aria-expanded={homeOpen} onClick={() => setHomeOpen(!homeOpen)}>
                <House size={20} aria-hidden="true" />
                <span className={styles.homeText}>
                  <span className={styles.homeTitle}>En casa</span>
                  <span className={styles.homeSub}>No se compra. Toca para revisarlo</span>
                </span>
                <span className={styles.homeCount}>{home.length}</span>
                <ChevronDown size={18} className={styles.chevron} aria-hidden="true" />
              </button>
              {homeOpen && (
                <ul className={`${styles.sectionCard} glass ${styles.homeList}`}>
                  {home.map((item) => (
                    <li key={itemKey(item)} className={styles.homeRow}>
                      <span className={styles.reviewText}>
                        <span className={styles.homeName}>{item.name}</span>
                        {item.quantity_text && <span className={styles.reviewQty}>{item.quantity_text}</span>}
                      </span>
                      <button type="button" className={styles.smallChip} onClick={() => patchItem(item, { status: "buy", bought: false })}>
                        Comprar
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}

      {menuAnchor && (
        <MoreMenu
          anchor={menuAnchor}
          offline={offline}
          hideBought={hideBought}
          onNew={() => {
            setMenuAnchor(null);
            setSheet({ kind: "new" });
          }}
          onUpdate={() => void updateList()}
          onToggleHide={() => {
            setMenuAnchor(null);
            setHideBought(!hideBought);
          }}
          onClose={() => setMenuAnchor(null)}
        />
      )}

      {sheet?.kind === "new" && <NewListSheet hasList={hasList} offline={offline} onCreate={createList} onClose={() => setSheet(null)} />}
      {sheet?.kind === "add" && (
        <AddItemSheet
          items={items}
          offline={offline}
          onAdd={(fields) => {
            createItem(fields);
            setSheet(null);
            toast({ message: `Añadido a ${AISLE_LABEL[fields.aisle as Aisle] ?? "Otros"}` });
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === "aisle" && sheetItem && <AisleSheet item={sheetItem} onPick={(a) => moveTo(sheetItem, a)} onClose={() => setSheet(null)} />}
      {sheet?.kind === "actions" && sheetItem && (
        <ItemActionsSheet
          item={sheetItem}
          onToggle={() => {
            setSheet(null);
            toggle(sheetItem);
          }}
          onAisle={() => setSheet({ kind: "aisle", key: itemKey(sheetItem) })}
          onHome={() => {
            setSheet(null);
            setHome(sheetItem);
          }}
          onRemove={() => {
            setSheet(null);
            remove(sheetItem);
          }}
          onClose={() => setSheet(null)}
        />
      )}
    </main>
  );
}

function DoneButton({ names, open, onToggle }: { names: string[]; open: boolean; onToggle: () => void }) {
  return (
    <button type="button" className={`${styles.doneButton} glass`} aria-expanded={open} onClick={onToggle}>
      <span className={styles.doneCheck} aria-hidden="true">
        <Check size={16} strokeWidth={3} />
      </span>
      <span className={styles.doneText}>
        <span className={styles.doneTitle}>{names.length === 1 ? "1 sección completa" : `${names.length} secciones completas`}</span>
        <span className={styles.doneNames}>{names.join(" · ")}</span>
      </span>
      <ChevronDown size={18} className={styles.chevron} aria-hidden="true" />
    </button>
  );
}

function EmptyState({ offline, onCreate }: { offline: boolean; onCreate: () => void }) {
  const [info, setInfo] = useState<{ count: number; from: string; to: string } | null | undefined>(undefined);

  useEffect(() => {
    if (offline) return;
    let cancelled = false;
    const tomorrow = addDays(madridNow().date, 1);
    api
      .get<ShoppingCandidatesResponse>(`/shopping/candidates?from=${tomorrow}&to=${addDays(tomorrow, 20)}`)
      .then((res) => {
        if (cancelled) return;
        const first = res.meals[0];
        const last = res.meals[res.meals.length - 1];
        setInfo(first && last ? { count: res.meals.length, from: first.date, to: last.date } : null);
      })
      .catch(() => !cancelled && setInfo(null));
    return () => {
      cancelled = true;
    };
  }, [offline]);

  return (
    <section className={`${styles.empty} glass`}>
      <span className={styles.emptyIcon} aria-hidden="true">
        <ShoppingBag size={28} />
      </span>
      <h2 className={styles.emptyTitle}>No hay lista de la compra</h2>
      {offline ? (
        <p className={styles.emptyText}>Para crearla hace falta conexión.</p>
      ) : info === undefined ? (
        <p className={styles.emptyText}>Cargando…</p>
      ) : info ? (
        <>
          <p className={styles.emptyText}>
            Créala a partir de las comidas planificadas. Tienes {info.count} {longRange(info.from, info.to)}.
          </p>
          <button type="button" className={`pill-button pill-button--primary ${styles.emptyButton}`} onClick={onCreate}>
            Crear lista
          </button>
        </>
      ) : (
        <>
          <p className={styles.emptyText}>No hay comidas planificadas a partir de mañana.</p>
          <button type="button" className={`pill-button pill-button--primary ${styles.emptyButton}`} onClick={() => navigate("/planificador")}>
            Planifica primero la semana
          </button>
        </>
      )}
    </section>
  );
}
