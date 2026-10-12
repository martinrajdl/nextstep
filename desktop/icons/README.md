# Nextstep app icon

`nextstep.png` is the transparent 1024 × 1024 master. `nextstep.icns` contains the standard and Retina representations from 16 to 1024 pixels. `nextstep-ui.png` is the 256-pixel interface asset. All three use this repository's MIT license.

Generated with the built-in Imagegen tool, preserving the original folded-ribbon N. The high-contrast charcoal mark sits on a porcelain-white tile with a transparent perimeter. It stays neutral when users select a colorful workspace theme. PNG sizes are derived with macOS `sips`, preserving transparency. The separate marketing repository uses copies of the same artwork.

Rebuild the ICNS and interface PNG on macOS with `pnpm desktop:icon`. The packaging script embeds the ICNS before code signing and includes the PNG for Electron's Dock icon. An artwork change requires a new signed and notarized app for distribution.

## Final edit prompt

Mode: built-in Imagegen, transparent background. Edit target: the generated neutral folded-ribbon N icon.

Use case: precise-object-edit. Asset: production macOS app icon and website brand mark. Keep the exact recognizable folded-ribbon N shape, composition, rounded-square silhouette, central positioning, and transparent surrounding margin. Change only the neutral tonal treatment to greatly increase contrast: make the front faces of the N deep charcoal near #25282D, the inner folds near black #101215, with restrained silver edge highlights that describe its sculpted curves; keep most of the N very dark so the entire N reads clearly at 24 pixels. Make the tile a clean flat porcelain-white #F4F4F3 with a precise thin medium-gray perimeter. Neutral grayscale only, no colors. The N must contrast strongly against the pale tile at every fold. Output one pristine 1024x1024 PNG icon with transparent outside corners and surrounding margin, no shadow outside the tile, no flecks, no text, no mockup. Preserve the rounded-square framing and generous 10 percent transparent outer margin.
