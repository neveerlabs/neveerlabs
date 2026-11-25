import { defineConfig } from "vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

declare const process: {
  env: Record<string, string | undefined>;
};

function deploymentMetadataPlugin(): Plugin {
  const origin = (
    process.env.SITE_URL ||
    process.env.URL ||
    process.env.DEPLOY_PRIME_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
    process.env.CF_PAGES_URL ||
    ""
  ).replace(/\/+$/, "");

  return {
    name: "deployment-metadata-origin",
    apply: "build",
    transformIndexHtml(html) {
      if (!origin) return html;

      const rootUrl = `${origin}/`;
      const imageUrl = `${origin}/images/og-preview.png`;

      return html
        .replace(
          /(<link rel="canonical" href=")\/(")/,
          (_match, prefix: string, suffix: string) => `${prefix}${rootUrl}${suffix}`,
        )
        .replace(
          /(<meta property="og:url" content=")\/(")/,
          (_match, prefix: string, suffix: string) => `${prefix}${rootUrl}${suffix}`,
        )
        .replace(
          /(content=")\/images\/og-preview\.png(")/g,
          (_match, prefix: string, suffix: string) =>
            `${prefix}${imageUrl}${suffix}`,
        );
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), deploymentMetadataPlugin()],
});
