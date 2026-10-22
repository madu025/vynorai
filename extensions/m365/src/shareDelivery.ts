/**
 * Delivery of the share card (pure, the browser is passed in): one action that puts the picture
 * and its text where WhatsApp can take them. On a phone the share sheet comes first (WhatsApp is
 * in it); on a computer the picture goes to the clipboard, so Ctrl+V pastes it into WhatsApp Web
 * and WhatsApp Desktop. If the picture cannot be copied, the text is. Nothing is sent from here.
 */
import type { Language } from "./i18n.js";
import { pick } from "./paneText.js";

export type ShareOutcome =
  | "shared"
  | "image-copied"
  | "text-copied"
  | "cancelled"
  | "failed";

export interface ShareEnv {
  /** True on phones and tablets, where the share sheet is the natural way to WhatsApp. */
  preferShare: boolean;
  share?: (data: { files: File[]; text: string }) => Promise<void>;
  canShare?: (data: { files: File[] }) => boolean;
  writeClipboard?: (items: Array<Record<string, Blob>>) => Promise<void>;
  writeText?: (text: string) => Promise<void>;
  execCopy?: (text: string) => boolean;
}

const isAbort = (error: unknown) =>
  (error as { name?: string } | undefined)?.name === "AbortError";

export async function deliverShare(
  image: Blob | null,
  text: string,
  env: ShareEnv,
  fileName = "vynorai-report.png",
): Promise<ShareOutcome> {
  const viaShareSheet = async (): Promise<ShareOutcome | undefined> => {
    if (!image || !env.share || !env.canShare) return undefined;
    const files = [new File([image], fileName, { type: "image/png" })];
    if (!env.canShare({ files })) return undefined;
    try {
      await env.share({ files, text });
      return "shared";
    } catch (error) {
      return isAbort(error) ? "cancelled" : undefined;
    }
  };
  const viaClipboard = async (): Promise<ShareOutcome | undefined> => {
    if (image && env.writeClipboard) {
      for (const items of [
        [
          {
            "image/png": image,
            "text/plain": new Blob([text], { type: "text/plain" }),
          },
        ],
        [{ "image/png": image }],
      ]) {
        try {
          await env.writeClipboard(items);
          return "image-copied";
        } catch {
          // Some browsers refuse a second type; the next try offers the picture alone.
        }
      }
    }
    try {
      if (env.writeText) {
        await env.writeText(text);
        return "text-copied";
      }
    } catch {
      // The old copy command is the last try.
    }
    return env.execCopy?.(text) ? "text-copied" : undefined;
  };
  const order = env.preferShare
    ? [viaShareSheet, viaClipboard]
    : [viaClipboard, viaShareSheet];
  for (const way of order) {
    const outcome = await way();
    if (outcome) return outcome;
  }
  return "failed";
}

export function shareOutcomeText(
  outcome: ShareOutcome,
  language: Language,
): string {
  switch (outcome) {
    case "shared":
      return pick(
        language,
        "Shared. Nothing else left this device.",
        "බෙදාගත්තා. වෙන කිසිවක් මෙම උපාංගයෙන් ගියේ නැත.",
        "பகிரப்பட்டது. வேறு எதுவும் இந்தச் சாதனத்தை விட்டுச் செல்லவில்லை.",
      );
    case "image-copied":
      return pick(
        language,
        "Picture copied. Open WhatsApp Web or Desktop, press Ctrl+V (Cmd+V on Mac) and send.",
        "රූපය පිටපත් කළා. WhatsApp Web හෝ Desktop විවෘත කර Ctrl+V (Mac හි Cmd+V) ඔබා යවන්න.",
        "படம் நகலெடுக்கப்பட்டது. WhatsApp Web அல்லது Desktop-ஐத் திறந்து Ctrl+V (Mac-இல் Cmd+V) அழுத்தி அனுப்புங்கள்.",
      );
    case "text-copied":
      return pick(
        language,
        "This browser cannot copy the picture, so the text is copied. Paste it into WhatsApp.",
        "මෙම browser එකට රූපය පිටපත් කළ නොහැකි නිසා පෙළ පිටපත් කළා. WhatsApp හි paste කරන්න.",
        "இந்த உலாவியால் படத்தை நகலெடுக்க முடியாததால் உரை நகலெடுக்கப்பட்டது. WhatsApp-இல் ஒட்டுங்கள்.",
      );
    case "cancelled":
      return pick(
        language,
        "Sharing was cancelled.",
        "බෙදාගැනීම අවලංගු කළා.",
        "பகிர்வு ரத்து செய்யப்பட்டது.",
      );
    default:
      return pick(
        language,
        "Could not copy or share from here. Save the picture with a right-click instead.",
        "මෙතැනින් පිටපත් කිරීමට හෝ බෙදාගැනීමට නොහැකි විය. ඒ වෙනුවට රූපය right-click කර සුරකින්න.",
        "இங்கிருந்து நகலெடுக்கவோ பகிரவோ முடியவில்லை. படத்தை வலது-கிளிக் செய்து சேமிக்கவும்.",
      );
  }
}

/** The real browser, for the task pane. */
export function browserShareEnv(): ShareEnv {
  const nav = globalThis.navigator as Navigator | undefined;
  const Item = (globalThis as { ClipboardItem?: typeof ClipboardItem })
    .ClipboardItem;
  return {
    preferShare: /Android|iPhone|iPad|iPod/i.test(nav?.userAgent ?? ""),
    ...(typeof nav?.share === "function" && typeof nav.canShare === "function"
      ? {
          share: (data) => nav.share(data),
          canShare: (data) => nav.canShare(data),
        }
      : {}),
    ...(nav?.clipboard?.write && Item
      ? {
          writeClipboard: (items) =>
            nav.clipboard.write(items.map((item) => new Item(item))),
        }
      : {}),
    ...(nav?.clipboard?.writeText
      ? { writeText: (text) => nav.clipboard.writeText(text) }
      : {}),
    execCopy: (text) => {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    },
  };
}
