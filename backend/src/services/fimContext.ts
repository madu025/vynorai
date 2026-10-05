/**
 * Slice context intelligently to keep prompt payload small and fast.
 */
export function sliceFimContext(
  prefix: string,
  suffix: string = "",
): { prefix: string; suffix: string } {
  const prefixLines = prefix.split("\n");
  const suffixLines = suffix.split("\n");

  // Keep max 70 lines above cursor and 30 lines below cursor
  const slicedPrefix = prefixLines.slice(-70).join("\n");
  const slicedSuffix = suffixLines.slice(0, 30).join("\n");

  return {
    prefix: slicedPrefix,
    suffix: slicedSuffix,
  };
}
