import { ArrowDown, ArrowUp, ChevronDown, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { AISLE_LABEL, AISLE_LIST, isAisle, type Aisle } from "../../../shared/aisles";
import type { IngredientSuggestion } from "../../../shared/api";
import { defaultAisle, emptyIngredient, parseQuantity, type DraftIngredient, type RecipeDraft } from "../../../shared/recipe-draft";
import { UNITS, type Unit } from "../../../shared/recipe-format";
import { slugify } from "../../../shared/slug";
import { api } from "../../api";
import { capitalize, formatQuantity } from "../../format";
import { FieldError } from "./controls";
import type { Errors } from "./Editor";
import styles from "./Editor.module.css";

type Known = Map<string, { aisle: Aisle; pantry: boolean }>;

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

function qtyLabel(ing: DraftIngredient): string {
  const q = parseQuantity(ing.quantity);
  if (q === null || Number.isNaN(q)) return "";
  return formatQuantity({ quantity: q, unit: ing.unit, estimated: ing.estimated });
}

export function IngredientsTab({
  draft,
  errors,
  setDraft,
}: {
  draft: RecipeDraft;
  errors: Errors;
  setDraft: Dispatch<SetStateAction<RecipeDraft>>;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  // Ingredientes que ya están en el catálogo (los de la receta y los sugeridos), por slug.
  const [known, setKnown] = useState<Known>(
    () => new Map(draft.ingredients.map((i) => [slugify(i.name), { aisle: i.aisle, pantry: i.pantry }])),
  );
  const list = draft.ingredients;
  // Estable: lo usa el efecto del autocompletado.
  const addKnown = useCallback(
    (s: IngredientSuggestion) =>
      setKnown((k) => (k.has(s.id) ? k : new Map(k).set(s.id, { aisle: isAisle(s.aisle) ? s.aisle : "otros", pantry: false }))),
    [],
  );

  const setList = (fn: (list: DraftIngredient[]) => DraftIngredient[]) => setDraft((d) => ({ ...d, ingredients: fn(d.ingredients) }));
  const patch = (key: string, p: Partial<DraftIngredient>) => setList((l) => l.map((i) => (i.key === key ? { ...i, ...p } : i)));

  function add() {
    const ing = emptyIngredient();
    setList((l) => [...l, ing]);
    setOpen(ing.key);
    setFocusKey(ing.key);
  }

  return (
    <>
      <div className={styles.listHead}>
        <span className={styles.label}>
          {list.length} {list.length === 1 ? "INGREDIENTE" : "INGREDIENTES"}
        </span>
        <span className={styles.hint}>Para 4 raciones</span>
      </div>
      <FieldError message={errors.get("ingredients")} />
      <ul className={`${styles.group} ${styles.list}`}>
        {list.map((ing, index) => {
          const isOpen = open === ing.key;
          const rowErrors = [...errors.keys()].some((f) => f.startsWith(`ingredients[${index}]`));
          return (
            <li key={ing.key} className={styles.ingItem} data-open={isOpen}>
              <button
                type="button"
                className={styles.ingRow}
                aria-expanded={isOpen}
                aria-controls={`ing-${ing.key}`}
                onClick={() => setOpen(isOpen ? null : ing.key)}
              >
                <span className={`${styles.grow} ${styles.ingName}`}>{ing.name ? capitalize(ing.name) : "Ingrediente sin nombre"}</span>
                {rowErrors && <span className={styles.errorDot} aria-label="Tiene errores" />}
                <span className={styles.ingQty}>{qtyLabel(ing)}</span>
                <ChevronDown size={18} className={styles.chevron} aria-hidden="true" />
              </button>
              {isOpen && (
                <IngredientPanel
                  ing={ing}
                  index={index}
                  count={list.length}
                  errors={errors}
                  known={known}
                  autoFocus={focusKey === ing.key}
                  onKnown={addKnown}
                  patch={(p) => patch(ing.key, p)}
                  onMove={(delta) => setList((l) => move(l, index, index + delta))}
                  onRemove={() => {
                    setOpen(null);
                    setList((l) => l.filter((i) => i.key !== ing.key));
                  }}
                />
              )}
            </li>
          );
        })}
      </ul>
      <button type="button" className={styles.addButton} onClick={add}>
        <Plus size={18} aria-hidden="true" /> Añadir ingrediente
      </button>
    </>
  );
}

function IngredientPanel({
  ing,
  index,
  count,
  errors,
  known,
  autoFocus,
  onKnown,
  patch,
  onMove,
  onRemove,
}: {
  ing: DraftIngredient;
  index: number;
  count: number;
  errors: Errors;
  known: Known;
  autoFocus: boolean;
  onKnown: (s: IngredientSuggestion) => void;
  patch: (p: Partial<DraftIngredient>) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  const [found, setFound] = useState<{ q: string; list: IngredientSuggestion[] } | null>(null);
  const [typing, setTyping] = useState(false);
  const slug = slugify(ing.name);
  const catalog = known.get(slug);
  const err = (field: string) => errors.get(`ingredients[${index}].${field}`);

  useEffect(() => {
    if (autoFocus) nameRef.current?.focus();
  }, [autoFocus]);

  // Autocompletado del catálogo mientras se escribe el nombre.
  useEffect(() => {
    if (!typing || !slug) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api
        .get<IngredientSuggestion[]>(`/ingredients?q=${encodeURIComponent(slug)}`)
        .then((list) => {
          if (cancelled) return;
          setFound({ q: slug, list });
          const exact = list.find((s) => s.id === slug);
          if (exact) onKnown(exact);
        })
        .catch(() => undefined);
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [slug, typing, onKnown]);

  const suggestions = useMemo(
    () => (typing && found && found.q === slug ? found.list.filter((s) => s.id !== slug).slice(0, 5) : []),
    [typing, found, slug],
  );

  function setUnit(unit: Unit | null) {
    if (unit === null) patch({ unit: null, quantity: "" });
    else patch({ unit });
  }

  return (
    <div id={`ing-${ing.key}`} className={styles.ingPanel}>
      <div className={styles.inline}>
        <label className={styles.qtyField}>
          <span className={styles.fieldLabel}>Cantidad</span>
          <input
            className={styles.qtyInput}
            inputMode="decimal"
            value={ing.quantity}
            onChange={(e) => patch({ quantity: e.target.value.replace(/[^\d.,]/g, "") })}
            placeholder="—"
          />
        </label>
        <button type="button" className={styles.chip} aria-pressed={ing.estimated} onClick={() => patch({ estimated: !ing.estimated })}>
          ≈ Estimada
        </button>
      </div>
      <FieldError message={err("quantity")} />
      <div className={styles.chips} role="radiogroup" aria-label="Unidad">
        {UNITS.map((u) => (
          <button key={u} type="button" role="radio" aria-checked={ing.unit === u} className={styles.chip} onClick={() => setUnit(u)}>
            {u}
          </button>
        ))}
        <button type="button" role="radio" aria-checked={ing.unit === null && ing.quantity === ""} className={styles.chip} onClick={() => setUnit(null)}>
          Sin cantidad
        </button>
      </div>
      <FieldError message={err("unit")} />

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Como aparece en la receta</span>
        <input className={styles.input} value={ing.text} onChange={(e) => patch({ text: e.target.value })} placeholder={ing.name || "2 cebollas medianas"} />
        <FieldError message={err("text")} />
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>
          Ingrediente del catálogo{catalog ? ` · ${AISLE_LABEL[catalog.aisle]}` : slug ? " · nuevo" : ""}
        </span>
        <input
          ref={nameRef}
          className={styles.input}
          value={ing.name}
          onChange={(e) => {
            setTyping(true);
            const name = e.target.value;
            const k = known.get(slugify(name));
            patch(k ? { name, aisle: k.aisle, pantry: k.pantry } : { name, aisle: defaultAisle(name) });
          }}
          onBlur={() => window.setTimeout(() => setTyping(false), 200)}
          placeholder="cebolla"
          autoComplete="off"
          autoCapitalize="off"
        />
        <FieldError message={err("name")} />
      </label>
      {suggestions.length > 0 && (
        <div className={styles.chips} aria-label="Del catálogo">
          {suggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              className={styles.chip}
              onClick={() => {
                onKnown(s);
                setTyping(false);
                patch({ name: s.name, aisle: isAisle(s.aisle) ? s.aisle : "otros" });
              }}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {slug && !catalog && (
        <>
          <p className={styles.fieldLabel} id={`aisle-${ing.key}`}>
            Sección (ingrediente nuevo)
          </p>
          <div className={styles.chips} role="radiogroup" aria-labelledby={`aisle-${ing.key}`} data-wrap="true">
            {AISLE_LIST.map((a) => (
              <button key={a.id} type="button" role="radio" aria-checked={ing.aisle === a.id} className={styles.chip} onClick={() => patch({ aisle: a.id })}>
                {a.label}
              </button>
            ))}
          </div>
          <div className={styles.switchRow}>
            <span className={styles.grow} id={`pantry-${ing.key}`}>
              Suele haber en casa
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={ing.pantry}
              aria-labelledby={`pantry-${ing.key}`}
              className={styles.switch}
              onClick={() => patch({ pantry: !ing.pantry })}
            >
              <span className={styles.knob} />
            </button>
          </div>
        </>
      )}

      <div className={styles.rowTools}>
        <button type="button" className={styles.tool36} onClick={() => onMove(-1)} disabled={index === 0} aria-label="Subir">
          <ArrowUp size={18} aria-hidden="true" />
        </button>
        <button type="button" className={styles.tool36} onClick={() => onMove(1)} disabled={index === count - 1} aria-label="Bajar">
          <ArrowDown size={18} aria-hidden="true" />
        </button>
        <button type="button" className={`${styles.tool36} ${styles.danger}`} onClick={onRemove} aria-label={`Quitar ${ing.name || "ingrediente"}`}>
          <Trash2 size={18} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
