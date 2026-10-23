/**
 * Keeps an agent answer short on screen. Display only: the full text stays in the page (the extra
 * lines are hidden, not removed). The first few bullets are shown, every bullet that carries a
 * warning is always shown, and a closing question is always shown. Pure.
 */
export const REPLY_VISIBLE_BULLETS = 3;

const WARNING =
  /not found|error|warning|unmatched|failed|check needed|#spill|⚠/i;
const BULLET = /^\s*[-•*]\s+/;

export interface ReplyLine {
  text: string;
  bullet: boolean;
  /** True for the bullets a "Show more" toggle reveals. */
  extra: boolean;
  warning: boolean;
}

export interface ClampedReply {
  lines: ReplyLine[];
  /** How many lines are tucked behind "Show more". */
  hiddenCount: number;
}

export function clampReply(
  text: string,
  visibleBullets = REPLY_VISIBLE_BULLETS,
): ClampedReply {
  const raw = text.split(/\n/).filter((line) => line.trim());
  const bulletIndexes = raw
    .map((line, index) => (BULLET.test(line) ? index : -1))
    .filter((index) => index >= 0);
  const lastBullet = bulletIndexes[bulletIndexes.length - 1];
  const lines: ReplyLine[] = raw.map((line, index) => {
    const bullet = BULLET.test(line);
    const warning = WARNING.test(line);
    const rank = bulletIndexes.indexOf(index);
    const closingQuestion =
      bullet && index === lastBullet && /\?\s*$/.test(line.trim());
    const extra =
      bullet && !warning && !closingQuestion && rank >= visibleBullets;
    return { text: line, bullet, extra, warning };
  });
  return { lines, hiddenCount: lines.filter((line) => line.extra).length };
}
