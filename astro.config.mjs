// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import preact from '@astrojs/preact';

export default defineConfig({
  output: 'server',
  // Local `astro dev` gets real D1/R2/Vectorize bindings from wrangler.jsonc
  // through the Cloudflare Vite plugin the adapter installs.
  adapter: cloudflare({ imageService: 'compile' }),
  integrations: [preact()],
  devToolbar: { enabled: false },
});
