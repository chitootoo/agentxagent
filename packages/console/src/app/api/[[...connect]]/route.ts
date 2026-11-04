import { handleConnectRequest } from "@/server/connect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  return handleConnectRequest(request);
}

export function POST(request: Request): Promise<Response> {
  return handleConnectRequest(request);
}
