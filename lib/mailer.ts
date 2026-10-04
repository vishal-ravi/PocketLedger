import {mkdir, appendFile} from 'node:fs/promises';
import path from 'node:path';
import {logger} from '@/lib/logger';

export type MailPayload = {to: string; subject: string; text: string; html?: string};

export type MailResult = {transport: 'file' | 'webhook' | 'smtp'; delivered: boolean; detail?: string};

const MAIL_DIR = process.env.MAIL_DIR ?? path.join(process.cwd(), 'logs', 'mail');

async function deliverFile(mail: MailPayload): Promise<MailResult> {
  await mkdir(MAIL_DIR, {recursive: true});
  const file = path.join(MAIL_DIR, 'outbox.log');
  const entry = [
    '================================================================================',
    `Date: ${new Date().toISOString()}`,
    `To: ${mail.to}`,
    `Subject: ${mail.subject}`,
    '',
    mail.text,
    '',
    '',
  ].join('\n');
  await appendFile(file, entry, 'utf8');
  // Keep the outbox bounded in dev.
  const {stat, unlink} = await import('node:fs/promises');
  try {
    const s = await stat(file);
    if (s.size > 1_000_000) await unlink(file);
  } catch {
    /* ignore */
  }
  return {transport: 'file', delivered: true, detail: file};
}

async function deliverWebhook(mail: MailPayload): Promise<MailResult> {
  const url = process.env.MAIL_WEBHOOK_URL;
  if (!url) return {transport: 'webhook', delivered: false, detail: 'MAIL_WEBHOOK_URL not set'};
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {'content-type': 'application/json', ...(process.env.MAIL_WEBHOOK_KEY ? {authorization: `Bearer ${process.env.MAIL_WEBHOOK_KEY}`} : {})},
      body: JSON.stringify({to: mail.to, subject: mail.subject, text: mail.text, html: mail.html ?? mail.text}),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return {transport: 'webhook', delivered: false, detail: `HTTP ${res.status}`};
    return {transport: 'webhook', delivered: true};
  } catch (err) {
    logger.error('mail:webhook_failed', {error: String(err)});
    return {transport: 'webhook', delivered: false, detail: String(err)};
  }
}

async function deliverSmtp(mail: MailPayload): Promise<MailResult> {
  const url = process.env.SMTP_URL;
  if (!url) return {transport: 'smtp', delivered: false, detail: 'SMTP_URL not set'};
  try {
    const {default: nodemailer} = await import('nodemailer');
    const transport = nodemailer.createTransport(url);
    await transport.sendMail({
      from: process.env.MAIL_FROM ?? 'PocketLedger <no-reply@localhost>',
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html ?? mail.text,
    });
    return {transport: 'smtp', delivered: true};
  } catch (err) {
    logger.error('mail:smtp_failed', {error: String(err)});
    return {transport: 'smtp', delivered: false, detail: String(err)};
  }
}

/**
 * Send a message.
 * - `MAIL_TRANSPORT=smtp` + `SMTP_URL` → real SMTP (requires `nodemailer` installed)
 * - `MAIL_TRANSPORT=webhook` + `MAIL_WEBHOOK_URL` → POST JSON (Resend/SendGrid/etc. relay)
 * - default (`file`) → appends to `logs/mail/outbox.log` and logs the recipient + subject
 *
 * Never throws: callers fall back to a generic "if that address exists" response.
 */
export async function sendMail(mail: MailPayload): Promise<MailResult> {
  const forced = process.env.MAIL_TRANSPORT;
  let result: MailResult;

  if (forced === 'smtp') result = await deliverSmtp(mail);
  else if (forced === 'webhook') result = await deliverWebhook(mail);
  else if (process.env.SMTP_URL && !forced) result = await deliverSmtp(mail);
  else result = await deliverFile(mail);

  logger.info('mail:sent', {to: mail.to, subject: mail.subject, delivered: result.delivered, transport: result.transport});
  if (!result.delivered && result.transport !== 'file') {
    const fallback = await deliverFile(mail);
    return {...result, detail: `${result.detail ?? ''} (logged to ${fallback.detail})`};
  }
  return result;
}
