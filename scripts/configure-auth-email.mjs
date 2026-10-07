// Preview by default. Apply only to the explicitly named hosted project.
import { readFileSync } from 'node:fs';

const authentication = ['confirmation', 'invite', 'magic_link', 'recovery', 'email_change', 'reauthentication'];
const notifications = ['password_changed', 'email_changed', 'phone_changed', 'identity_linked', 'identity_unlinked', 'mfa_factor_enrolled', 'mfa_factor_unenrolled'];
const config = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
const payload = { enable_signup: true, mailer_autoconfirm: false, mailer_secure_email_change_enabled: true, security_update_password_require_reauthentication: true, mailer_otp_exp: 3600, mailer_otp_length: 6, smtp_max_frequency: 60 };
for (const [kind, names] of [['template', authentication], ['notification', notifications]]) {
  for (const name of names) {
    const heading = `[auth.email.${kind}.${name}]`;
    const section = config.slice(config.indexOf(heading) + heading.length).split(/\n\[/)[0];
    const subject = section.match(/subject = "([^"]+)"/)?.[1];
    const path = section.match(/content_path = "([^"]+)"/)?.[1];
    if (!subject || !path) throw new Error(`Missing configuration for ${heading}`);
    const suffix = kind === 'notification' ? `${name}_notification` : name;
    payload[`mailer_subjects_${suffix}`] = subject;
    payload[`mailer_templates_${suffix}_content`] = readFileSync(new URL(`../${path.replace(/^\.\//, '')}`, import.meta.url), 'utf8');
    if (kind === 'notification') payload[`mailer_notifications_${name}_enabled`] = true;
  }
}
const applying = process.argv.includes('--apply');
const project = process.env.SUPABASE_PROJECT_REF;
const sender = process.env.GILDOPS_AUTH_SENDER;
const site = process.env.GILDOPS_SITE_URL;
if (applying) {
  if (!/^[a-z]{20}$/.test(project ?? '')) throw new Error('Set SUPABASE_PROJECT_REF to the intended hosted project.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sender ?? '')) throw new Error('Set GILDOPS_AUTH_SENDER to a verified Resend sender address.');
  const url = new URL(site);
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('GILDOPS_SITE_URL must be your HTTPS product origin.');
  if (!process.env.RESEND_SMTP_PASSWORD || !process.env.SUPABASE_ACCESS_TOKEN) throw new Error('Set RESEND_SMTP_PASSWORD and SUPABASE_ACCESS_TOKEN securely.');
  Object.assign(payload, { smtp_host: 'smtp.resend.com', smtp_port: '465', smtp_user: 'resend', smtp_pass: process.env.RESEND_SMTP_PASSWORD, smtp_admin_email: sender, smtp_sender_name: 'GildOps', site_url: url.origin });
  // Preserve existing redirect URLs while adding the product's fixed callback paths.
  const endpoint = `https://api.supabase.com/v1/projects/${project}/config/auth`;
  const headers = { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' };
  const currentResponse = await fetch(endpoint, { headers });
  if (!currentResponse.ok) throw new Error(`Auth configuration read failed (${currentResponse.status}).`);
  const current = await currentResponse.json();
  const callbacks = ['/auth/callback', '/auth/recover', '/auth/email-change'].map((path) => url.origin + path);
  payload.uri_allow_list = [...new Set([...(current.uri_allow_list ?? '').split(',').filter(Boolean), ...callbacks])].join(',');
  const response = await fetch(endpoint, { method: 'PATCH', headers, body: JSON.stringify(payload) });
  if (!response.ok) throw new Error(`Auth configuration update failed (${response.status}).`);
  const verificationResponse = await fetch(endpoint, { headers });
  if (!verificationResponse.ok) throw new Error('Configuration was updated but read-back failed.');
  const verified = await verificationResponse.json();
  const keys = Object.keys(payload).filter((key) => key !== 'smtp_pass');
  if (keys.some((key) => String(verified[key]) !== String(payload[key]))) throw new Error('Configuration was updated but read-back differed. Check hosted Auth settings.');
  console.log(`GildOps Auth email configuration applied and verified for ${project}.`);
} else {
  console.log('Preview: 6 GildOps authentication templates, 7 enabled security notifications, email confirmation, 6-digit codes, 1-hour expiry, 60-second resend interval.');
  console.log('Delivery: Resend SMTP (smtp.resend.com:465), username resend, sender name GildOps.');
  console.log('Apply with --apply after setting SUPABASE_PROJECT_REF, SUPABASE_ACCESS_TOKEN, GILDOPS_SITE_URL, GILDOPS_AUTH_SENDER, RESEND_SMTP_PASSWORD. Secrets are never printed.');
}
