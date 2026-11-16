import { NextResponse } from "next/server";
import { createSession } from "@/lib/store";

export async function POST() {
  const s = createSession();
  return NextResponse.json({ sessionId: s.id });
}
