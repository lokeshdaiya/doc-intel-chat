import { connection } from "next/server";
import { defaultProviderId, listProviders } from "@/lib/ai/providers";

export async function GET() {
  // Provider availability depends on runtime env vars, so never prerender this.
  await connection();
  return Response.json({ defaultProvider: defaultProviderId() ?? null, providers: listProviders() });
}
