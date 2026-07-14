import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: {
    __BASE_PATH__: JSON.stringify(process.env.BASE_PATH || "/"),
  },
});
