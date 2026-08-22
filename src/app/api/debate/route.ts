import { NextResponse } from "next/server";
import { z } from "zod";
import { runDebate } from "@/lib/graph/debate-graph";

export const runtime = "nodejs";

const RequestSchema = z.object({
  query: z.string().trim().min(1, "Please enter a preference.").max(1000),
});

export async function POST(request: Request) {
  try {
    const { query } = RequestSchema.parse(await request.json());
    return NextResponse.json(await runDebate(query));
  } catch (error) {
    const message = error instanceof Error ? error.message : "The debate could not be completed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
