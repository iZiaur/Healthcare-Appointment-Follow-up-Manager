import { z } from "zod";
import { LLMProvider } from "./provider";
import { UrgencyLevel } from "@prisma/client";

export const LLM_TIMEOUT_MS = 5000;

export const PreVisitSummarySchema = z.object({
  urgency: z.enum(["LOW", "MEDIUM", "HIGH"]),
  chief_complaint: z.string(),
  suggested_questions: z.array(z.string()).max(5)
});

export type PreVisitSummaryOutput = z.infer<typeof PreVisitSummarySchema>;

export class SummaryService {
  constructor(private llmProvider: LLMProvider) {}

  /**
   * Generates a pre-visit summary from a list of symptoms.
   * Handles timeouts and 1 retry gracefully.
   */
  async generatePreVisitSummary(symptomsText: string): Promise<{
    parsed: PreVisitSummaryOutput | null;
    raw: string;
    status: "COMPLETED" | "PENDING_REVIEW";
  }> {
    const prompt = `Analyse these symptoms and return: urgency level (Low / Medium / High), chief complaint, and three suggested questions for the doctor. Symptoms: ${symptomsText}`;
    
    let lastError: Error | unknown;

    // Retry loop: 2 attempts max (initial + 1 retry)
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await this.withTimeout(
          this.llmProvider.generateStructured(prompt, PreVisitSummarySchema),
          LLM_TIMEOUT_MS
        );
        
        return {
          parsed: result.parsed,
          raw: result.raw,
          status: "COMPLETED"
        };
      } catch (err: any) {
        lastError = err;
        console.warn(`[SummaryService] Attempt ${attempt} failed: ${err.message}`);
      }
    }

    // Both attempts failed (timeout, network, or malformed JSON schema failure)
    return {
      parsed: null,
      raw: lastError instanceof Error ? lastError.message : String(lastError),
      status: "PENDING_REVIEW"
    };
  }

  /**
   * Generates a patient-friendly summary from doctor's clinical notes.
   * Handles timeouts and 1 retry gracefully.
   */
  async generatePostVisitSummary(notesText: string): Promise<{
    patientFriendlyText: string | null;
    rawOutput: string | null;
    status: "COMPLETED" | "PENDING_REVIEW";
  }> {
    const prompt = `Convert these clinical notes into a patient-friendly summary with medication schedule and follow-up steps: ${notesText}`;
    
    let lastError: Error | unknown;

    // Retry loop: 2 attempts max (initial + 1 retry)
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const resultText = await this.withTimeout(
          this.llmProvider.generateText(prompt),
          LLM_TIMEOUT_MS
        );
        
        return {
          patientFriendlyText: resultText,
          rawOutput: null,
          status: "COMPLETED"
        };
      } catch (err: any) {
        lastError = err;
        console.warn(`[SummaryService PostVisit] Attempt ${attempt} failed: ${err.message}`);
      }
    }

    // Both attempts failed
    return {
      patientFriendlyText: null,
      rawOutput: lastError instanceof Error ? lastError.message : String(lastError),
      status: "PENDING_REVIEW"
    };
  }

  /**
   * Helper to wrap a promise with a hard timeout.
   */
  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timeoutId: NodeJS.Timeout;
    
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`LLM call timed out after ${ms}ms`));
      }, ms);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
      clearTimeout(timeoutId);
    });
  }
}
