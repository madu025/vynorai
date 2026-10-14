const authorize = new URLSearchParams(window.location.search).get("authorize");

try {
  if (!authorize) throw new Error("Microsoft sign-in address is missing.");
  const target = new URL(authorize);
  if (
    target.protocol !== "https:" ||
    target.hostname !== "login.microsoftonline.com"
  ) {
    throw new Error("Microsoft sign-in address is not allowed.");
  }
  window.location.replace(target.toString());
} catch (error) {
  document.body.textContent = (error as Error).message;
}
