import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Builds a single script + stylesheet into ../viewer/ so the app works offline.
export default defineConfig({
  plugins: [react()],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: "../viewer/editor",
    emptyOutDir: true,
    minify: true,
    cssCodeSplit: false,
    lib: { entry: "src/main.jsx", formats: ["iife"], name: "NotionEditorBundle", fileName: () => "editor.js", cssFileName: "editor" },
  },
});
