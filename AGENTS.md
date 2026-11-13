# Background compatibility

Before adding or changing any static image, video or HTML wallpaper, read
`docs/wallpapers.md` and follow its background integration requirements.

- Every wallpaper must fill each display independently in both single-display
  and multi-display fullscreen, including mixed resolutions, scaling and portrait
  displays. Preserve complete subjects and composition without cropping or
  stretching. For code-based scenes, contain the original artwork and extend
  sky, landscape and ground into the extra viewport area; do not use cover to
  hide missing scenery. Do not introduce bars.
- A full-size iframe is insufficient if its internal scene still letterboxes.
  Adapt that scene too, without changing user-supplied original animation files.
- Keep clock, calendar and almanac content on the system primary display.
- Verify rendered coverage, animation and monitor coordinates with
  `npm run check` and `npm run test:dynamic-backgrounds`. Distinguish simulated
  layout checks from physical monitor validation.
