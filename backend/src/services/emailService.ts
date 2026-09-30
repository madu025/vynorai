import nodemailer from "nodemailer";

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Send an email using configured SMTP or Resend API, with safe fallback to console.
 */
export async function sendEmail(options: EmailOptions): Promise<{ success: boolean; messageId?: string; simulated?: boolean }> {
  const { to, subject, html, text } = options;
  const from = process.env.SMTP_FROM || process.env.EMAIL_FROM || "VynorAI Security <security@vynor.lk>";

  // 1. Resend API (HTTP-based, extremely reliable in production)
  const resendApiKey = process.env.RESEND_API_KEY;
  if (resendApiKey) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [to],
          subject,
          html,
          text,
        }),
      });
      const data = await res.json() as any;
      if (res.ok) {
        console.log(`[Email] Sent via Resend to ${to} (id: ${data.id})`);
        return { success: true, messageId: data.id };
      }
      console.warn("[Email] Resend API error:", data);
    } catch (err) {
      console.error("[Email] Resend delivery failed:", err);
    }
  }

  // 2. Standard SMTP (Gmail, Zoho, Amazon SES, SendGrid, etc.)
  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (smtpHost && smtpUser && smtpPass) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(process.env.SMTP_PORT || "587"),
        secure: process.env.SMTP_SECURE === "true" || process.env.SMTP_PORT === "465",
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });

      const info = await transporter.sendMail({
        from,
        to,
        subject,
        html,
        text: text || html.replace(/<[^>]+>/g, " ").trim(),
      });

      console.log(`[Email] Sent via SMTP to ${to} (id: ${info.messageId})`);
      return { success: true, messageId: info.messageId };
    } catch (err) {
      console.error("[Email] SMTP delivery failed:", err);
    }
  }

  // 3. Fallback: Log to console in development or when SMTP is not configured
  console.log(`[Email-Simulated] ==========================================`);
  console.log(`[Email-Simulated] To: ${to}`);
  console.log(`[Email-Simulated] Subject: ${subject}`);
  console.log(`[Email-Simulated] Content Preview: ${text || html.slice(0, 150)}...`);
  console.log(`[Email-Simulated] ==========================================`);
  return { success: true, simulated: true };
}

/**
 * Send 6-Digit Email Verification Code with a branded HTML template
 */
export async function sendVerificationEmail(email: string, name: string, otpCode: string, token: string): Promise<boolean> {
  const verifyUrl = `${process.env.BASE_URL || "https://vynor.lk"}/api/auth/verify-email?token=${token}`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"/></head>
    <body style="background-color:#090b10; color:#f0f4f8; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; margin:0; padding:40px 20px;">
      <div style="max-width:520px; margin:0 auto; background:rgba(18,22,34,0.9); border:1px solid rgba(0,229,255,0.3); border-radius:16px; padding:36px; box-shadow:0 10px 40px rgba(0,0,0,0.5);">
        <div style="display:flex; align-items:center; gap:12px; margin-bottom:24px;">
          <div style="width:40px; height:40px; background:linear-gradient(135deg, #00e5ff 0%, #b026ff 100%); border-radius:10px; display:inline-flex; align-items:center; justify-content:center; font-weight:bold; font-size:22px; color:#000;">⚡</div>
          <span style="font-size:22px; font-weight:800; color:#fff; letter-spacing:-0.5px;">Vynor<span style="color:#00e5ff;">AI</span></span>
        </div>

        <h2 style="font-size:22px; font-weight:700; color:#fff; margin-bottom:12px;">Verify your email address</h2>
        <p style="color:#8e9bb0; font-size:14px; line-height:1.6; margin-bottom:24px;">
          Hi ${name || "Developer"}, thank you for signing up with VynorAI. To secure your account and activate your AI token, please use the 6-digit verification code below:
        </p>

        <div style="background:rgba(0,0,0,0.5); border:1px dashed rgba(0,229,255,0.4); border-radius:12px; padding:20px; text-align:center; margin:24px 0;">
          <span style="font-family:'Courier New',Courier,monospace; font-size:36px; font-weight:800; letter-spacing:8px; color:#00e5ff;">${otpCode}</span>
          <div style="color:#8e9bb0; font-size:12px; margin-top:8px;">Code expires in 24 hours</div>
        </div>

        <p style="color:#8e9bb0; font-size:13px; text-align:center; margin-bottom:24px;">
          Or verify directly with one click:
        </p>

        <div style="text-align:center; margin-bottom:30px;">
          <a href="${verifyUrl}" style="background:linear-gradient(135deg,#00e5ff,#b026ff); color:#000; font-weight:700; text-decoration:none; padding:12px 28px; border-radius:10px; font-size:14px; display:inline-block;">Verify Email Instantly →</a>
        </div>

        <hr style="border:none; border-top:1px solid rgba(255,255,255,0.08); margin:28px 0 20px 0;"/>
        <p style="color:#64748b; font-size:12px; text-align:center; margin:0;">
          If you did not create a VynorAI account, please ignore this email.<br/>
          &copy; 2026 VynorAI Technologies. All rights reserved.
        </p>
      </div>
    </body>
    </html>
  `;

  const res = await sendEmail({
    to: email,
    subject: `🔐 Your VynorAI Verification Code: ${otpCode}`,
    html,
    text: `Your VynorAI verification code is: ${otpCode}. It expires in 24 hours. Or visit: ${verifyUrl}`,
  });

  return res.success;
}
