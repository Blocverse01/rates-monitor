import React from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import type { SpreadData } from "../../../domain/types";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
);

interface SpreadChartProps {
  spreads: SpreadData[];
}

const SpreadChart: React.FC<SpreadChartProps> = ({ spreads }) => {
  // Show only blended tier spreads to keep the chart readable
  const blendedSpreads = spreads.filter((s) => s.tier === "blended");

  const data = {
    labels: blendedSpreads.map((s) => `${s.token} / CNGN ${s.chain.toUpperCase()}`),
    datasets: [
      {
        label: "Blended Spread %",
        data: blendedSpreads.map((s) => s.percentageSpread),
        backgroundColor: blendedSpreads.map((s) => {
          const absSpread = Math.abs(s.percentageSpread);
          if (absSpread > 3) return "rgba(239, 68, 68, 0.7)"; // red
          if (absSpread > 1) return "rgba(245, 158, 11, 0.7)"; // yellow
          return "rgba(34, 197, 94, 0.7)"; // green
        }),
        borderColor: blendedSpreads.map((s) => {
          const absSpread = Math.abs(s.percentageSpread);
          if (absSpread > 3) return "rgb(239, 68, 68)"; // red
          if (absSpread > 1) return "rgb(245, 158, 11)"; // yellow
          return "rgb(34, 197, 94)"; // green
        }),
        borderWidth: 1,
      },
    ],
  };

  const options = {
    responsive: true,
    plugins: {
      legend: {
        position: "top" as const,
      },
      title: {
        display: true,
        text: "Current Spreads",
      },
      tooltip: {
        callbacks: {
          label: function (context: any) {
            const spread = blendedSpreads[context.dataIndex];
            return [
              `Spread: ${spread?.percentageSpread?.toFixed(2)}%`,
              `Direction: ${spread?.direction.replace("_", " ")}`,
              `ByBit: ₦${spread?.bybitRate.toFixed(2)}`,
              `CNGN: ₦${spread?.cngnRate.toFixed(2)}`,
            ];
          },
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        title: {
          display: true,
          text: "Spread (%)",
        },
      },
    },
  };

  return (
    <div className="spread-chart">
      <Bar data={data} options={options} />
    </div>
  );
};

export default SpreadChart;
