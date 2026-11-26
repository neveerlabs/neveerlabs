import { defineConfig, loadEnv } from "vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { handleAdminRequest } from "./api/admin-handler";
import { handleProjectsRequest } from "./api/projects";

declare const process: {
  env: Record<string, string | undefined>;
  cwd(): string;
};

function deploymentMetadataPlugin(env: Record<string, string | undefined>): Plugin {
  const vercelProductionOrigin = env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "";
  const vercelDeploymentOrigin = env.VERCEL_URL
    ? `https://${env.VERCEL_URL}`
    : "";
  const origin = (
    env.SITE_URL ||
    env.URL ||
    env.DEPLOY_PRIME_URL ||
    (env.VERCEL_ENV === "production" ? vercelProductionOrigin : "") ||
    vercelDeploymentOrigin ||
    env.CF_PAGES_URL ||
    ""
  ).replace(/\/+$/, "");
  const imageOrigin = (
    env.SITE_URL ||
    env.URL ||
    env.DEPLOY_PRIME_URL ||
    vercelProductionOrigin ||
    origin ||
    env.CF_PAGES_URL ||
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

function localProjectsApiPlugin(env: Record<string, string | undefined>): Plugin {
  return {
    name: "local-projects-api",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const requestUrl = new URL(
          request.url ?? "/",
          `http://${request.headers.host ?? "localhost"}`,
        );
        if (requestUrl.pathname !== "/api/projects") {
          next();
          return;
        }

        void handleProjectsRequest(
          {
            method: request.method,
            url: request.url,
            headers: { host: request.headers.host },
          },
          {
            status(code) {
              response.statusCode = code;
              return this;
            },
            setHeader(name, value) {
              response.setHeader(name, value);
              return this;
            },
            json(body) {
              response.end(JSON.stringify(body));
              return this;
            },
          },
          env,
        ).catch((error: unknown) => {
          server.config.logger.error(
            error instanceof Error ? error.message : String(error),
          );
          if (!response.headersSent) {
            response.statusCode = 500;
            response.setHeader("Content-Type", "application/json; charset=utf-8");
          }
          response.end(JSON.stringify({ error: "Projects are temporarily unavailable." }));
        });
      });
    },
  };
}

function localAdminApiPlugin(env: Record<string, string | undefined>): Plugin {
  return {
    name: "local-admin-api",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const requestUrl = new URL(
          request.url ?? "/",
          `http://${request.headers.host ?? "localhost"}`,
        );
        if (
          requestUrl.pathname !== "/api/admin" &&
          !requestUrl.pathname.startsWith("/api/admin/")
        ) {
          next();
          return;
        }

        void handleAdminRequest(
          {
            method: request.method,
            url: request.url,
            headers: request.headers,
            body: undefined,
            [Symbol.asyncIterator]: request[Symbol.asyncIterator].bind(request),
          },
          {
            status(code) {
              response.statusCode = code;
              return this;
            },
            setHeader(name, value) {
              response.setHeader(name, value);
              return this;
            },
            json(body) {
              response.end(JSON.stringify(body));
              return this;
            },
          },
          env,
        ).catch((error: unknown) => {
          server.config.logger.error(
            error instanceof Error ? error.message : String(error),
          );
          if (!response.headersSent) {
            response.statusCode = 500;
            response.setHeader("Content-Type", "application/json; charset=utf-8");
          }
          response.end(JSON.stringify({ error: "Admin request failed." }));
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = {
    ...loadEnv(mode, process.cwd(), ""),
    ...process.env,
  };

  return {
    plugins: [
      react(),
      tailwindcss(),
      deploymentMetadataPlugin(env),
      localProjectsApiPlugin(env),
      localAdminApiPlugin(env),
    ],
  };
});
