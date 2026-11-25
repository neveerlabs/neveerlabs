import { defineConfig } from "vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

declare const process: {
  env: Record<string, string | undefined>;
};

function deploymentMetadataPlugin(): Plugin {
  const vercelProductionOrigin = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "";
  const vercelDeploymentOrigin = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "";
  const origin = (
    process.env.SITE_URL ||
    process.env.URL ||
    process.env.DEPLOY_PRIME_URL ||
    (process.env.VERCEL_ENV === "production" ? vercelProductionOrigin : "") ||
    vercelDeploymentOrigin ||
    process.env.CF_PAGES_URL ||
    ""
  ).replace(/\/+$/, "");
  const imageOrigin = (
    process.env.SITE_URL ||
    process.env.URL ||
    process.env.DEPLOY_PRIME_URL ||
    vercelProductionOrigin ||
    origin ||
    process.env.CF_PAGES_URL ||
    ""
  ).replace(/\/+$/, "");

  return {
    name: "deployment-metadata-origin",
    apply: "build",
    transformIndexHtml(html) {
      if (!origin) return html;

      const rootUrl = `${origin}/`;
      const imageUrl = `${imageOrigin}/images/og-preview.png`;

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
