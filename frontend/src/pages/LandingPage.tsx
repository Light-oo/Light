import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Card } from "../components/Card";

export function LandingPage() {
  const { token } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="screen auth-screen">
      <Card className="stack landing-card">
        <h1 className="landing-title">LIGHT</h1>
        <p>
          Search for parts in BUY mode, publish available parts in SELL mode, and reveal contact through WhatsApp.
        </p>
        <button type="button" onClick={() => navigate("/search")}>
          Go to Search
        </button>
        <button type="button" className="ghost" onClick={() => navigate(token ? "/account" : "/login")}>
          My Account
        </button>
      </Card>
    </div>
  );
}
