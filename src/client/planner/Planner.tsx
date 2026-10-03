import { ArrowDownUp, ArrowUpDown, ChevronDown, ChevronLeft, ChevronRight, ClipboardPaste, Moon, Sparkles, Star, Sun, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { PlanMealWrite, PlanPreviewResponse, PlanRangeResponse, PlanSlotInfo, PreviewMeal, RecipeSummary } from "../../shared/api";
import { PROTEIN_LABEL, weekBalance } from "../../shared/balance";
import { addDays, isIsoDate, madridNow } from "../../shared/dates";
import { PLAN_FORMAT } from "../../shared/formats";
import { extractPlan } from "../../shared/plan-extract";
import { SLOTS, type Slot } from "../../shared/recipe-format";
import {
  dayTitle,
  isoWeekday,
  monthGrid,
  monthName,
  mondayOf,
  WEEKDAY_LETTERS,
  weekDays,
  weekMonth,
  weekRangeLabel,
  weekStatus,
  weekToOpen,
  weekdayOf,
} from "../../shared/week";
import { api } from "../api";
import { RatingDialog } from "../components/RatingSheet";
import { useToast } from "../components/Toast";
import { navigate } from "../router";
import { copyClaudeContext, openClaude, readClipboard } from "./claude";
import { ClaudeMenu } from "./ClaudeMenu";
import { PasteManual, PasteReview } from "./PasteReview";
import styles from "./Planner.module.css";
import { RecipePicker, type PickerChoice } from "./RecipePicker";
import { RecipeThumb } from "./RecipeThumb";
import { SlotActions, type SlotAction } from "./SlotActions";

const EMPTY: PlanSlotInfo = { status: "empty", note: null, recipe: null, cook_log: null };
const keyOf = (date: string, slot: Slot) => `${date}#${slot}`;
const SLOT_ADD: Record<Slot, string> = { lunch: "Añadir comida", dinner: "Añadir cena" };

type Sheet =
  | { kind: "picker"; date: string; slot: Slot }
  | { kind: "actions"; date: string; slot: Slot }
  | { kind: "rate"; date: string; slot: Slot }
  | { kind: "paste-manual" }
  | { kind: "review"; preview: PlanPreviewResponse; plan: { meals: Record<string, unknown>[]; recipes: { id: string }[] } }
  | null;

function initialWeek(today: string): string {
  const param = new URLSearchParams(window.location.search).get("semana");
  return param && isIsoDate(param) ? mondayOf(param) : weekToOpen(today);
}

function toWrite(date: string, slot: Slot, info: PlanSlotInfo): PlanMealWrite {
  return { date, slot, status: info.status, recipe_id: info.recipe?.id ?? null, note: info.note };
}

export function Planner() {
  const [today] = useState(() => madridNow().date);
  const [monday, setMonday] = useState(() => initialWeek(today));
  const [monthOpen, setMonthOpen] = useState(false);
  const [slots, setSlots] = useState<Map<string, PlanSlotInfo>>(new Map());
  const [loaded, setLoaded] = useState<string | null>(null);
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [moving, setMoving] = useState<{ date: string; slot: Slot } | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);
  const [reload, setReload] = useState(0);
  const toast = useToast();

  const { year, month } = weekMonth(monday);
  const grid = useMemo(() => monthGrid(year, month), [year, month]);
  const gridFrom = grid[0] ?? monday;
  const gridTo = addDays(grid[grid.length - 1] ?? monday, 6);
  const days = useMemo(() => weekDays(monday), [monday]);
  const sunday = days[6] ?? monday;

  // La semana visible va en la URL (iOS recarga la app al volver a ella).
  useEffect(() => {
    window.history.replaceState(null, "", `/planificador?semana=${monday}`);
  }, [monday]);

  // Datos: todo el mes de la cuadrícula (incluye la semana visible).
  useEffect(() => {
    let cancelled = false;
    api
      .get<PlanRangeResponse>(`/plan?from=${gridFrom}&to=${gridTo}`)
      .then((res) => {
        if (cancelled) return;
        const map = new Map<string, PlanSlotInfo>();
        for (const d of res.days) for (const s of SLOTS) map.set(keyOf(d.date, s), d[s]);
        setSlots(map);
        setLoaded(`${gridFrom}:${gridTo}`);
      })
      .catch(() => !cancelled && toast({ message: "No se ha podido cargar el menú" }));
    return () => {
      cancelled = true;
    };
  }, [gridFrom, gridTo, reload, toast]);

  useEffect(() => {
    let cancelled = false;
    api
      .get<RecipeSummary[]>("/recipes")
      .then((r) => !cancelled && setRecipes(r))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const recipeById = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);
  const info = useCallback((date: string, slot: Slot) => slots.get(keyOf(date, slot)) ?? EMPTY, [slots]);
  const weekSlots = useMemo(() => {
    const map = new Map<string, PlanSlotInfo>();
    for (const d of days) for (const s of SLOTS) map.set(keyOf(d, s), info(d, s));
    return map;
  }, [days, info]);

  const emptyDates = days.flatMap((d) => SLOTS.filter((s) => info(d, s).status === "empty").map(() => d));
  const status = weekStatus(monday, today, emptyDates);
  const emptyAhead = status.missing ?? 0;
  const balance = weekBalance([...weekSlots.values()].map((i) => ({ status: i.status, protein: i.recipe?.protein ?? null })));
  const subline = status.header;
  const barStatus = status.bar;

  // ---------- Escrituras (optimistas, con deshacer) ----------

  /** Valor local de una franja tras escribir `w` (la receta sale del listado). */
  const localFromWrite = useCallback(
    (w: PlanMealWrite, previous: PlanSlotInfo): PlanSlotInfo => {
      if (w.status !== "planned" || !w.recipe_id) return { status: w.status, note: w.note, recipe: null, cook_log: previous.cook_log };
      const r = recipeById.get(w.recipe_id);
      const recipe =
        previous.recipe?.id === w.recipe_id
          ? previous.recipe
          : r
            ? { id: r.id, title: r.title, minutes: r.minutes, protein: r.protein, suits: r.suits, photo_url: r.photo_url }
            : null;
      return { status: "planned", note: w.note, recipe, cook_log: previous.cook_log };
    },
    [recipeById],
  );

  async function write(changes: PlanMealWrite[], message: string, undoable = true) {
    {
      const previous = changes.map((c) => toWrite(c.date, c.slot, slots.get(keyOf(c.date, c.slot)) ?? EMPTY));
      const before = new Map(changes.map((c) => [keyOf(c.date, c.slot), slots.get(keyOf(c.date, c.slot)) ?? EMPTY]));
      setSlots((prev) => {
        const next = new Map(prev);
        for (const c of changes) next.set(keyOf(c.date, c.slot), localFromWrite(c, prev.get(keyOf(c.date, c.slot)) ?? EMPTY));
        return next;
      });
      try {
        await api.post("/plan/batch", { meals: changes });
        toast({
          message,
          action: undoable ? { label: "Deshacer", onClick: () => void write(previous, "Deshecho", false) } : undefined,
        });
      } catch {
        setSlots((prev) => {
          const next = new Map(prev);
          for (const [k, v] of before) next.set(k, v);
          return next;
        });
        toast({ message: "No se ha podido guardar el cambio" });
      }
    }
  }

  // ---------- Toques ----------

  const isPast = (date: string) => date < today;

  function onRow(date: string, slot: Slot) {
    const i = info(date, slot);
    if (moving) {
      if (moving.date === date && moving.slot === slot) return setMoving(null);
      if (isPast(date)) return;
      const origin = info(moving.date, moving.slot);
      const a = toWrite(moving.date, moving.slot, origin);
      const b = toWrite(date, slot, i);
      const destEmpty = i.status === "empty";
      const changes: PlanMealWrite[] = destEmpty
        ? [
            { ...a, date, slot },
            { date: moving.date, slot: moving.slot, status: "empty", recipe_id: null, note: null },
          ]
        : [
            { ...a, date, slot },
            { ...b, date: moving.date, slot: moving.slot },
          ];
      setMoving(null);
      void write(changes, destEmpty ? `Movida al ${weekdayOf(date)} ${Number(date.slice(8, 10))}` : "Intercambiadas");
      return;
    }
    if (isPast(date)) {
      if (i.recipe) setSheet({ kind: "actions", date, slot });
      return;
    }
    if (i.recipe) setSheet({ kind: "actions", date, slot });
    else setSheet({ kind: "picker", date, slot });
  }

  function onPick(date: string, slot: Slot, choice: PickerChoice) {
    const current = info(date, slot);
    setSheet(null);
    const base = { date, slot, note: current.note };
    if (choice.kind === "recipe") {
      if (current.recipe?.id === choice.recipe.id) return;
      void write([{ ...base, status: "planned", recipe_id: choice.recipe.id }], `${choice.recipe.title} · ${weekdayOf(date)}`);
    } else if (choice.kind === "away") {
      if (current.status === "away") return;
      void write([{ ...base, status: "away", recipe_id: null }], "Fuera de casa");
    } else {
      void write([{ ...base, status: "empty", recipe_id: null, note: null }], "Hueco vacío");
    }
  }

  function onAction(date: string, slot: Slot, action: SlotAction) {
    const current = info(date, slot);
    setSheet(null);
    if (action === "view" && current.recipe) navigate(`/receta/${encodeURIComponent(current.recipe.id)}`);
    if (action === "change") setSheet({ kind: "picker", date, slot });
    if (action === "move") setMoving({ date, slot });
    if (action === "rate") setSheet({ kind: "rate", date, slot });
    if (action === "away") void write([{ date, slot, status: "away", recipe_id: null, note: current.note }], "Fuera de casa");
    if (action === "remove") void write([{ date, slot, status: "empty", recipe_id: null, note: null }], "Quitada del menú");
  }

  async function saveRating(date: string, slot: Slot, stars: number | null, note: string | null) {
    const current = info(date, slot);
    if (!current.recipe) return;
    let cookLog = current.cook_log;
    if (cookLog) {
      await api.patch(`/cook-logs/${cookLog.id}`, { stars, note });
      cookLog = { ...cookLog, stars, note };
    } else {
      const res = await api.post<{ id: number }>("/cook-logs", {
        recipe_id: current.recipe.id,
        plan_meal_date: date,
        plan_meal_slot: slot,
        stars,
        note,
      });
      cookLog = { id: res.id, stars, note };
    }
    setSlots((prev) => new Map(prev).set(keyOf(date, slot), { ...current, cook_log: cookLog }));
    setSheet(null);
    toast({ message: "Valoración guardada" });
  }

  // ---------- Claude ----------

  function planWithClaude() {
    setMenuAnchor(null);
    // Sin await antes: el portapapeles de Safari exige que la escritura empiece en el toque.
    void copyClaudeContext(monday).then((ok) => {
      if (!ok) return toast({ message: "No se pudo copiar el resumen" });
      if (openClaude()) toast({ message: "Resumen copiado · abriendo Claude" });
      else toast({ message: "Resumen copiado", action: { label: "Abrir Claude", onClick: () => void openClaude() } });
    });
  }

  async function reviewText(text: string) {
    const plan = extractPlan(text) as { meals?: Record<string, unknown>[]; recipes?: { id: string }[] } | null;
    if (!plan) {
      toast({ message: "No he encontrado un menú de Claude en lo que has pegado." });
      return;
    }
    try {
      const preview = await api.post<PlanPreviewResponse>("/plan/preview", plan);
      setSheet({ kind: "review", preview, plan: { meals: plan.meals ?? [], recipes: plan.recipes ?? [] } });
    } catch {
      toast({ message: "No se ha podido revisar el menú" });
    }
  }

  function pasteMenu() {
    setMenuAnchor(null);
    // readText dentro del toque: iOS muestra su burbuja "Pegar".
    void readClipboard().then((text) => {
      if (text === null || !text.trim()) setSheet({ kind: "paste-manual" });
      else void reviewText(text);
    });
  }

  async function applyReview(plan: { meals: Record<string, unknown>[]; recipes: { id: string }[] }, selected: PreviewMeal[]) {
    const chosen = new Set(selected.map((m) => keyOf(m.date, m.slot)));
    const meals = plan.meals.filter((m) => chosen.has(`${String(m.date)}#${String(m.slot)}`));
    const used = new Set(selected.filter((m) => m.proposed.is_new).map((m) => m.proposed.recipe_id));
    const recipesToAdd = plan.recipes.filter((r) => used.has(r.id));
    try {
      await api.post("/plan/import", { format: PLAN_FORMAT, meals, recipes: recipesToAdd });
    } catch {
      toast({ message: "No se ha podido aplicar el menú" });
      return;
    }
    const previous: PlanMealWrite[] = selected.map((m) => ({
      date: m.date,
      slot: m.slot,
      status: m.current.status,
      recipe_id: m.current.recipe_id,
      note: m.current.note,
    }));
    setSheet(null);
    const first = [...selected].sort((a, b) => (a.date < b.date ? -1 : 1))[0];
    if (first) setMonday(mondayOf(first.date));
    setReload((n) => n + 1);
    toast({
      message: `Menú aplicado · ${selected.length === 1 ? "1 cambio" : `${selected.length} cambios`}`,
      action: {
        label: "Deshacer",
        onClick: () =>
          void api
            .post("/plan/batch", { meals: previous })
            .then(() => {
              setReload((n) => n + 1);
              toast({ message: "Deshecho" });
            })
            .catch(() => toast({ message: "No se ha podido deshacer" })),
      },
    });
  }

  // ---------- Navegación ----------

  const goWeek = (delta: number) => setMonday((m) => addDays(m, delta * 7));
  const dayRefs = useRef(new Map<string, HTMLElement>());
  const barRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const blurTintRef = useRef<HTMLDivElement>(null);
  const blurStrongRef = useRef<HTMLDivElement>(null);

  function scrollToDay(date: string) {
    const el = dayRefs.current.get(date);
    if (!el) return;
    const barBottom = barRef.current?.getBoundingClientRect().bottom ?? 80;
    const top = el.getBoundingClientRect().top + window.scrollY - barBottom - 10;
    window.scrollTo({ top, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  useScrollScene({ headerRef, barRef, blurTintRef, blurStrongRef }, moving !== null);

  useEffect(() => {
    if (!moving) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMoving(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [moving]);

  const ready = loaded === `${gridFrom}:${gridTo}`;
  const movingInfo = moving ? info(moving.date, moving.slot) : null;
  const sheetInfo = sheet && "date" in sheet ? info(sheet.date, sheet.slot) : null;
  const showClaudeCard = ready && emptyAhead > 0 && sunday >= today;

  return (
    <main className={styles.page}>
      <div ref={blurTintRef} className={styles.blurTint} aria-hidden="true" />
      <div ref={blurStrongRef} className={styles.blurStrong} aria-hidden="true" />

      {moving && movingInfo ? (
        <div className={`${styles.moveBar} glass-bar`} role="region" aria-label="Mover comida">
          <span className={styles.moveIcon} aria-hidden="true">
            <ArrowUpDown size={20} />
          </span>
          <div className={styles.moveText}>
            <p className={styles.moveTitle}>Mover: {movingInfo.recipe?.title ?? "Fuera de casa"}</p>
            <p className={styles.moveHint}>Toca el hueco de destino</p>
          </div>
          <button type="button" className={`${styles.circleButton} glass`} onClick={() => setMoving(null)} aria-label="Cancelar">
            <X size={20} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <div ref={barRef} className={`${styles.bar} glass-bar`} inert>
          <button type="button" className={styles.barButton} onClick={() => goWeek(-1)} aria-label="Semana anterior">
            <ChevronLeft size={22} aria-hidden="true" />
          </button>
          <div className={styles.barCenter}>
            <p className={styles.barRange}>{weekRangeLabel(monday)}</p>
            <p className={styles.barStatus}>{barStatus}</p>
          </div>
          <button type="button" className={styles.barButton} onClick={() => goWeek(1)} aria-label="Semana siguiente">
            <ChevronRight size={22} aria-hidden="true" />
          </button>
        </div>
      )}

      <div ref={headerRef} style={moving ? { visibility: "hidden" } : undefined}>
        <div className={styles.header}>
          <button type="button" className={styles.monthButton} aria-expanded={monthOpen} onClick={() => setMonthOpen(!monthOpen)}>
            <span className={styles.monthName}>
              {monthName(month)}
              {year !== Number(today.slice(0, 4)) ? ` ${year}` : ""}
            </span>
            <ChevronDown size={20} className={styles.chevron} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`${styles.circleButton} glass`}
            aria-label="Planificar con Claude"
            aria-haspopup="menu"
            onClick={(e) => setMenuAnchor(e.currentTarget.getBoundingClientRect())}
          >
            <Sparkles size={20} aria-hidden="true" />
          </button>
          <div className={`${styles.weekNav} glass`}>
            <button type="button" onClick={() => goWeek(-1)} aria-label="Semana anterior">
              <ChevronLeft size={22} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => goWeek(1)} aria-label="Semana siguiente">
              <ChevronRight size={22} aria-hidden="true" />
            </button>
          </div>
        </div>
        <p className={styles.subline} aria-live="polite">
          {subline}
        </p>
      </div>

      <section className={`${styles.calendar} glass`} aria-label="Calendario">
        {monthOpen ? (
          <MonthGrid
            grid={grid}
            month={month}
            monday={monday}
            today={today}
            info={info}
            onPick={(date) => {
              setMonday(mondayOf(date));
              setMonthOpen(false);
            }}
          />
        ) : (
          <div className={styles.strip}>
            {days.map((date) => (
              <button key={date} type="button" className={styles.dayButton} onClick={() => scrollToDay(date)} aria-label={dayTitle(date, true)}>
                <span className={styles.letter}>{WEEKDAY_LETTERS[isoWeekday(date) - 1]}</span>
                <span className={`${styles.num} ${date === today ? styles.today : ""}`}>{Number(date.slice(8, 10))}</span>
                <Dots date={date} info={info} />
              </button>
            ))}
          </div>
        )}
        <div className={styles.separator} />
        <div className={styles.balance} aria-label="Equilibrio de la semana">
          {balance.map((b) => (
            <div key={b.protein} className={styles[`tone_${b.tone}`]}>
              <span className={styles.balanceNum}>{b.count}</span>
              <span className={styles.balanceLabel}>{PROTEIN_LABEL[b.protein]}</span>
              <span className={styles.balanceHint}>{b.minimum !== null ? `mín. ${b.minimum}` : ""}</span>
            </div>
          ))}
        </div>
      </section>

      {showClaudeCard && (
        <section className={`${styles.claudeCard} glass`} aria-label="Planificar con Claude">
          <div className={styles.claudeTop}>
            <span className={styles.claudeIcon} aria-hidden="true">
              <Sparkles size={20} />
            </span>
            <div>
              <p className={styles.claudeTitle}>{emptyAhead === 1 ? "Falta 1 comida" : `Faltan ${emptyAhead} comidas`}</p>
              <p className={styles.claudeText}>Claude propone el resto con tus recetas, tus valoraciones y las reglas de casa.</p>
            </div>
          </div>
          <div className={styles.claudeActions}>
            <button type="button" className={`pill-button pill-button--primary ${styles.btn46} ${styles.primary}`} onClick={planWithClaude}>
              <Sparkles size={18} aria-hidden="true" /> Planificar con Claude
            </button>
            <button type="button" className={`pill-button pill-button--secondary ${styles.btn46}`} onClick={pasteMenu}>
              <ClipboardPaste size={18} aria-hidden="true" /> Pegar
            </button>
          </div>
        </section>
      )}

      {!ready && <p className={styles.empty}>Cargando…</p>}

      {days.map((date) => (
        <section
          key={date}
          className={styles.day}
          aria-label={dayTitle(date, true)}
          ref={(el) => {
            if (el) dayRefs.current.set(date, el);
            else dayRefs.current.delete(date);
          }}
        >
          <h2 className={styles.dayTitle}>
            {dayTitle(date)}
            {date === today && <span className={styles.todayPill}>Hoy</span>}
          </h2>
          <div className={`${styles.dayCard} glass`}>
            {SLOTS.map((slot, i) => (
              <div key={slot}>
                {i === 1 && <div className={styles.rowSep} />}
                <SlotRow
                  date={date}
                  slot={slot}
                  info={info(date, slot)}
                  past={isPast(date)}
                  moving={moving}
                  onClick={() => onRow(date, slot)}
                />
              </div>
            ))}
          </div>
        </section>
      ))}

      {menuAnchor && <ClaudeMenu anchor={menuAnchor} onPlan={planWithClaude} onPaste={pasteMenu} onClose={() => setMenuAnchor(null)} />}

      {sheet?.kind === "picker" && sheetInfo && (
        <RecipePicker
          date={sheet.date}
          slot={sheet.slot}
          current={sheetInfo}
          recipes={recipes}
          week={weekSlots}
          today={today}
          onPick={(choice) => onPick(sheet.date, sheet.slot, choice)}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === "actions" && sheetInfo && (
        <SlotActions
          date={sheet.date}
          slot={sheet.slot}
          info={sheetInfo}
          summary={sheetInfo.recipe ? recipeById.get(sheetInfo.recipe.id) : undefined}
          past={isPast(sheet.date)}
          onAction={(a) => onAction(sheet.date, sheet.slot, a)}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === "rate" && sheetInfo?.recipe && (
        <RatingDialog
          eyebrow={`El ${weekdayOf(sheet.date)} ${Number(sheet.date.slice(8, 10))} ${sheet.slot === "lunch" ? "comisteis" : "cenasteis"}`}
          title={sheetInfo.recipe.title}
          photoUrl={sheetInfo.recipe.photo_url}
          initialStars={sheetInfo.cook_log?.stars ?? null}
          initialNote={sheetInfo.cook_log?.note ?? ""}
          dismissLabel="Cancelar"
          onDismiss={() => setSheet(null)}
          onSave={(stars, note) => saveRating(sheet.date, sheet.slot, stars, note)}
        />
      )}
      {sheet?.kind === "paste-manual" && (
        <PasteManual
          onClose={() => setSheet(null)}
          onReview={(text) => {
            setSheet(null);
            void reviewText(text);
          }}
        />
      )}
      {sheet?.kind === "review" && (
        <PasteReview preview={sheet.preview} onClose={() => setSheet(null)} onApply={(selected) => applyReview(sheet.plan, selected)} />
      )}
    </main>
  );
}

function Dots({ date, info }: { date: string; info: (d: string, s: Slot) => PlanSlotInfo }) {
  return (
    <span className={styles.dots} aria-hidden="true">
      {SLOTS.map((s) => {
        const status = info(date, s).status;
        return <span key={s} className={`${styles.dot} ${styles[`dot_${status}`]}`} />;
      })}
    </span>
  );
}

function MonthGrid({
  grid,
  month,
  monday,
  today,
  info,
  onPick,
}: {
  grid: string[];
  month: number;
  monday: string;
  today: string;
  info: (d: string, s: Slot) => PlanSlotInfo;
  onPick: (date: string) => void;
}) {
  const row = Math.max(0, grid.indexOf(monday));
  return (
    <div>
      <div className={styles.letters} aria-hidden="true">
        {WEEKDAY_LETTERS.map((l) => (
          <span key={l} className={styles.letter}>
            {l}
          </span>
        ))}
      </div>
      <div className={styles.grid}>
        <div className={styles.band} style={{ top: row * 56 }} aria-hidden="true" />
        {grid.map((weekMonday) => (
          <div key={weekMonday} className={styles.gridRow}>
            {weekDays(weekMonday).map((date) => (
              <button
                key={date}
                type="button"
                className={`${styles.gridDay} ${Number(date.slice(5, 7)) !== month ? styles.outside : ""}`}
                onClick={() => onPick(date)}
                aria-label={dayTitle(date, true)}
              >
                <span className={`${styles.num} ${date === today ? styles.today : ""}`}>{Number(date.slice(8, 10))}</span>
                <Dots date={date} info={info} />
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function SlotRow({
  date,
  slot,
  info,
  past,
  moving,
  onClick,
}: {
  date: string;
  slot: Slot;
  info: PlanSlotInfo;
  past: boolean;
  moving: { date: string; slot: Slot } | null;
  onClick: () => void;
}) {
  const recipe = info.recipe;
  const isOrigin = moving?.date === date && moving.slot === slot;
  const inert = moving ? past && !isOrigin : past && !recipe;
  const SlotIcon = slot === "lunch" ? Sun : Moon;
  const stars = info.cook_log?.stars ?? null;

  let end: ReactNode = null;
  if (moving && !past && !isOrigin) {
    end = (
      <span className={styles.swapChip} aria-hidden="true">
        <ArrowDownUp size={16} />
      </span>
    );
  } else if (!moving && recipe && !past) {
    end = <ChevronRight size={18} className={styles.faint} aria-hidden="true" />;
  } else if (!moving && recipe && past) {
    end =
      stars !== null ? (
        <span className={styles.stars}>
          <Star size={15} fill="currentColor" strokeWidth={0} aria-hidden="true" />
          {stars}
        </span>
      ) : (
        <span className={styles.smallChip}>Sin valorar</span>
      );
  }

  const title = recipe ? recipe.title : info.status === "away" ? "Fuera de casa" : SLOT_ADD[slot];
  const label = `${slot === "lunch" ? "Comida" : "Cena"}: ${title}${stars !== null && past ? `, ${stars} estrellas` : ""}`;

  return (
    <button
      type="button"
      className={`${styles.row} ${moving && past && !isOrigin ? styles.rowDimmed : ""} ${isOrigin ? styles.rowOrigin : ""}`}
      onClick={onClick}
      disabled={inert}
      aria-label={label}
    >
      <SlotIcon size={17} className={styles.slotIcon} aria-hidden="true" />
      <RecipeThumb kind={recipe ? "recipe" : info.status === "away" ? "away" : "empty"} photoUrl={recipe?.photo_url ?? null} />
      <span className={styles.rowText}>
        <span className={`${styles.rowTitle} ${recipe ? "" : styles.rowTitleMuted}`}>{title}</span>
        {recipe && (
          <span className={styles.rowMeta}>
            {recipe.minutes} min · {PROTEIN_LABEL[recipe.protein]}
          </span>
        )}
      </span>
      {end && <span className={styles.rowEnd}>{end}</span>}
    </button>
  );
}

// ---------- Escena ligada al scroll (mismo mecanismo que Hoy) ----------

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smoothstep = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

function useScrollScene(
  refs: {
    headerRef: RefObject<HTMLElement | null>;
    barRef: RefObject<HTMLElement | null>;
    blurTintRef: RefObject<HTMLElement | null>;
    blurStrongRef: RefObject<HTMLElement | null>;
  },
  moving: boolean,
) {
  const { headerRef, barRef, blurTintRef, blurStrongRef } = refs;
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    function apply() {
      frame = 0;
      const s = Math.max(0, window.scrollY);
      if (headerRef.current) headerRef.current.style.opacity = String(clamp01(1 - s / 70));
      const bar = barRef.current;
      if (bar) {
        const p = smoothstep((s - 50) / 60);
        bar.style.opacity = String(p);
        bar.style.transform = reduce ? "" : `translate3d(0, ${-12 * (1 - p)}px, 0) scale(${0.92 + 0.08 * p})`;
        const interactive = p >= 0.5;
        bar.style.pointerEvents = interactive ? "auto" : "none";
        bar.inert = !interactive;
      }
      // En modo mover, el desenfoque superior queda siempre activo.
      const blur = moving ? "1" : String(clamp01((s - 10) / 60));
      if (blurTintRef.current) blurTintRef.current.style.opacity = blur;
      if (blurStrongRef.current) blurStrongRef.current.style.opacity = blur;
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    apply();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [headerRef, barRef, blurTintRef, blurStrongRef, moving]);
}
