import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => {
  const isLocalhost = mode === 'development';
    return {
      base: isLocalhost ? '/' : '/solar-simulator/'
    }
});
