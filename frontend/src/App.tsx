import { Route, Routes } from "react-router-dom";
import { RequireAuth } from "./auth/RequireAuth";
import { AppLayout } from "./components/AppLayout";
import { GlobalLoader } from "./components/GlobalLoader";
import { useLoading } from "./context/LoadingContext";
import { AccountPage } from "./pages/AccountPage";
import { BuySearchPage } from "./pages/BuySearchPage";
import { LandingPage } from "./pages/LandingPage";
import { LoginPage } from "./pages/LoginPage";
import { MyListingsPage } from "./pages/MyListingsPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { PublishPage } from "./pages/PublishPage";
import { SellDemandsPage } from "./pages/SellDemandsPage";
import { SignupPage } from "./pages/SignupPage";

export function App() {
  const { isLoading } = useLoading();

  return (
    <>
      <GlobalLoader visible={isLoading} />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route
          path="/how-it-works"
          element={<PlaceholderPage message="Esta sección está planificada pero aún no está lista." />}
        />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />

        <Route element={<RequireAuth />}>
          <Route element={<AppLayout />}>
            <Route path="/search" element={<BuySearchPage />} />
            <Route path="/publish" element={<PublishPage />} />
            <Route path="/sell-demands" element={<SellDemandsPage />} />
            <Route path="/my-listings" element={<MyListingsPage />} />
            <Route path="/account" element={<AccountPage />} />
          </Route>
        </Route>

        <Route path="*" element={<PlaceholderPage />} />
      </Routes>
    </>
  );
}
