import { z } from "zod";
import { LLMProvider } from "./provider";

export class StubProvider implements LLMProvider {
  /**
   * Used for testing LLM failures.
   * If true, generateStructured will forcefully throw an error.
   */
  public forceFailure = false;

  async generateStructured<T>(prompt: string, schema: z.ZodSchema<T>): Promise<{ parsed: T; raw: string }> {
    // Simulate network latency
    await new Promise(resolve => setTimeout(resolve, 500));

    if (this.forceFailure) {
      throw new Error("StubProvider forced failure");
    }

    // Since we don't know the exact T structure here, we'll try to provide a generic 
    // mocked response that fits our specific use case (Pre-visit Summary).
    // In a real stub, we'd have a factory based on the schema, but this suffices for the PoC.
    const rawObject = {
      urgency: "HIGH",
      chief_complaint: "Severe continuous headache for 3 days",
      suggested_questions: [
        "When did the headache exactly start?",
        "Are there any associated symptoms like nausea or light sensitivity?",
        "Have you taken any painkillers, and did they help?"
      ]
    };

    const rawString = JSON.stringify(rawObject);
    const parsed = schema.parse(rawObject);

    return {
      parsed,
      raw: rawString
    };
  }

  async generateText(prompt: string): Promise<string> {
    await new Promise(resolve => setTimeout(resolve, 500));
    
    if (this.forceFailure) {
      throw new Error("StubProvider forced failure");
    }

    return "This is a simulated patient-friendly summary based on the doctor's notes. Please take your medication as prescribed.";
  }
}
