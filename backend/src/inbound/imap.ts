import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { config } from "../config.js";
import { getSetting, setSetting } from "../db.js";
import { handleInbound } from "./handle.js";
import { log } from "../log.js";

export function imapEnabled(): boolean {
  const c = config();
  return Boolean(c.IMAP_HOST && c.IMAP_USER && c.IMAP_PASS);
}

/** Polls the shared mailbox for new messages since the last seen UID and hands each to handleInbound. */
export async function pollInbox(): Promise<number> {
  if (!imapEnabled()) return 0;
  const c = config();
  const client = new ImapFlow({ host: c.IMAP_HOST!, port: c.IMAP_PORT, secure: c.IMAP_PORT === 993, auth: { user: c.IMAP_USER!, pass: c.IMAP_PASS! }, logger: false });
  let handled = 0;
  await client.connect();
  try {
    const lock = await client.getMailboxLock(c.IMAP_MAILBOX);
    try {
      const lastUid = await getSetting<number>("imap_last_uid", 0);
      const uids = (await client.search({ uid: `${lastUid + 1}:*` }, { uid: true })) || [];
      let maxUid = lastUid;
      for (const uid of uids) {
        if (uid <= lastUid) continue;
        const msg = await client.fetchOne(String(uid), { source: true, envelope: true }, { uid: true });
        if (!msg || !msg.source) continue;
        const parsed = await simpleParser(msg.source);
        const from = parsed.from?.value?.[0];
        if (!from?.address) continue;
        const text = parsed.text ?? (parsed.html ? String(parsed.html).replace(/<[^>]+>/g, " ") : "");
        const autoSubmitted = parsed.headers.get("auto-submitted");
        if (autoSubmitted && String(autoSubmitted) !== "no" && !/out of office|away/i.test(parsed.subject ?? "")) {
          maxUid = Math.max(maxUid, uid);
          continue; // bounces and auto-responders other than out-of-office
        }
        await handleInbound({
          messageId: parsed.messageId ?? `<uid-${uid}@imap>`,
          from: from.address,
          fromName: from.name ?? null,
          to: parsed.to && !Array.isArray(parsed.to) ? parsed.to.text : null,
          subject: parsed.subject ?? "",
          text,
          inReplyTo: parsed.inReplyTo ?? null,
          receivedAt: parsed.date ?? new Date(),
        });
        handled++;
        maxUid = Math.max(maxUid, uid);
      }
      if (maxUid !== lastUid) await setSetting("imap_last_uid", maxUid);
    } finally {
      lock.release();
    }
  } catch (err) {
    log.error({ err }, "imap poll failed");
  } finally {
    await client.logout().catch(() => {});
  }
  return handled;
}
