const nodemailer = require('nodemailer');

/**
 * Sending email: activation codes to new feeding teachers, and a note when their school
 * device is approved.
 *
 * Configured with SMTP_HOST (and SMTP_PORT, SMTP_SECURE, SMTP_REQUIRE_TLS, SMTP_USER,
 * SMTP_PASS, MAIL_FROM), all from the environment, never from the code. In production use
 * an authenticated provider with SMTP_SECURE=true (port 465) or SMTP_REQUIRE_TLS=true
 * (STARTTLS on 587), and a sender domain with SPF, DKIM and DMARC (docs/deployment.md).
 * Docker Compose points it at Mailpit, a local test mailbox that catches every message
 * and shows it at http://localhost:8025, so nothing reaches a real inbox. On a server it
 * is the programme's own mail server or an email provider.
 *
 * Without SMTP_HOST, nothing is sent. A failed send never fails the request that caused
 * it; services/emailDelivery.js records each attempt so it can be seen and sent again.
 * Logs never contain the recipient or the message, which may hold an activation code.
 */

let transport = null;

function isEmailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_HOST.trim());
}

function getTransport() {
  if (!transport) {
    const port = Number(process.env.SMTP_PORT) || 587;
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST.trim(),
      port,
      secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465,
      ...(process.env.SMTP_USER && { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } }),
      requireTLS: String(process.env.SMTP_REQUIRE_TLS || '').toLowerCase() === 'true',
      // Give up rather than hold a request: connecting, the server's greeting, and silence
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    });
  }
  return transport;
}

/** Send one plain-text message. Returns { sent: true } or { sent: false, error }. */
async function sendMail({ to, subject, text }) {
  if (!isEmailConfigured()) return { sent: false, error: 'Email is not set up' };
  try {
    await getTransport().sendMail({
      from: process.env.MAIL_FROM || 'Lishe <no-reply@lishe.local>',
      to,
      subject,
      text,
    });
    return { sent: true };
  } catch (error) {
    // The reason only: no address or message content in the logs
    console.warn(`Email not sent: ${error.code || 'error'}`);
    return { sent: false, error: String(error.message || error.code || 'Not sent').slice(0, 300) };
  }
}

/** The web address people open Lishe at, for links in emails. */
function appUrl() {
  return (process.env.PUBLIC_URL || process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');
}

const formatExpiry = (date) => new Date(date).toLocaleString('en-GB', {
  timeZone: process.env.SCHOOL_TIMEZONE || 'Africa/Nairobi', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
});

/** A new feeding teacher's activation code. */
function activationEmail({ name, code, expiresAt }) {
  return {
    subject: 'Your Lishe activation code',
    text: [
      `Hello ${name},`,
      '',
      'An account has been created for you to record school feeding in Lishe.',
      '',
      `Your activation code is: ${code}`,
      '',
      `On the school's tablet or phone, open ${appUrl()}/activate, choose "Activation code",`,
      'and enter your email, this code, a password and a 6-digit PIN.',
      '',
      `The code works once, until ${formatExpiry(expiresAt)}. If you were not expecting this email, you can ignore it.`,
    ].join('\n'),
  };
}

/** A feeding teacher's school device has been approved. */
function deviceApprovedEmail({ name, deviceName }) {
  return {
    subject: 'Your school device is ready',
    text: [
      `Hello ${name},`,
      '',
      `${deviceName} has been approved. You can now sign in on it with your email and PIN.`,
    ].join('\n'),
  };
}

module.exports = { isEmailConfigured, sendMail, activationEmail, deviceApprovedEmail };
