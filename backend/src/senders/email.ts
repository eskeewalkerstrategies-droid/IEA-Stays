import nodemailer, { type Transporter } from "nodemailer";
import { config } from "../config.js";
import { log } from "../log.js";

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  inReplyTo?: string;
  references?: string;
  attachments?: Array<{ filename: string; path?: string; content?: Buffer; contentType?: string }>;
  listUnsubscribe?: string;
}
export interface SentEmail extends OutgoingEmail {
  messageId: string;
  from: string;
  sentAt: Date;
}

/** In log mode (dev, tests) every email lands here instead of going out. */
export const mailOutbox: SentEmail[] = [];

let transporter: Transporter | undefined;
function smtp(): Transporter {
  const c = config();
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: c.SMTP_HOST,
      port: c.SMTP_PORT,
      secure: c.SMTP_SECURE,
      auth: c.SMTP_USER ? { user: c.SMTP_USER, pass: c.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

export function textToHtml(text: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const paras = esc.split(/\n{2,}/).map((p) => `<p style="margin:0 0 1em 0">${p.replace(/\n/g, "<br>")}</p>`);
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#1e1e19">${paras.join("")}</div>`;
}

export async function sendEmail(mail: OutgoingEmail): Promise<SentEmail> {
  const c = config();
  const from = c.MAIL_FROM;
  const headers: Record<string, string> = {};
  if (mail.listUnsubscribe) {
    headers["List-Unsubscribe"] = `<${mail.listUnsubscribe}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  if (c.MAIL_TRANSPORT === "log") {
    const sent: SentEmail = { ...mail, from, messageId: `<${Date.now()}.${Math.random().toString(36).slice(2)}@local>`, sentAt: new Date() };
    mailOutbox.push(sent);
    log.info({ to: mail.to, subject: mail.subject }, "email (log mode)");
    return sent;
  }
  const info = await smtp().sendMail({
    from,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html ?? textToHtml(mail.text),
    replyTo: mail.replyTo ?? c.MAIL_REPLY_TO,
    inReplyTo: mail.inReplyTo,
    references: mail.references,
    attachments: mail.attachments,
    headers,
  });
  return { ...mail, from, messageId: info.messageId, sentAt: new Date() };
}
