import { Navigate, Route, Routes } from "react-router-dom";
import { RequireAuth } from "./auth/RequireAuth";
import { AppLayout } from "./components/AppLayout";
import { AccountPage } from "./pages/AccountPage";
import { BuySearchPage } from "./pages/BuySearchPage";
import { LoginPage } from "./pages/LoginPage";
import { MyListingsPage } from "./pages/MyListingsPage";
import { PublishPage } from "./pages/PublishPage";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route path="/search" element={<BuySearchPage />} />
          <Route path="/publish" element={<PublishPage />} />
          <Route path="/my-listings" element={<MyListingsPage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/" element={<Navigate to="/search" replace />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/search" replace />} />
    </Routes>
  );
}
