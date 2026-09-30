# Print Report Fix

- Replaced `window.print()` on the live dashboard modal with a standalone printable A4 report window.
- Print output now excludes the app dashboard, sticky headers, modal controls, fixed containers, and scroll clipping.
- Added stable page-break behavior for scores, protocols, safety guidance, and profile context.
- Added physical/lifestyle personalization context to the printed report when enabled.
- Preserved the existing on-screen report and Copy Text behavior.
- Browser Print can be used to save the standalone report directly as PDF.
