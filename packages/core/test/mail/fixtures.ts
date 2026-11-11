/** E-mails sintéticos (F14): nunca e-mails reais do dono (repositório público). */
export interface RawOpts {
  from?: string;
  replyTo?: string;
  subject?: string;
  html?: string;
  text?: string;
  /** `Authentication-Results` do Gmail; `null` = sem o cabeçalho. */
  auth?: string | null;
  attachments?: Array<{ filename: string; type: string; content: string }>;
}

export const AUTH_OK = (domain: string) =>
  `mx.google.com; dkim=pass header.i=@${domain} header.s=s1 header.b=abc; spf=pass (google.com: domain of bounce@${domain} designates 1.2.3.4 as permitted sender) smtp.mailfrom=bounce@${domain}; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=${domain}`;

export function rawMail(o: RawOpts = {}): Buffer {
  const from = o.from ?? "Vagas <alertas@vagas.example>";
  const domain = from.match(/@([^>\s]+)/)?.[1] ?? "vagas.example";
  const auth = o.auth === undefined ? AUTH_OK(domain) : o.auth;
  const boundary = "BOUNDARY-narnia";
  const head = [
    ...(auth ? [`Authentication-Results: ${auth}`] : []),
    `From: ${from}`,
    ...(o.replyTo ? [`Reply-To: ${o.replyTo}`] : []),
    `Subject: ${o.subject ?? "Novas vagas para você"}`,
    "Date: Tue, 10 Nov 2026 10:00:00 +0000",
    "Message-ID: <abc@vagas.example>",
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];
  const parts = [
    `--${boundary}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${o.html ?? "<p>Olá</p>"}`,
    ...(o.text !== undefined
      ? [`--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${o.text}`]
      : []),
    ...(o.attachments ?? []).map(
      (a) =>
        `--${boundary}\r\nContent-Type: ${a.type}; name="${a.filename}"\r\nContent-Disposition: attachment; filename="${a.filename}"\r\n\r\n${a.content}`,
    ),
  ];
  return Buffer.from(`${head.join("\r\n")}\r\n\r\n${parts.join("\r\n")}\r\n--${boundary}--\r\n`);
}
