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

  useEffect(() => {
    // Connect to WebSocket
    const newSocket = io("ws://localhost:3000", {
      transports: ["websocket"],
    });

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
  }, []);

  const fetchInitialData = async () => {
    try {
      const [ratesRes, spreadsRes] = await Promise.all([
        fetch("/api/rates"),
        fetch("/api/rates/spreads"),
      ]);

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
                  spread={state.spreads.find((s) => s.token === "USDT")!}
                />
                <RateCard
                  token="USDC"
                  rates={state.rates.USDC}
                  spread={state.spreads.find((s) => s.token === "USDC")!}
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
