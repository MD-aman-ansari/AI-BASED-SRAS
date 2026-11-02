import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/@firebase/firestore/")) return "firebase-firestore";
          if (id.includes("/node_modules/@firebase/auth/")) return "firebase-auth";
          if (id.includes("/node_modules/@firebase/functions/")) return "firebase-functions";
          if (id.includes("/node_modules/@firebase/app/")) return "firebase-app";
          if (id.includes("/node_modules/@firebase/")) return "firebase-shared";
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return "react-vendor";
          return undefined;
        },
      },
    },
  },
});
