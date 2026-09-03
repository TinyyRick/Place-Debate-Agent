import type { BaseMessageLike } from "@langchain/core/messages";
import { ChatDeepSeek } from "@langchain/deepseek";
import type { ZodType } from "zod";

export type ChatModelProvider = "deepseek";

export interface ChatModelConfig {
  provider?: ChatModelProvider;
  model?: "deepseek-v4-flash" | "deepseek-v4-pro";
  temperature?: number;
}

export interface StructuredModel {
  invoke<T extends Record<string, unknown>>(
    schema: ZodType<T>,
    messages: BaseMessageLike[],
    name: string,
  ): Promise<T>;
}

export function createChatModel({
  provider = "deepseek",
  model = (process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash") as ChatModelConfig["model"],
  temperature = 0,
}: ChatModelConfig = {}): StructuredModel {
  if (provider !== "deepseek") {
    throw new Error(`Unsupported model provider: ${provider}`);
  }
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error("DEEPSEEK_API_KEY is not configured. Add it to .env.local and try again.");
  }

  const chatModel = new ChatDeepSeek({
    model,
    temperature,
    modelKwargs: { thinking: { type: "disabled" } },
  });

  return {
    async invoke<T extends Record<string, unknown>>(
      schema: ZodType<T>,
      messages: BaseMessageLike[],
      name: string,
    ) {
      const runnable = chatModel.withStructuredOutput<T>(schema, { name });
      try {
        return schema.parse(await runnable.invoke(messages));
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        const isParseFailure = message.includes("Failed to parse") || message.includes("not valid JSON") || (error instanceof Error && (error.name === "ZodError" || error.name === "SyntaxError"));
        if (!isParseFailure) throw error;
        const repaired = await runnable.invoke([
          ...messages,
          { role: "user", content: `上一次输出未通过 JSON 校验：${message.slice(0, 800)}\n请修正上述问题后重新输出完整 JSON，不要输出任何其他内容。` },
        ]);
        return schema.parse(repaired);
      }
    },
  };
}
