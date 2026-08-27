function updateDeadlines() {
  const now = Date.now();

  document.querySelectorAll("[data-due]").forEach((element) => {
    const due = Date.parse(element.getAttribute("data-due") || "");
    if (Number.isNaN(due)) return;

    const remaining = due - now;
    const absolute = Math.abs(remaining);
    const minutes = Math.floor(absolute / 60000);
    const seconds = Math.floor((absolute % 60000) / 1000);

    if (remaining <= 0) {
      element.classList.add("deadline-overdue");
      element.textContent = `Overdue by ${minutes}m ${String(seconds).padStart(2, "0")}s`;
    } else {
      element.classList.remove("deadline-overdue");
      element.textContent = `${minutes}m ${String(seconds).padStart(2, "0")}s remaining`;
    }
  });
}

updateDeadlines();
setInterval(updateDeadlines, 1000);
