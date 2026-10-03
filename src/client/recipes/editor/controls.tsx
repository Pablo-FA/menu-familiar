import { useLayoutEffect, useRef, type KeyboardEvent, type Ref } from "react";
import styles from "./Editor.module.css";

/** Área de texto que crece con el contenido (16 px: iOS no hace zoom al enfocarla). */
export function AutoTextarea({
  value,
  onChange,
  placeholder,
  label,
  ref,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  ref?: Ref<HTMLTextAreaElement>;
}) {
  const inner = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={(el) => {
        inner.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) ref.current = el;
      }}
      className={styles.textarea}
      value={value}
      rows={2}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function FieldError({ message }: { message: string | undefined }) {
  if (!message) return null;
  return (
    <span className={styles.fieldError} role="alert">
      {message}
    </span>
  );
}

/** Control segmentado (radiogroup) de 40 px. Flechas izquierda/derecha para cambiar. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  function onKey(e: KeyboardEvent) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const i = options.findIndex((o) => o.id === value);
    const next = options[(i + (e.key === "ArrowRight" ? 1 : options.length - 1)) % options.length];
    if (next) onChange(next.id);
  }
  return (
    <div className={styles.segmented} role="radiogroup" aria-label={label} onKeyDown={onKey}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          tabIndex={value === o.id ? 0 : -1}
          className={styles.segment}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
