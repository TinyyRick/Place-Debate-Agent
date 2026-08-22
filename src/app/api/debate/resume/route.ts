import { NextResponse } from "next/server";
import { z } from "zod";
import { resumeDebate } from "@/lib/graph/debate-graph";

export const runtime = "nodejs";

const RequestSchema = z.object({
  threadId: z.string().uuid(),
  intervention: z.string().max(1000).default(""),
});

export async function POST(request: Request) {
  try {
    const { threadId, intervention } = RequestSchema.parse(await request.json());
    return NextResponse.json({ status: "completed", debate: await resumeDebate(threadId, intervention) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The debate could not be resumed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
