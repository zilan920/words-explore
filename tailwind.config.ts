import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#17202a",
        mist: "#f5f7f8",
        leaf: "#1f8a70",
        coral: "#d95f45",
        steel: "#476072",
        amber: "#d99a27"
      },
      boxShadow: {
        soft: "0 10px 35px rgba(23, 32, 42, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
