import { createConnectRouter, type Interceptor } from "@connectrpc/connect";
import { createFetchHandler } from "@connectrpc/connect/protocol";
import { TaskService } from "@contagxt/axa-proto";
import { toConnectError } from "./errors";
import { taskServiceImpl } from "./task.service";

const errorInterceptor: Interceptor = (next) => async (request) => {
  try {
    return await next(request);
  } catch (error) {
    throw toConnectError(error);
  }
};

const router = createConnectRouter({ interceptors: [errorInterceptor] });
router.service(TaskService, taskServiceImpl);

const routes = new Map(
  router.handlers.map((handler) => [handler.requestPath, createFetchHandler(handler)]),
);

export async function handleConnectRequest(request: Request): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  for (const [requestPath, handler] of routes) {
    if (pathname === requestPath || pathname.endsWith(requestPath)) {
      return handler(request);
    }
  }
  return new Response("Connect RPC route not found.", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
