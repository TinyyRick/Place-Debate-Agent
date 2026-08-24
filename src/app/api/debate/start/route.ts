import { NextResponse } from "next/server";
import { z } from "zod";
import { startDebate } from "@/lib/graph/debate-graph";

export const runtime = "nodejs";

const RequestSchema = z.object({
  query: z.string().trim().min(1, "Please enter a preference.").max(1000),
  gpsCoordinates: z.object({ longitude: z.number().finite(), latitude: z.number().finite() }).optional(),
});

export async function POST(request: Request) {
  try {
    const { query, gpsCoordinates } = RequestSchema.parse(await request.json());
    return NextResponse.json(await startDebate(query, gpsCoordinates));
  } catch (error) {
    console.error("Debate start failed.", error);
    const message = error instanceof Error && error.message.startsWith("Only ")
      ? "没有足够符合要求的地点，请调整条件后重试。"
      : "地点推荐暂时无法完成，请稍后重试。";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
