export type ReplyLanguage = "auto" | "en" | "si" | "ta";

export const REPLY_LANGUAGE_OPTIONS: Array<{
  value: ReplyLanguage;
  label: string;
}> = [
  { value: "auto", label: "Auto (follow my message)" },
  { value: "si", label: "සිංහල (Sinhala)" },
  { value: "ta", label: "தமிழ் (Tamil)" },
  { value: "en", label: "English" },
];

const NAMES: Record<Exclude<ReplyLanguage, "auto">, string> = {
  en: "English",
  si: "Sinhala (සිංහල script)",
  ta: "Tamil (தமிழ் script)",
};

/**
 * One block for the system message. It depends only on the setting, never on
 * the turn, so the provider's prompt cache keeps hitting inside a conversation.
 * "auto" adds nothing: the model already follows the language of the message.
 */
export function replyLanguageGuidance(
  language: ReplyLanguage | undefined,
): string {
  if (!language || language === "auto" || !(language in NAMES)) return "";
  return `\n\nREPLY LANGUAGE\nWrite explanations, summaries, plans and questions to the user in ${NAMES[language]}. Keep code, commands, file paths, identifiers, error messages and commit messages in English.`;
}
