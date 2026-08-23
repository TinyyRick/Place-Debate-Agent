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
  temperature = 0.2,
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
      return schema.parse(await runnable.invoke(messages));
    },
  };
}
