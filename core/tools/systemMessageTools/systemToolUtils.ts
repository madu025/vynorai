import { ToolCallDelta } from "../..";

export function closeTag(openingTag: string): string {
  return `</${openingTag.slice(1)}`;
}

export function splitAtCodeblocksAndNewLines(content: string) {
  return content.split(/(```|\n)/g).filter(Boolean);
}

function randomLettersAndNumbers(length: number): string {
  const characters =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  // Tool-call ids are matched against provider responses, so they come from the CSPRNG.
  // Rejection sampling keeps the characters uniform (248 is the largest multiple of 62 below 256).
  let result = "";
  const bytes = new Uint8Array(length * 2);
  while (result.length < length) {
    globalThis.crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte >= 248) continue;
      result += characters.charAt(byte % characters.length);
      if (result.length === length) break;
    }
  }
  return result;
}

export function generateOpenAIToolCallId(): string {
  return `call_${randomLettersAndNumbers(24)}`;
}

export function createDelta(
  name: string,
  args: string,
  id: string,
): ToolCallDelta {
  return {
    type: "function",
    function: {
      name,
      arguments: args,
    },
    id,
  };
}
