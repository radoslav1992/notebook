// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'server',
  // The app renders no astro:assets images, so skip the Cloudflare Images
  // binding entirely rather than requiring one to be provisioned.
  adapter: cloudflare({ imageService: 'passthrough' }),
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
    // Dev runs SSR inside workerd, which pre-bundles dependencies separately
    // from the client graph. Without deduping, React and React DOM can resolve
    // to two different copies and every hook call throws.
    resolve: { dedupe: ['react', 'react-dom'] },
    // The Cloudflare adapter rebuilds the server environment's optimizeDeps from
    // this top-level list, so React has to be declared here (not under
    // `environments.ssr`) for it to be pre-bundled alongside react-dom/server.
    optimizeDeps: {
      include: [
        'react',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'react-dom',
        'react-dom/server',
        // These two are discovered late otherwise, and the resulting mid-request
        // re-optimization reloads the dev worker with two copies of React.
        'astro/assets/services/noop',
        'astro/logger/json',
      ],
    },
  },
});
