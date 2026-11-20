// @ts-check
import { defineConfig, fontProviders } from "astro/config";

export default defineConfig({
  site: "https://codebykarthick.github.io",
  trailingSlash: "ignore",
  fonts: [
    {
      provider: fontProviders.google(),
      name: "Oxanium",
      cssVariable: "--font-display",
      weights: [500, 600, 800],
      styles: ["normal"],
      fallbacks: ["Arial Narrow", "sans-serif"],
    },
    {
      provider: fontProviders.google(),
      name: "Barlow",
      cssVariable: "--font-body",
      weights: [400, 500],
      styles: ["normal"],
      fallbacks: ["Helvetica Neue", "Arial", "sans-serif"],
    },
  ],
});
