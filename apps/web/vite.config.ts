import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // En desarrollo, /api se redirige a la API local (en AWS lo hace CloudFront → ALB).
    proxy: { '/api': 'http://localhost:3000' },
  },
});
