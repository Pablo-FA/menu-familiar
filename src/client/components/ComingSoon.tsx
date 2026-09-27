import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import styles from "./ComingSoon.module.css";

export function ComingSoon({ title, Icon, children }: { title: string; Icon: LucideIcon; children?: ReactNode }) {
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>{title}</h1>
      <div className={`${styles.card} glass`}>
        <Icon size={40} strokeWidth={1.4} aria-hidden="true" />
        <strong>Próximamente</strong>
        {children && <p>{children}</p>}
      </div>
    </main>
  );
}
