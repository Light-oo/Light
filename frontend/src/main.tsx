import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { App } from "./App";
import { LoadingProvider } from "./context/LoadingContext";
import { MarketProvider } from "./context/MarketContext";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LoadingProvider>
      <BrowserRouter>
        <AuthProvider>
          <MarketProvider>
            <App />
          </MarketProvider>
        </AuthProvider>
      </BrowserRouter>
    </LoadingProvider>
  </React.StrictMode>
);
