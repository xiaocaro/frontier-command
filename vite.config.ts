import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// Port 5373 sits outside the Windows reserved TCP ranges (3571-4972, 5041-5340, 7733-7832);
// Vite's default 5173 is inside a reserved range and fails to bind with EACCES.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5373 },
});
