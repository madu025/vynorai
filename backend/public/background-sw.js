self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}
  const status = String(data.status || "updated");
  const passed = Number(data.passed || 0);
  const total = Number(data.total || 0);
  event.waitUntil(self.registration.showNotification("VynorAI Background Agent", {
    body: `Task ${status}. ${passed}/${total} checks passed${data.highestRisk ? `; risk: ${data.highestRisk}` : ""}.`,
    icon: "/favicon.svg",
    tag: `vynor-background-${String(data.taskId || "task")}`,
    data: { url: "/#background-agents" },
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.url || "/"));
});
