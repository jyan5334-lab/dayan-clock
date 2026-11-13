# Wallpaper Video Fixture

`wallpaper-cover.webm` is an artificial 64x64 VP8 test clip with four solid-color
frames at 10 fps. It contains no user media and is not bundled in the app.
The background regression copies it into isolated test data on D: and checks
video loading and per-display cover alongside the production image/HTML catalog.

Generated with FFmpeg:

```text
ffmpeg -f lavfi -i color=c=0x399f89:s=64x64:r=10:d=0.4 -c:v libvpx -b:v 50k -an wallpaper-cover.webm
```
