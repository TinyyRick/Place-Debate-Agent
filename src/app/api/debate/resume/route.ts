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
    console.error("Debate resume failed.", error);
    const message = error instanceof Error && error.message.startsWith("Only ")
      ? "没有足够符合要求的地点，请调整条件后重试。"
      : "地点推荐暂时无法完成，请稍后重试。";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
