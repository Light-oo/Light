import type { ReactNode } from "react";

type CardProps = {
  title?: string;
  className?: string;
  children: ReactNode;
};

export function Card({ title, className, children }: CardProps) {
  return (
    <section className={className ? `card ${className}` : "card"}>
      {title ? <h2>{title}</h2> : null}
      {children}
    </section>
  );
}

export function isInteractiveCardTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(
    target.closest(
      'button, a, input, select, textarea, summary, [role="button"], [data-card-interactive="true"]'
    )
  );
}

