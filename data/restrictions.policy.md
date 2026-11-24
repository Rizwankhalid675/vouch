# Restriction policy

`restrictions.json` is a bare array (the loader rejects anything else), so its policy lives here.

The tracked set is the EU-14 major allergens intersected with what this menu's ingredient data actually contains. Every tracked allergen is named in an item's "Contains" line, including when it is reached only through derivation. Ingredients outside that set are listed under Ingredients but never named in Contains.

Deliberately not tracked: chickpeas, horseradish, garlic, cocoa, sauerkraut, cabbage.

`shellfish` is tracked but no menu item reaches it. That is deliberate: it is the zero-hit "safe" case the exhaustive sweep needs, not a data error.
