import { EmailProvider } from "./provider";

export class StubEmailProvider implements EmailProvider {
  /**
   * If true, forces the send method to throw an error (useful for testing retries).
   */
  public forceFailure = false;

  async send(to: string, subject: string, html: string): Promise<void> {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 300));

    if (this.forceFailure) {
      throw new Error("StubEmailProvider forced failure");
    }

    console.log(`\n[StubEmail] 📧 Email sent to: ${to}`);
    console.log(`[StubEmail] Subject: ${subject}`);
    console.log(`[StubEmail] Body Length: ${html.length} chars\n`);
  }
}
