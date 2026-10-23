/**
 * The pane page may request its bundle again when the first request stalls. Whichever copy runs
 * first starts the pane; a later copy stops here, before anything else in it runs.
 */
const booted = window as unknown as { __VYNOR_BOOTED__?: boolean };
if (booted.__VYNOR_BOOTED__) throw new Error("VYNOR_DUPLICATE_BOOT");
booted.__VYNOR_BOOTED__ = true;

export {};
