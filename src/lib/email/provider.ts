export interface EmailProvider {
  /**
   * Sends an email to the specified recipient.
   * 
   * @param to The recipient email address
   * @param subject The email subject line
   * @param html The HTML body of the email
   */
  send(to: string, subject: string, html: string): Promise<void>;
}
