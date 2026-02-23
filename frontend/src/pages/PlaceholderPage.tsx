import { useNavigate } from "react-router-dom";

type PlaceholderPageProps = {
  message?: string;
};

export function PlaceholderPage({ message = "This section is planned but not implemented yet." }: PlaceholderPageProps) {
  const navigate = useNavigate();

  return (
    <div className="screen auth-screen">
      <div className="stack auth-form">
        <p>{message}</p>
        <button type="button" onClick={() => navigate("/")}>
          Back to Home
        </button>
      </div>
    </div>
  );
}
