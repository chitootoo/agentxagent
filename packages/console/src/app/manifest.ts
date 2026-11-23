import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "axa · Boss × Secretary × Worker",
    short_name: "axa",
    description: "Boss 与秘书对话，秘书调度 worker 执行任务的本地协作中枢。",
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
