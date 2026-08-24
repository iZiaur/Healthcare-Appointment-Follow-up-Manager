import nodemailer from "nodemailer";
import { EmailProvider } from "./provider";

export class NodemailerProvider implements EmailProvider {
  private transporter: nodemailer.Transporter;

  constructor(smtpUrl?: string) {
    const url = smtpUrl || process.env.SMTP_URL;
    if (!url) {
      throw new Error("SMTP_URL is required for NodemailerProvider");
    }

    this.transporter = nodemailer.createTransport(url);
  }

  async send(to: string, subject: string, html: string): Promise<void> {
    const from = process.env.EMAIL_FROM || '"Healthcare Clinic" <noreply@healthcare-clinic.com>';
    
    await this.transporter.sendMail({
      from,
      to,
      subject,
      html,
    });
  }
}
