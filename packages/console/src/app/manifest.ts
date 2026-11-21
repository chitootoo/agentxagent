import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "axa · Agent × Agent",
    short_name: "axa",
    description: "Local-first task control for humans and AI agents.",
    start_url: "/",
    display: "standalone",
    background_color: "#f3efe6",
    theme_color: "#131f18",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
