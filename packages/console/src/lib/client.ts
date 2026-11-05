"use client";

import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { TaskService } from "@contagxt/axa-proto";

const transport = createConnectTransport({ baseUrl: "/api" });

export const taskClient = createClient(TaskService, transport);
