/** Small, side-effect-free helpers shared by task-pane feature modules. */

export function signInDialogMessage(code: unknown): string {
  if (code === 12007)
    return "A Microsoft sign-in window is already open. Finish it, or close it and press Sign in again.";
  if (code === 12009)
    return "The sign-in window was blocked. Allow pop-ups for this page, then press Sign in again.";
  if (code === 12011)
    return "The browser blocked the sign-in window. Allow pop-ups for Office, then press Sign in again.";
  return `Unable to open the Microsoft sign-in dialog (${String(code ?? "unknown")}).`;
}

export function supportsExcelApi(version: string): boolean {
  try {
    return Boolean(
      (globalThis as any).Office?.context?.requirements?.isSetSupported?.(
        "ExcelApi",
        version,
      ),
    );
  } catch {
    return false;
  }
}

export function splitEmailAddresses(value: string): string[] {
  return value
    .split(/[;,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function escapeEmailHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function textToBase64(value: string): { base64: string; bytes: number } {
  const data = new TextEncoder().encode(value);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < data.length; offset += chunkSize)
    binary += String.fromCharCode(
      ...data.subarray(offset, Math.min(data.length, offset + chunkSize)),
    );
  return { base64: btoa(binary), bytes: data.byteLength };
}

export function base64Bytes(value: string): number {
  return Math.max(
    0,
    Math.floor((value.length * 3) / 4) -
      (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0),
  );
}

export function editDistance(left: string, right: string): number {
  const a = left.toLocaleLowerCase().trim();
  const b = right.toLocaleLowerCase().trim();
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= b.length; column += 1) {
      const above = previous[column];
      previous[column] = Math.min(
        previous[column] + 1,
        previous[column - 1] + 1,
        diagonal + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[b.length];
}
