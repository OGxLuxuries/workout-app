import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        assetFileNames: (asset) =>
          asset.names.includes("eng.traineddata.gz")
            ? "assets/ocr/[hash]/eng.traineddata.gz"
            : "assets/[name]-[hash][extname]",
      },
    },
  },
  server: { proxy: { "/api": "http://127.0.0.1:8787" } },
});
