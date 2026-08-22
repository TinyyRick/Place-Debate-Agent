import { NextResponse } from "next/server";
import { z } from "zod";
import { resumeDebate } from "@/lib/graph/debate-graph";

export const runtime = "nodejs";

const RequestSchema = z.object({
  threadId: z.string().uuid(),
  action: z.unknown(),
});

export async function POST(request: Request) {
  try {
    const { threadId, action } = RequestSchema.parse(await request.json());
    return NextResponse.json(await resumeDebate(threadId, action));
  } catch (error) {
    const message = error instanceof Error ? error.message : "The debate could not be resumed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
