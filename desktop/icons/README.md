# Nextstep macOS icon

`nextstep.png` is the transparent 1024 × 1024 master. `nextstep.icns` contains the standard and Retina representations from 16 to 1024 pixels. Both files are used under this repository's MIT license.

The artwork was generated with the built-in imagegen tool. The selected square output was resized to 1024 pixels using macOS `sips`, preserving transparency. Its indigo tile and three raised cards develop the existing indigo and stacked-layer identity.

On macOS, rebuild the ICNS from the PNG with:

```sh
pnpm desktop:icon
```

The packaging script embeds the ICNS before code signing. A change to the artwork requires a new signed and notarized app build.

## Generation prompt

Use case: logo-brand.
Asset type: production macOS application icon for Nextstep, a local job-search Kanban CRM.
Primary request: Create one polished, distinctive Mac Dock icon, ready to convert to .icns. The existing brand uses indigo #4a57d7 and a white three-layer stack symbol. Evolve that into three simple, substantial ivory-white cards or layers stepping upward and forward, with a subtle sense of momentum and progress. Keep the mark exceptionally clear and balanced at 32 pixels. Use a simple centered sculpted stack, not a chart or a literal screenshot.
Scene/backdrop: A single indigo rounded-square macOS app tile with continuous smooth corners, occupying approximately the central 82 percent of a square canvas. The area outside the tile must be genuinely transparent alpha, including all four corners. A very restrained soft shadow is okay. No background surface, backdrop, cast floor, or checkerboard.
Style/medium: Refined contemporary native Mac icon, vector-clean edges with restrained dimensional depth. A subtly luminous indigo surface, white/ivory raised stacked cards, soft controlled highlights and minimal shadows. Quiet, focused, useful, premium productivity app aesthetic.
Composition: one icon only, centered straight-on, symmetrical outer tile, generous consistent transparent margin around it. The cards form a concise coherent abstract mark. No mockup sheet, no app window, no frame, no scene, no devices. Square output at high resolution suitable for a 1024x1024 master.
Constraints: no text, no letters, no numbers, no watermark, no briefcase, no robot, no sparkle, no checkmark, no glossy glass clutter. Preserve the existing indigo and white identity. Actual transparent background required.
