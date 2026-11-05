import React, { useState, useEffect } from "react";
import { io, Socket } from "socket.io-client";
import type {
  CurrentRatesData,
  SpreadData,
  VolatilityAlert,
} from "../../domain/types";
import RateCard from "./components/RateCard";
import SpreadChart from "./components/SpreadChart";
import AlertPanel from "./components/AlertPanel";
import ConnectionStatus from "./components/ConnectionStatus";
import HistoricalChart from "./components/HistoricalChart";
import {
  getStoredOperatorAuth,
  operatorFetch,
  operatorSocketOptions,
  storeOperatorAuth,
} from "./operatorClient";
import "./App.css";

interface DashboardState {
  connected: boolean;
  lastUpdate: number;
  rates: CurrentRatesData | null;
  spreads: SpreadData[];
  alerts: VolatilityAlert[];
}

function App() {
  const [state, setState] = useState<DashboardState>({
    connected: false,
    lastUpdate: 0,
    rates: null,
    spreads: [],
    alerts: [],
  });

  const [socket, setSocket] = useState<Socket | null>(null);
  const [needsLogin, setNeedsLogin] = useState<boolean | null>(
    getStoredOperatorAuth() ? false : null
  );
  const [loginUser, setLoginUser] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");

  useEffect(() => {
    if (needsLogin !== null) {
      return;
    }
    operatorFetch("/api/rates")
      .then((response) => {
        setNeedsLogin(response.status === 401);
      })
      .catch(() => {
        setNeedsLogin(true);
      });
  }, [needsLogin]);

  useEffect(() => {
    if (needsLogin !== false) {
      return;
    }

    const newSocket = io("ws://localhost:3000", operatorSocketOptions());

    newSocket.on("connect", () => {
      setState((prev) => ({ ...prev, connected: true }));
      console.log("Connected to rates monitor");
    });

    newSocket.on("disconnect", () => {
      setState((prev) => ({ ...prev, connected: false }));
    });

    newSocket.on(
      "rates_update",
      (data: { rates: CurrentRatesData; spreads: SpreadData[] }) => {
        setState((prev) => ({
          ...prev,
          rates: data.rates,
          spreads: data.spreads,
          lastUpdate: Date.now(),
        }));
      }
    );

    newSocket.on("volatility_alert", (alert: VolatilityAlert) => {
      setState((prev) => ({
        ...prev,
        alerts: [alert, ...prev.alerts.slice(0, 9)], // Keep last 10 alerts
      }));
    });

    setSocket(newSocket);

    // Initial data fetch
    fetchInitialData();

    return () => {
      newSocket.close();
    };
  }, [needsLogin]);

  const fetchInitialData = async () => {
    try {
      const [ratesRes, spreadsRes] = await Promise.all([
        operatorFetch("/api/rates"),
        operatorFetch("/api/rates/spreads"),
      ]);

      if (ratesRes.status === 401 || spreadsRes.status === 401) {
        setNeedsLogin(true);
        return;
      }

      const ratesData = await ratesRes.json();
      const spreadsData = await spreadsRes.json();

      if (ratesData.success && spreadsData.success) {
        setState((prev) => ({
          ...prev,
          rates: ratesData.data,
          spreads: spreadsData.data,
          lastUpdate: Date.now(),
        }));
      }
    } catch (error) {
      console.error("Failed to fetch initial data:", error);
    }
  };

  const submitLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!loginUser.trim() || !loginPassword) {
      setLoginError("Username and password are required");
      return;
    }

    storeOperatorAuth(loginUser.trim(), loginPassword);
    const probe = await operatorFetch("/api/rates");
    if (probe.status === 401) {
      setLoginError("Invalid operator credentials");
      return;
    }

    setLoginError("");
    setNeedsLogin(false);
  };

  if (needsLogin === null) {
    return (
      <div className="app">
        <main className="operator-login">
          <p>Checking operator access...</p>
        </main>
      </div>
    );
  }

  if (needsLogin) {
    return (
      <div className="app">
        <main className="operator-login">
          <form className="operator-login-card" onSubmit={submitLogin}>
            <h1>Operator sign-in</h1>
            <p>Rates monitor requires operator credentials.</p>
            <label>
              Username
              <input
                autoComplete="username"
                value={loginUser}
                onChange={(event) => setLoginUser(event.target.value)}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
              />
            </label>
            {loginError ? <p className="login-error">{loginError}</p> : null}
            <button type="submit">Continue</button>
          </form>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <h1>💹 Rates Monitor Dashboard</h1>
        <ConnectionStatus
          connected={state.connected}
          lastUpdate={state.lastUpdate}
        />
      </header>

      <main className="dashboard">
        <section className="historical-section">
          <div className="historical-charts">
            <HistoricalChart token="USDT" />
            <HistoricalChart token="USDC" />
          </div>
        </section>

        <section className="rates-section">
          <div className="rates-grid">
            {state.rates && (
              <>
                <RateCard
                  token="USDT"
                  rates={state.rates.USDT}
                  spreads={state.spreads.filter((s) => s.token === "USDT")}
                />
                <RateCard
                  token="USDC"
                  rates={state.rates.USDC}
                  spreads={state.spreads.filter((s) => s.token === "USDC")}
                />
              </>
            )}
          </div>
        </section>

        <section className="charts-section">
          <SpreadChart spreads={state.spreads} />
        </section>

        <section className="alerts-section">
          <AlertPanel alerts={state.alerts} />
        </section>
      </main>
    </div>
  );
}

export default App;
