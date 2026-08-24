import { z } from "zod";

export interface LLMProvider {
  /**
   * Generates a structured JSON response from the LLM based on the provided prompt and Zod schema.
   * Should throw an error if the generation fails or doesn't match the schema.
   */
  generateStructured<T>(prompt: string, schema: z.ZodSchema<T>): Promise<{ parsed: T; raw: string }>;

  /**
   * Generates free-form text from the LLM based on the provided prompt.
   * Should throw an error if the generation fails.
   */
  generateText(prompt: string): Promise<string>;
}
