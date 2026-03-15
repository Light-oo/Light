import { useNavigate } from "react-router-dom";

type PlaceholderPageProps = {
  message?: string;
};

export function PlaceholderPage({ message = "Esta sección está planificada pero aún no está implementada." }: PlaceholderPageProps) {
  const navigate = useNavigate();

  return (
    <div className="screen auth-screen">
      <div className="stack auth-form">
        <p>{message}</p>
        <button type="button" onClick={() => navigate("/")}>
          Volver al inicio
        </button>
      </div>
    </div>
  );
}
