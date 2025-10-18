import React, { useState, useEffect } from "react";
import { io, Socket } from "socket.io-client";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { Line } from "react-chartjs-2";
import type {
  RateHistoryResponse,
  HourlyRateSnapshot,
} from "../../../domain/types";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

type ViewMode = "24h" | "7d";

interface HistoricalChartProps {
  token: "USDT" | "USDC";
}

const HistoricalChart: React.FC<HistoricalChartProps> = ({ token }) => {
  const [viewMode, setViewMode] = useState<ViewMode>("24h");
  const [historyData, setHistoryData] = useState<RateHistoryResponse | null>(
    null
  );
  const [hourlyData, setHourlyData] = useState<HourlyRateSnapshot[] | null>(
    null
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, [viewMode]);

  // WebSocket listeners for real-time historical data updates
  useEffect(() => {
    const newSocket = io("ws://localhost:3000", {
      transports: ["websocket"],
    });

    // Listen for hourly data updates (24h view)
    newSocket.on(
      "hourly_data_update",
      (update: { data: HourlyRateSnapshot[]; timestamp: number }) => {
        if (viewMode === "24h") {
          console.log("Received hourly data update", update.timestamp);
          setHourlyData(update.data);
        }
      }
    );

    // Listen for daily data updates (7d view)
    newSocket.on(
      "daily_data_update",
      (update: { data: RateHistoryResponse; timestamp: number }) => {
        if (viewMode === "7d") {
          console.log("Received daily data update", update.timestamp);
          setHistoryData(update.data);
        }
      }
    );

    return () => {
      newSocket.close();
    };
  }, [viewMode]);

  const fetchData = async () => {
    setLoading(true);
    try {
      if (viewMode === "7d") {
        await fetchHistoryData();
      } else {
        await fetchHourlyData();
      }
    } catch (error) {
      console.error("Failed to fetch data:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchHistoryData = async () => {
    try {
      const response = await fetch("/api/rates/history");
      const data = await response.json();

      if (data.success) {
        setHistoryData(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch history data:", error);
    }
  };

  const fetchHourlyData = async () => {
    try {
      // Get today's date in YYYY-MM-DD format
      const today = new Date().toISOString().split("T")[0];
      const response = await fetch(`/api/rates/hourly/${today}`);
      const data = await response.json();

      if (data.success) {
        setHourlyData(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch hourly data:", error);
    }
  };

  if (loading) {
    return (
      <div className="historical-chart loading">
        <div className="loading-spinner">
          Loading {viewMode === "24h" ? "hourly" : "historical"} data...
        </div>
      </div>
    );
  }

  // Prepare chart data based on view mode
  const getChartData = () => {
    if (viewMode === "7d") {
      if (!historyData || historyData.days.length === 0) {
        return null;
      }

      // 7-day view (daily data)
      const labels = historyData.days.map((day) => {
        const date = new Date(day.date);
        return date.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });
      });

      const datasets = [];

      // ByBit data
      const bybitData = historyData.days.map(
        (day) => day.rates[token]?.bybit || null
      );
      if (bybitData.some((value) => value !== null)) {
        datasets.push({
          label: "ByBit P2P",
          data: bybitData,
          borderColor: "rgb(59, 130, 246)",
          backgroundColor: "rgba(59, 130, 246, 0.1)",
          tension: 0.1,
          pointRadius: 4,
          pointHoverRadius: 6,
        });
      }

      // CNGN Base data
      const cngnBaseData = historyData.days.map(
        (day) => day.rates[token]?.cngn_base || null
      );
      if (cngnBaseData.some((value) => value !== null)) {
        datasets.push({
          label: "CNGN Base",
          data: cngnBaseData,
          borderColor: "rgb(34, 197, 94)",
          backgroundColor: "rgba(34, 197, 94, 0.1)",
          tension: 0.1,
          pointRadius: 4,
          pointHoverRadius: 6,
        });
      }

      // CNGN BEP20 data
      const cngnBep20Data = historyData.days.map(
        (day) => day.rates[token]?.cngn_bep20 || null
      );
      if (cngnBep20Data.some((value) => value !== null)) {
        datasets.push({
          label: "CNGN BEP20",
          data: cngnBep20Data,
          borderColor: "rgb(168, 85, 247)",
          backgroundColor: "rgba(168, 85, 247, 0.1)",
          tension: 0.1,
          pointRadius: 4,
          pointHoverRadius: 6,
        });
      }

      // Add spread data (in Naira, using secondary y-axis)
      // USDT uses BEP20, USDC uses Base
      const spreadData = historyData.days.map((day) => {
        const bybit = day.rates[token]?.bybit;
        const cngnRate =
          token === "USDT"
            ? day.rates[token]?.cngn_bep20 // USDT uses BEP20
            : day.rates[token]?.cngn_base; // USDC uses Base

        if (!bybit || !cngnRate) return null;

        // Calculate absolute spread in Naira
        return Math.abs(bybit - cngnRate);
      });

      const spreadLabel =
        token === "USDT"
          ? "ByBit vs CNGN BEP20 Spread"
          : "ByBit vs CNGN Base Spread";

      if (spreadData.some((value) => value !== null)) {
        datasets.push({
          label: spreadLabel,
          data: spreadData,
          borderColor: "rgba(255, 193, 7, 0.9)", // yellow/orange
          backgroundColor: "rgba(255, 193, 7, 0.1)",
          borderDash: [5, 5], // dashed line
          tension: 0.1,
          pointRadius: 3,
          pointHoverRadius: 5,
          yAxisID: "y1", // Use secondary y-axis
        });
      }

      return { labels, datasets };
    } else {
      // 24h view (hourly data)
      if (!hourlyData || hourlyData.length === 0) {
        return null;
      }

      const labels = hourlyData.map((snapshot) => {
        // Convert UTC timestamp to user's local timezone
        const localDate = new Date(snapshot.timestamp);
        const hour = localDate.getHours();
        return `${hour.toString().padStart(2, "0")}:00`;
      });

      const datasets = [];

      // ByBit data
      const bybitData = hourlyData.map(
        (snapshot) => snapshot.rates[token]?.bybit || null
      );
      if (bybitData.some((value) => value !== null)) {
        datasets.push({
          label: "ByBit P2P",
          data: bybitData,
          borderColor: "rgb(59, 130, 246)",
          backgroundColor: "rgba(59, 130, 246, 0.1)",
          tension: 0.1,
          pointRadius: 3,
          pointHoverRadius: 5,
        });
      }

      // CNGN Base data
      const cngnBaseData = hourlyData.map(
        (snapshot) => snapshot.rates[token]?.cngn_base || null
      );
      if (cngnBaseData.some((value) => value !== null)) {
        datasets.push({
          label: "CNGN Base",
          data: cngnBaseData,
          borderColor: "rgb(34, 197, 94)",
          backgroundColor: "rgba(34, 197, 94, 0.1)",
          tension: 0.1,
          pointRadius: 3,
          pointHoverRadius: 5,
        });
      }

      // CNGN BEP20 data
      const cngnBep20Data = hourlyData.map(
        (snapshot) => snapshot.rates[token]?.cngn_bep20 || null
      );
      if (cngnBep20Data.some((value) => value !== null)) {
        datasets.push({
          label: "CNGN BEP20",
          data: cngnBep20Data,
          borderColor: "rgb(168, 85, 247)",
          backgroundColor: "rgba(168, 85, 247, 0.1)",
          tension: 0.1,
          pointRadius: 3,
          pointHoverRadius: 5,
        });
      }

      // Add spread data (in Naira, using secondary y-axis)
      // USDT uses BEP20, USDC uses Base
      const spreadData = hourlyData.map((snapshot) => {
        const bybit = snapshot.rates[token]?.bybit;
        const cngnRate =
          token === "USDT"
            ? snapshot.rates[token]?.cngn_bep20 // USDT uses BEP20
            : snapshot.rates[token]?.cngn_base; // USDC uses Base

        if (!bybit || !cngnRate) return null;

        // Calculate absolute spread in Naira
        return Math.abs(bybit - cngnRate);
      });

      const spreadLabel =
        token === "USDT"
          ? "ByBit vs CNGN BEP20 Spread"
          : "ByBit vs CNGN Base Spread";

      if (spreadData.some((value) => value !== null)) {
        datasets.push({
          label: spreadLabel,
          data: spreadData,
          borderColor: "rgba(255, 193, 7, 0.9)", // yellow/orange
          backgroundColor: "rgba(255, 193, 7, 0.1)",
          borderDash: [5, 5], // dashed line
          tension: 0.1,
          pointRadius: 2,
          pointHoverRadius: 4,
          yAxisID: "y1", // Use secondary y-axis
        });
      }

      return { labels, datasets };
    }
  };

  const chartData = getChartData();

  if (!chartData || chartData.datasets.length === 0) {
    return (
      <div className="historical-chart no-data">
        <div className="chart-header">
          <div className="view-toggle">
            <button
              className={`toggle-btn ${viewMode === "24h" ? "active" : ""}`}
              onClick={() => setViewMode("24h")}
            >
              24H
            </button>
            <button
              className={`toggle-btn ${viewMode === "7d" ? "active" : ""}`}
              onClick={() => setViewMode("7d")}
            >
              7D
            </button>
          </div>
        </div>
        <p>No {viewMode === "24h" ? "hourly" : "historical"} data available</p>
      </div>
    );
  }

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "top" as const,
        labels: {
          color: "#cccccc",
          font: {
            size: 12,
          },
        },
      },
      title: {
        display: true,
        text: `${token}/NGN - ${viewMode === "24h" ? "Last 24 Hours" : "Last 7 Days"}`,
        color: "#00ff88",
        font: {
          size: 16,
          weight: "bold" as const,
        },
      },
      tooltip: {
        mode: "index" as const,
        intersect: false,
        backgroundColor: "rgba(15, 15, 35, 0.95)",
        titleColor: "#00ff88",
        bodyColor: "#cccccc",
        borderColor: "#333366",
        borderWidth: 1,
        callbacks: {
          title: function (context: any) {
            if (viewMode === "24h" && hourlyData) {
              // For hourly data, show the full local time
              const dataIndex = context[0].dataIndex;
              const snapshot = hourlyData[dataIndex];
              if (snapshot) {
                const localDate = new Date(snapshot.timestamp);
                return localDate.toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZoneName: "short",
                });
              }
            }
            // For daily data, use the default label
            return context[0].label;
          },
          label: function (context: any) {
            const value = context.parsed.y;
            if (value === null) return "";

            // All data now shows in Naira format
            return `${context.dataset.label}: ₦${value.toLocaleString("en-NG", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}`;
          },
        },
      },
    },
    interaction: {
      mode: "nearest" as const,
      axis: "x" as const,
      intersect: false,
    },
    scales: {
      x: {
        display: true,
        title: {
          display: true,
          text: viewMode === "24h" ? "Hour" : "Date",
          color: "#999999",
        },
        grid: {
          color: "rgba(51, 51, 102, 0.3)",
        },
        ticks: {
          color: "#cccccc",
        },
      },
      y: {
        type: "linear" as const,
        display: true,
        position: "left" as const,
        title: {
          display: true,
          text: "Rate (NGN)",
          color: "#999999",
        },
        grid: {
          color: "rgba(51, 51, 102, 0.3)",
        },
        ticks: {
          color: "#cccccc",
          callback: function (value: any) {
            return "₦" + value.toLocaleString("en-NG");
          },
        },
      },
      y1: {
        type: "linear" as const,
        display: true,
        position: "right" as const,
        title: {
          display: true,
          text: "Spread (₦)",
          color: "#ffc107",
        },
        grid: {
          drawOnChartArea: false, // Only show grid for primary y-axis
        },
        ticks: {
          color: "#ffc107",
          callback: function (value: any) {
            return "₦" + value.toLocaleString("en-NG");
          },
        },
      },
    },
    elements: {
      point: {
        hoverBackgroundColor: "#00ff88",
        hoverBorderColor: "#ffffff",
        hoverBorderWidth: 2,
      },
    },
  };

  return (
    <div className="historical-chart">
      <div className="chart-header">
        <div className="view-toggle">
          <button
            className={`toggle-btn ${viewMode === "24h" ? "active" : ""}`}
            onClick={() => setViewMode("24h")}
          >
            24H
          </button>
          <button
            className={`toggle-btn ${viewMode === "7d" ? "active" : ""}`}
            onClick={() => setViewMode("7d")}
          >
            7D
          </button>
        </div>
      </div>

      <div className="chart-container">
        <Line data={chartData} options={options} />
      </div>

      <div className="chart-stats">
        <div className="stat-grid">
          {chartData.datasets.map((dataset, index) => {
            const values = dataset.data.filter((v) => v !== null) as number[];
            if (values.length === 0) return null;

            const latest = values[values.length - 1]!;
            const oldest = values[0]!;
            const change = latest - oldest;
            const changePercent = (change / oldest) * 100;

            return (
              <div key={index} className="stat-item">
                <div
                  className="stat-label"
                  style={{ color: dataset.borderColor }}
                >
                  {dataset.label}
                </div>
                <div className="stat-values">
                  <span className="current-value">
                    ₦
                    {latest?.toLocaleString("en-NG", {
                      maximumFractionDigits: 2,
                    })}
                  </span>
                  <span
                    className={`change-value ${change >= 0 ? "positive" : "negative"}`}
                  >
                    {change >= 0 ? "+" : ""}₦{change.toFixed(2)} (
                    {changePercent.toFixed(1)}%)
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default HistoricalChart;
