/**
 * Lets config loading ask which workspace root is active without depending on
 * the workspace service. Core registers the provider once at startup; with no
 * provider (tests, headless use) callers simply get no preference.
 */
type ActiveRootUriProvider = () => Promise<string | undefined>;

let provider: ActiveRootUriProvider | undefined;

export function setActiveRootUriProvider(
  next: ActiveRootUriProvider | undefined,
): void {
  provider = next;
}

export async function getActiveRootUri(): Promise<string | undefined> {
  try {
    return await provider?.();
  } catch {
    return undefined;
  }
}
