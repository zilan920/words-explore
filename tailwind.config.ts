import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#151528",
        mist: "#f7f8fc",
        leaf: "#16866d",
        coral: "#cf5d4c",
        steel: "#596274",
        amber: "#b7791f",
        iris: "#4f46e5",
        lilac: "#eef2ff",
        paper: "#fffdf8",
        line: "#e2e7f0"
      },
      boxShadow: {
        soft: "0 14px 38px rgba(21, 21, 40, 0.10)",
        press: "inset 0 -2px 0 rgba(21, 21, 40, 0.10), 0 10px 22px rgba(21, 21, 40, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
