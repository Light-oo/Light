import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import logoLoader from "../assets/logo-loader.svg";

type ColumnKey = "intention" | "what" | "where" | "howMuch";

type ReelRow = Record<ColumnKey, string>;

const columns: ColumnKey[] = ["intention", "what", "where", "howMuch"];

const sequence: ReelRow[] = [
  { intention: "Compro", what: "Silvin", where: "San Salvador", howMuch: "?" },
  { intention: "Vendo", what: "Bumper", where: "San Martin", howMuch: "$75" },
  { intention: "Busco", what: "Alternador", where: "La Union", howMuch: "?" },
  { intention: "Vendo", what: "Radiador", where: "Soyapango", howMuch: "$125" },
  { intention: "Compro", what: "Escape", where: "San Salvador", howMuch: "$50" },
  { intention: "Vendo", what: "Clutch", where: "Apopa", howMuch: "$60" },
  { intention: "Busco", what: "Tijeras", where: "Quezaltepeque", howMuch: "$40" }
];

function mod(index: number, length: number) {
  return ((index % length) + length) % length;
}

function ReelColumn({
  columnKey,
  stepIndex
}: {
  columnKey: ColumnKey;
  stepIndex: number;
}) {
  const current = mod(stepIndex, sequence.length);
  const prev = mod(current - 1, sequence.length);
  const next = mod(current + 1, sequence.length);
  const visibleValues = [
    sequence[prev][columnKey],
    sequence[current][columnKey],
    sequence[next][columnKey]
  ];

  return (
    <div className={`register-column register-column-${columnKey}`}>
      <div className="register-window" aria-hidden="true">
        <div
          key={`${columnKey}-${stepIndex}`}
          className={`register-track${stepIndex > 0 ? " is-rolling" : ""}`}
        >
          {visibleValues.map((entry, visibleIndex) => (
            <div
              key={`${columnKey}-${visibleIndex}-${entry}-${stepIndex}`}
              className={`register-cell${visibleIndex === 1 ? " is-current" : ""}`}
            >
              {entry}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function LandingPage() {
  const navigate = useNavigate();
  const { token } = useAuth();
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setStepIndex((prev) => (prev + 1) % sequence.length);
    }, 2000);

    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="register-landing landing-structural-shell">
      <header className="landing-topbar">
        <button
          type="button"
          className="ghost landing-how-button-header"
          onClick={() => navigate("/how-it-works")}
        >
          Como Funciona?
        </button>

        <button
          type="button"
          className="logo-mark landing-logo-mark"
          onClick={() => navigate("/")}
          aria-label="Inicio"
        >
          <img src={logoLoader} alt="Light" className="header-logo-icon landing-logo-icon" />
        </button>

        <button
          type="button"
          className="account-icon"
          onClick={() => navigate(token ? "/account" : "/login")}
          aria-label="Cuenta"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <circle cx="12" cy="7.5" r="3.5" />
            <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
          </svg>
        </button>
      </header>

      <div className="landing-center-stack">
        <div className="landing-message" aria-label="Mensaje de proposito">
          <p>Detras de cada busqueda hay alguien.</p>
          <p>Esta plataforma existe para acercarlos.</p>
          <p>&nbsp;</p>
          <p>No manejamos inventario.</p>
          <p>Movemos informacion.</p>
          <p>&nbsp;</p>
          <p>Lo que publiques puede llegar a quien lo necesita.</p>
          <p>Lo que buscas puede estar mas cerca de lo que imaginas.</p>
        </div>
      </div>

      <div className="landing-bottom-reel">
        <div className="register-machine" role="presentation">
          {columns.map((columnKey) => (
            <ReelColumn key={columnKey} columnKey={columnKey} stepIndex={stepIndex} />
          ))}
        </div>
      </div>
    </div>
  );
}
