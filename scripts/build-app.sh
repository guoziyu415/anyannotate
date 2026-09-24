#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
PROJECT_DIR="${SCRIPT_DIR:h}"
APP_DIR="$PROJECT_DIR/build/AnyAnnotate.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"
CLANG_CACHE_DIR="$PROJECT_DIR/.build/clang-module-cache"
SWIFTPM_CACHE_DIR="$PROJECT_DIR/.build/swiftpm-module-cache"
SIGN_IDENTITY="${CODE_SIGN_IDENTITY:--}"
BUILD_UNIVERSAL="${BUILD_UNIVERSAL:-1}"

ARCH_ARGS=()
ACTIVE_DEVELOPER_DIR="${DEVELOPER_DIR:-$(xcode-select -p 2>/dev/null || true)}"
if [[ "$BUILD_UNIVERSAL" == "1" ]]; then
    if [[ "$ACTIVE_DEVELOPER_DIR" != *".app/Contents/Developer"* ]] && \
       [[ -d "/Applications/Xcode.app/Contents/Developer" ]]; then
        ACTIVE_DEVELOPER_DIR="/Applications/Xcode.app/Contents/Developer"
    fi
    if [[ "$ACTIVE_DEVELOPER_DIR" == *".app/Contents/Developer"* ]]; then
        ARCH_ARGS=(--arch arm64 --arch x86_64)
    else
        echo "Full Xcode is not active; building for the current architecture only." >&2
    fi
fi

cd "$PROJECT_DIR"
mkdir -p "$CLANG_CACHE_DIR" "$SWIFTPM_CACHE_DIR"
env \
    DEVELOPER_DIR="$ACTIVE_DEVELOPER_DIR" \
    CLANG_MODULE_CACHE_PATH="$CLANG_CACHE_DIR" \
    SWIFTPM_MODULECACHE_OVERRIDE="$SWIFTPM_CACHE_DIR" \
    swift build --disable-sandbox -c release "${ARCH_ARGS[@]}"

BIN_DIR="$(env \
    DEVELOPER_DIR="$ACTIVE_DEVELOPER_DIR" \
    CLANG_MODULE_CACHE_PATH="$CLANG_CACHE_DIR" \
    SWIFTPM_MODULECACHE_OVERRIDE="$SWIFTPM_CACHE_DIR" \
    swift build --disable-sandbox -c release "${ARCH_ARGS[@]}" --show-bin-path)"

rm -rf "$APP_DIR"
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR"
cp "$BIN_DIR/AnyAnnotate" "$MACOS_DIR/AnyAnnotate"
cp "$PROJECT_DIR/Resources/Info.plist" "$CONTENTS_DIR/Info.plist"
cp "$PROJECT_DIR/Resources/AppIcon.icns" "$RESOURCES_DIR/AppIcon.icns"

xattr -cr "$APP_DIR"
codesign --force --deep --sign "$SIGN_IDENTITY" "$APP_DIR"
xattr -cr "$APP_DIR"
codesign --verify --deep --strict --verbose=2 "$APP_DIR"

if [[ "$SIGN_IDENTITY" == "-" ]]; then
    echo "Created an ad-hoc signed development build. Use a Developer ID identity for public distribution." >&2
fi

echo "$APP_DIR"
