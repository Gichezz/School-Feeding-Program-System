const nodemailer = require('nodemailer');

/**
 * Sending email: activation codes to new feeding teachers, and a note when their school
 * device is approved.
 *
 * Configured with SMTP_HOST (and SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, MAIL_FROM).
 * Docker Compose points it at Mailpit, a local test mailbox that catches every message
 * and shows it at http://localhost:8025, so nothing reaches a real inbox. On a server it
 * is the programme's own mail server or an email provider.
 *
 * Without SMTP_HOST, nothing is sent and callers fall back to what they did before
 * (the administrator hands the activation code over). A failed send never fails the
 * request that caused it.
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
      connectionTimeout: 10000,
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
    console.warn(`Email to ${to} not sent: ${error.message}`);
    return { sent: false, error: error.message };
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
