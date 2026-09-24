#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="${0:A:h}"
PROJECT_DIR="${SCRIPT_DIR:h}"
SOURCE_SVG="$PROJECT_DIR/chrome-extension/icons/icon.svg"
OUTPUT_ICON="$PROJECT_DIR/Resources/AppIcon.icns"
STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/anyannotate-icon.XXXXXX")"
ICONSET_DIR="$STAGING_DIR/AppIcon.iconset"
SOURCE_PNG="$STAGING_DIR/icon.svg.png"

cleanup() {
    rm -rf "$STAGING_DIR"
}
trap cleanup EXIT

mkdir -p "$ICONSET_DIR"
/usr/bin/qlmanage -t -s 1024 -o "$STAGING_DIR" "$SOURCE_SVG" >/dev/null

make_icon() {
    local size="$1"
    local name="$2"
    sips -z "$size" "$size" "$SOURCE_PNG" --out "$ICONSET_DIR/$name" >/dev/null
}

make_icon 16 icon_16x16.png
make_icon 32 icon_16x16@2x.png
make_icon 32 icon_32x32.png
make_icon 64 icon_32x32@2x.png
make_icon 128 icon_128x128.png
make_icon 256 icon_128x128@2x.png
make_icon 256 icon_256x256.png
make_icon 512 icon_256x256@2x.png
make_icon 512 icon_512x512.png
make_icon 1024 icon_512x512@2x.png

iconutil -c icns "$ICONSET_DIR" -o "$OUTPUT_ICON"
echo "Created $OUTPUT_ICON"
