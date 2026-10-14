declare const Office: any;

Office.onReady(() => {
  Office.context.ui.messageParent(
    JSON.stringify({ callbackUrl: window.location.href }),
    { targetOrigin: window.location.origin },
  );
});
