import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { App } from "./App";
import { LoadingProvider } from "./context/LoadingContext";
import { MarketProvider } from "./context/MarketContext";
import { OptionsProvider } from "./context/OptionsContext";
import { ProfileStatusProvider } from "./context/ProfileStatusContext";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LoadingProvider>
      <BrowserRouter>
        <AuthProvider>
          <ProfileStatusProvider>
            <OptionsProvider>
              <MarketProvider>
                <App />
              </MarketProvider>
            </OptionsProvider>
          </ProfileStatusProvider>
        </AuthProvider>
      </BrowserRouter>
    </LoadingProvider>
  </React.StrictMode>
);
