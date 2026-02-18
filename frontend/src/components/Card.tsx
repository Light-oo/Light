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

