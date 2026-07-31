import { NextResponse } from "next/server";
import { getWildfireAdapter } from "@/lib/wildfire";

export async function GET() {
  const events = await getWildfireAdapter().listEvents();

  return NextResponse.json(events, {
    headers: {
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
