import { resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { defineConfig, loadEnv } from "vite";

function hostedManifestPlugin(extensionBaseUrl) {
  if (!extensionBaseUrl) return null;

  const baseValue = extensionBaseUrl.endsWith("/") ? extensionBaseUrl : `${extensionBaseUrl}/`;
  const extensionBase = new URL(baseValue);
  if (extensionBase.protocol !== "https:") {
    throw new Error("EXTENSION_BASE_URL deve usar HTTPS para uma publicação pública.");
  }

  return {
    name: "aa-hosted-extension-manifest",
    apply: "build",
    async closeBundle() {
      const manifestPath = resolve(process.cwd(), "dist/manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      manifest.background_url = new URL("background.html", extensionBase).href;
      manifest.action = manifest.action ?? {};
      manifest.action.icon = new URL("icon.svg", extensionBase).href;
      manifest.action.popover = extensionBase.href;
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    // Relative assets allow the compiled site to live below a repository path.
    base: "./",
    plugins: [hostedManifestPlugin(env.EXTENSION_BASE_URL)].filter(Boolean),
    server: {
      host: "0.0.0.0",
      cors: {
        origin: ["https://www.owlbear.rodeo", "https://owlbear.rodeo"],
      },
    },
    build: {
      rollupOptions: {
        input: {
          main: resolve(process.cwd(), "index.html"),
          sheet: resolve(process.cwd(), "sheet.html"),
          background: resolve(process.cwd(), "background.html"),
          rollResult: resolve(process.cwd(), "roll-result.html"),
        },
      },
    },
  };
});
