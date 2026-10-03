import { Check, EyeOff, Eye, House, LayoutList, ListPlus, RefreshCw, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AISLE_LABEL, AISLE_LIST, isAisle, type Aisle } from "../../shared/aisles";
import type { IngredientSuggestion, ShoppingCandidatesResponse, ShoppingItem } from "../../shared/api";
import { addDays, isIsoDate, madridNow, shortDate } from "../../shared/dates";
import type { CreateFields } from "../../shared/shopping-sync";
import { capitalizeName } from "../../shared/shopping";
import { slugify } from "../../shared/slug";
import { mondayOf } from "../../shared/week";
import { api, ApiRequestError } from "../api";
import { Sheet } from "../components/Sheet";
import styles from "./Shopping.module.css";

// ---------- Menú «…» ----------

export function MoreMenu({
  anchor,
  offline,
  hideBought,
  onNew,
  onUpdate,
  onToggleHide,
  onClose,
}: {
  anchor: DOMRect;
  offline: boolean;
  hideBought: boolean;
  onNew: () => void;
  onUpdate: () => void;
  onToggleHide: () => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const right = Math.max(12, window.innerWidth - anchor.right);
  const needs = offline ? "Necesita conexión" : null;
  return (
    <>
      <div className={styles.menuOverlay} onClick={onClose} aria-hidden="true" />
      <div ref={menuRef} className={styles.menu} role="menu" aria-label="Más opciones" style={{ top: anchor.bottom + 8, right }}>
        <button type="button" role="menuitem" className={styles.menuItem} onClick={onNew} disabled={offline}>
          <ListPlus size={20} aria-hidden="true" />
          <span>
            <strong>Nueva lista</strong>
            <span>{needs ?? "Elige qué comidas cubre"}</span>
          </span>
        </button>
        <button type="button" role="menuitem" className={styles.menuItem} onClick={onUpdate} disabled={offline}>
          <RefreshCw size={20} aria-hidden="true" />
          <span>
            <strong>Actualizar con el menú</strong>
            <span>{needs ?? "Si has cambiado comidas"}</span>
          </span>
        </button>
        <button type="button" role="menuitem" className={styles.menuItem} onClick={onToggleHide}>
          {hideBought ? <Eye size={20} aria-hidden="true" /> : <EyeOff size={20} aria-hidden="true" />}
          <span>
            <strong>{hideBought ? "Mostrar lo comprado" : "Ocultar lo comprado"}</strong>
          </span>
        </button>
      </div>
    </>
  );
}

// ---------- Nueva lista ----------

type Preset = "all" | "next-week" | "14";
const PRESETS: Preset[] = ["all", "next-week", "14"];
const PRESET_LABEL: Record<Preset, string> = { all: "Todo lo planificado", "next-week": "Semana que viene", "14": "Próximos 14 días" };
/** "Todo lo planificado" mira hasta 21 días por delante. */
const LOOKAHEAD_DAYS = 21;
const SLOT_UPPER = { lunch: "COMIDA", dinner: "CENA" } as const;

const mealKey = (m: { date: string; slot: string }) => `${m.date}#${m.slot}`;

function presetRange(preset: Preset, today: string): { from: string; to: string } {
  const tomorrow = addDays(today, 1);
  if (preset === "next-week") {
    const monday = addDays(mondayOf(today), 7);
    return { from: monday, to: addDays(monday, 6) };
  }
  if (preset === "14") return { from: tomorrow, to: addDays(tomorrow, 13) };
  return { from: tomorrow, to: addDays(tomorrow, LOOKAHEAD_DAYS - 1) };
}

export function NewListSheet({
  hasList,
  offline,
  onCreate,
  onClose,
}: {
  hasList: boolean;
  offline: boolean;
  onCreate: (body: { from: string; to: string; excluded: { date: string; slot: string }[]; carry: boolean }) => Promise<void>;
  onClose: () => void;
}) {
  const [today] = useState(() => madridNow().date);
  const [preset, setPreset] = useState<Preset | null>("all");
  const [range, setRange] = useState(() => presetRange("all", today));
  const [data, setData] = useState<{ key: string; res: ShoppingCandidatesResponse } | null>(null);
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [carry, setCarry] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rangeKey = `${range.from}:${range.to}`;
  useEffect(() => {
    if (offline || range.to < range.from) return;
    let cancelled = false;
    api
      .get<ShoppingCandidatesResponse>(`/shopping/candidates?from=${range.from}&to=${range.to}`)
      .then((res) => {
        if (cancelled) return;
        setData({ key: `${range.from}:${range.to}`, res });
        // «Todo lo planificado» acaba en la última comida planificada.
        const last = res.meals[res.meals.length - 1];
        if (preset === "all" && last && last.date < range.to) setRange((r) => ({ ...r, to: last.date }));
      })
      .catch(() => !cancelled && setError("No se han podido cargar las comidas"));
    return () => {
      cancelled = true;
    };
  }, [range.from, range.to, preset, offline]);

  const meals = useMemo(() => (data && rangeKey === data.key ? data.res.meals : []), [data, rangeKey]);
  const pendingInList = data?.res.pending ?? 0;
  const loaded = data !== null && rangeKey === data.key;
  const chosen = meals.filter((m) => !unchecked.has(mealKey(m)));

  function pick(p: Preset) {
    setPreset(p);
    setRange(presetRange(p, today));
  }

  function setDate(which: "from" | "to", value: string) {
    if (!isIsoDate(value)) return;
    setPreset(null);
    setRange((r) => {
      const next = { ...r, [which]: value };
      return next.to < next.from ? { from: value, to: value } : next;
    });
  }

  async function create() {
    setSaving(true);
    setError(null);
    try {
      await onCreate({
        from: range.from,
        to: range.to,
        excluded: meals.filter((m) => unchecked.has(mealKey(m))).map((m) => ({ date: m.date, slot: m.slot })),
        carry: carry && pendingInList > 0,
      });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "No se ha podido crear la lista. ¿Hay conexión?");
      setSaving(false);
    }
  }

  return (
    <Sheet
      label="Nueva lista"
      onClose={onClose}
      top="calc(var(--safe-top) + 58px)"
      head={
        <>
          <div className={styles.sheetHead}>
            <div className={styles.sheetHeadText}>
              <h2 className={styles.sheetTitle}>Nueva lista</h2>
              <p className={styles.sheetSub}>Elige qué comidas cubre esta compra</p>
            </div>
            <button type="button" className={styles.close36} onClick={onClose} aria-label="Cerrar">
              <X size={18} strokeWidth={2.2} aria-hidden="true" />
            </button>
          </div>
          <div className={styles.datePills}>
            <DatePill label="Desde" value={range.from} onChange={(v) => setDate("from", v)} />
            <DatePill label="Hasta" value={range.to} min={range.from} onChange={(v) => setDate("to", v)} />
          </div>
          <div className={styles.presets} role="radiogroup" aria-label="Rango">
            {PRESETS.map((p) => (
              <button key={p} type="button" role="radio" aria-checked={preset === p} className={styles.filterChip} onClick={() => pick(p)}>
                {PRESET_LABEL[p]}
              </button>
            ))}
          </div>
        </>
      }
      footer={
        <>
          {error && (
            <p className={styles.formError} role="alert">
              {error}
            </p>
          )}
          <button
            type="button"
            className={`pill-button pill-button--primary ${styles.wide}`}
            disabled={offline || saving || chosen.length === 0}
            onClick={() => void create()}
          >
            {offline ? "Necesita conexión" : `Crear lista · ${chosen.length} ${chosen.length === 1 ? "comida" : "comidas"}`}
          </button>
          {hasList && <p className={styles.footerNote}>Sustituye a la lista actual</p>}
        </>
      }
    >
      <div className={styles.listHead}>
        <span className={styles.listCount}>
          {chosen.length} de {meals.length} comidas
        </span>
        <span className={styles.listHint}>Desmarca lo que tengas congelado</span>
      </div>
      {!loaded && !offline ? (
        <p className={styles.muted}>Cargando…</p>
      ) : meals.length === 0 ? (
        <p className={styles.muted}>No hay comidas planificadas en esas fechas.</p>
      ) : (
        <ul className={styles.group}>
          {meals.map((m) => {
            const on = !unchecked.has(mealKey(m));
            const day = shortDate(m.date).split(" ").slice(0, 2).join(" ").toUpperCase();
            return (
              <li key={mealKey(m)}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  className={styles.option}
                  onClick={() =>
                    setUnchecked((prev) => {
                      const next = new Set(prev);
                      if (on) next.add(mealKey(m));
                      else next.delete(mealKey(m));
                      return next;
                    })
                  }
                >
                  <span className={styles.check} aria-hidden="true">
                    {on && <Check size={16} strokeWidth={3} />}
                  </span>
                  <span className={styles.mealText}>
                    <span className={styles.eyebrow}>
                      {day} · {SLOT_UPPER[m.slot]}
                    </span>
                    <span className={styles.mealTitle}>{m.title}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {pendingInList > 0 && (
        <div className={`${styles.group} ${styles.switchRow}`}>
          <span className={styles.mealText}>
            <span className={styles.switchTitle} id="carry-label">
              Pasar lo que no compraste
            </span>
            <span className={styles.switchSub}>
              {pendingInList} {pendingInList === 1 ? "cosa sin comprar" : "cosas sin comprar"} de la lista actual
            </span>
          </span>
          <button type="button" role="switch" aria-checked={carry} aria-labelledby="carry-label" className={styles.switch} onClick={() => setCarry(!carry)}>
            <span className={styles.knob} />
          </button>
        </div>
      )}
    </Sheet>
  );
}

function DatePill({ label, value, min, onChange }: { label: string; value: string; min?: string; onChange: (v: string) => void }) {
  return (
    <label className={styles.datePill}>
      <span className={styles.datePillLabel}>{label}</span>
      <span className={styles.datePillValue}>{shortDate(value)}</span>
      <input type="date" value={value} min={min} onChange={(e) => onChange(e.target.value)} aria-label={label} />
    </label>
  );
}

// ---------- Añadir a la lista ----------

export function AddItemSheet({
  items,
  offline,
  onAdd,
  onClose,
}: {
  items: ShoppingItem[];
  offline: boolean;
  onAdd: (fields: CreateFields) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [aisle, setAisle] = useState<Aisle>("otros");
  const [picked, setPicked] = useState<IngredientSuggestion | null>(null);
  const [found, setFound] = useState<{ q: string; list: IngredientSuggestion[] } | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const q = slugify(name);
  useEffect(() => {
    if (offline || !q || picked) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api
        .get<IngredientSuggestion[]>(`/ingredients?q=${encodeURIComponent(q)}`)
        .then((list) => !cancelled && setFound({ q, list }))
        .catch(() => undefined);
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [q, offline, picked]);

  const suggestions = !picked && found && found.q === q ? found.list.slice(0, 5) : [];
  const existing = q ? items.find((i) => slugify(i.name) === q || (picked !== null && i.ingredient_id === picked.id)) : undefined;

  function choose(s: IngredientSuggestion) {
    setPicked(s);
    setName(capitalizeName(s.name));
    if (isAisle(s.aisle)) setAisle(s.aisle);
  }

  function submit() {
    const clean = name.trim();
    if (!clean) return;
    onAdd({
      name: capitalizeName(clean),
      quantity_text: quantity.trim() || null,
      aisle,
      ingredient_id: picked && slugify(picked.name) === slugify(clean) ? picked.id : null,
    });
  }

  return (
    <Sheet
      label="Añadir a la lista"
      onClose={onClose}
      head={
        <div className={styles.sheetHead}>
          <div className={styles.sheetHeadText}>
            <h2 className={styles.sheetTitle}>Añadir a la lista</h2>
          </div>
          <button type="button" className={styles.close36} onClick={onClose} aria-label="Cerrar">
            <X size={18} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
      }
      footer={
        <button type="submit" form="add-item" className={`pill-button pill-button--primary ${styles.wide}`} disabled={!name.trim()}>
          Añadir
        </button>
      }
    >
      <form
        id="add-item"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className={`${styles.group} ${styles.fields}`}>
          <label className={styles.field}>
            <span className="visually-hidden">Qué necesitas</span>
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setPicked(null);
              }}
              placeholder="Qué necesitas"
              autoComplete="off"
              enterKeyHint="next"
              maxLength={80}
            />
          </label>
          <label className={styles.field}>
            <span className="visually-hidden">Cantidad (opcional)</span>
            <input value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="Cantidad (opcional)" autoComplete="off" maxLength={40} enterKeyHint="done" />
          </label>
        </div>
        {suggestions.length > 0 && (
          <div className={styles.suggestions} aria-label="Del catálogo">
            {suggestions.map((s) => (
              <button key={s.id} type="button" className={styles.filterChip} onClick={() => choose(s)}>
                {capitalizeName(s.name)}
              </button>
            ))}
          </div>
        )}
        {existing && (
          <p className={styles.already} role="status">
            Ya está en la lista{existing.quantity_text ? `: ${existing.quantity_text}` : ""}
          </p>
        )}
        <p className={styles.fieldsLabel} id="aisle-label">
          Sección
        </p>
        <div className={styles.aisleChips} role="radiogroup" aria-labelledby="aisle-label">
          {AISLE_LIST.map((a) => (
            <button key={a.id} type="button" role="radio" aria-checked={aisle === a.id} className={styles.filterChip} onClick={() => setAisle(a.id)}>
              {a.label}
            </button>
          ))}
        </div>
      </form>
    </Sheet>
  );
}

// ---------- Mover de sección ----------

export function AisleSheet({ item, onPick, onClose }: { item: ShoppingItem; onPick: (aisle: Aisle) => void; onClose: () => void }) {
  return (
    <Sheet
      label={`Mover ${item.name}`}
      onClose={onClose}
      top="calc(var(--safe-top) + 58px)"
      head={
        <div className={styles.sheetHead}>
          <div className={styles.sheetHeadText}>
            <h2 className={styles.sheetTitle}>Mover «{item.name}»</h2>
            <p className={styles.sheetSub}>{item.ingredient_id ? "Se recordará en las próximas listas" : "Solo en esta lista"}</p>
          </div>
          <button type="button" className={styles.close36} onClick={onClose} aria-label="Cerrar">
            <X size={18} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
      }
    >
      <ul className={styles.group}>
        {AISLE_LIST.map((a) => (
          <li key={a.id}>
            <button type="button" className={`${styles.option} ${styles.aisleRow}`} aria-current={item.aisle === a.id} onClick={() => onPick(a.id)}>
              <span className={styles.mealText}>{a.label}</span>
              {item.aisle === a.id && <Check size={20} aria-label="Actual" />}
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

// ---------- Acciones sin gesto ----------

/** Lo mismo que el gesto de deslizar, para quien no lo usa (teclado, VoiceOver). */
export function ItemActionsSheet({
  item,
  onToggle,
  onAisle,
  onHome,
  onRemove,
  onClose,
}: {
  item: ShoppingItem;
  onToggle: () => void;
  onAisle: () => void;
  onHome: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet
      label={`${item.name}: acciones`}
      onClose={onClose}
      head={
        <div className={styles.sheetHead}>
          <div className={styles.sheetHeadText}>
            <h2 className={styles.sheetTitle}>{item.name}</h2>
            {item.quantity_text && <p className={styles.sheetSub}>{item.quantity_text}</p>}
          </div>
          <button type="button" className={styles.close36} onClick={onClose} aria-label="Cerrar">
            <X size={18} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
      }
    >
      <ul className={styles.group}>
        <li>
          <button type="button" className={`${styles.option} ${styles.aisleRow}`} onClick={onToggle}>
            <Check size={20} aria-hidden="true" />
            {item.bought ? "Desmarcar" : "Marcar como comprado"}
          </button>
        </li>
        <li>
          <button type="button" className={`${styles.option} ${styles.aisleRow}`} onClick={onAisle}>
            <LayoutList size={20} aria-hidden="true" />
            Cambiar de sección · {AISLE_LABEL[isAisle(item.aisle) ? item.aisle : "otros"]}
          </button>
        </li>
        {item.manual ? (
          <li>
            <button type="button" className={`${styles.option} ${styles.aisleRow} ${styles.danger}`} onClick={onRemove}>
              <Trash2 size={20} aria-hidden="true" />
              Quitar de la lista
            </button>
          </li>
        ) : (
          <li>
            <button type="button" className={`${styles.option} ${styles.aisleRow}`} onClick={onHome}>
              <House size={20} aria-hidden="true" />
              En casa
            </button>
          </li>
        )}
      </ul>
    </Sheet>
  );
}

