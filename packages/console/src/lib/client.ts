"use client";

import { TaskService } from "@axa/proto";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";

const transport = createConnectTransport({ baseUrl: "/api" });

export const taskClient = createClient(TaskService, transport);
