import { NextResponse } from "next/server";

export const runtime = "edge";

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "Data is baked at build time. Live sensor and wind data updates are not available on this deployment.",
  });
}

export async function POST() {
  return NextResponse.json({
    ok: true,
    message: "Data is baked at build time. Live sensor and wind data updates are not available on this deployment.",
  });
}
