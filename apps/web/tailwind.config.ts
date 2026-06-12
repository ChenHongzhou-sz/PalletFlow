import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#18212b",
        mist: "#eef2f5",
        sand: "#f4ede1",
        ember: "#f2a33b",
        pine: "#1e5f54",
        danger: "#b94a48",
      },
      boxShadow: {
        card: "0 16px 40px rgba(24, 33, 43, 0.14)",
      },
      borderRadius: {
        "4xl": "2rem",
      },
      fontFamily: {
        display: ["'Space Grotesk'", "'Segoe UI Variable'", "'Noto Sans SC'", "sans-serif"],
        body: ["'Segoe UI Variable'", "'Noto Sans SC'", "'PingFang SC'", "sans-serif"],
      },
      backgroundImage: {
        "warehouse-grid":
          "linear-gradient(rgba(24, 33, 43, 0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(24, 33, 43, 0.06) 1px, transparent 1px)",
      },
    },
  },
  plugins: [],
} satisfies Config;
