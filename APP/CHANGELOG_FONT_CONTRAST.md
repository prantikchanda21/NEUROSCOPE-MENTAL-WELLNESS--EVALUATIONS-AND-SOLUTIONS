# Font Contrast Update

- All primary mobile-app text is forced to solid black (#000000).
- Text uses bold/extra-bold weights for improved readability.
- Headings use weight 900.
- Inputs, selects, textareas, labels, placeholders, buttons, tables and common text elements receive the same high-contrast treatment.
- Existing layout and feature logic are preserved.
- The override is scoped to `.neuroscope-app` so the mobile white UI receives the change without requiring a component-by-component rewrite.
