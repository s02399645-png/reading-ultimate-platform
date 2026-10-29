// Applies the saved theme before first paint (kept as an external file so the CSP can forbid inline scripts).
try { var t = localStorage.getItem('ielts.theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) {}
