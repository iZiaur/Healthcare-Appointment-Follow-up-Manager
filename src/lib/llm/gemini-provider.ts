import { z } from "zod";
import { LLMProvider } from "./provider";
import { GoogleGenAI, Type } from "@google/genai";
import { zodToJsonSchema } from "zod-to-json-schema"; // Need this or map it manually

// Instead of depending on zod-to-json-schema, we can construct the gemini responseSchema manually 
// based on our specific expected shape if we don't want the extra dependency, but for generic
// type T we'd ideally map it. For now, since the brief focuses on one specific prompt, 
// we'll pass a custom `geminiSchema` if we wanted to be perfectly generic, or just hardcode
// the schema required for the pre-visit summary.

export class GeminiProvider implements LLMProvider {
  private ai: GoogleGenAI;

  constructor(apiKey?: string) {
    // If apiKey is not provided, the SDK will look for GEMINI_API_KEY env var
    this.ai = new GoogleGenAI({ apiKey: apiKey || process.env.GEMINI_API_KEY });
  }

  async generateStructured<T>(prompt: string, schema: z.ZodSchema<T>): Promise<{ parsed: T; raw: string }> {
    // For this specific use case, we map the known Zod schema to Gemini's ResponseSchema format.
    // In a fully generic implementation, we would use a library to convert Zod -> JSON Schema -> Gemini Schema.
    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        urgency: {
          type: Type.STRING,
          description: "Urgency level: LOW, MEDIUM, or HIGH"
        },
        chief_complaint: {
          type: Type.STRING,
          description: "The primary medical complaint of the patient"
        },
        suggested_questions: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: "Three suggested questions for the doctor to ask"
        }
      },
      required: ["urgency", "chief_complaint", "suggested_questions"]
    };

    const response = await this.ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: responseSchema,
      }
    });

    const raw = response.text || "{}";
    
    // Parse it back to JSON
    let jsonObj;
    try {
      jsonObj = JSON.parse(raw);
    } catch (e) {
      throw new Error(`Failed to parse LLM JSON output: ${raw}`);
    }

    // Validate using Zod to ensure runtime safety matches compile-time T
    const parsed = schema.parse(jsonObj);

    return { parsed, raw };
  }

  async generateText(prompt: string): Promise<string> {
    const response = await this.ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    return response.text || "";
  }
}
