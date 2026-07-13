#!/usr/bin/env bash
set -euo pipefail

xcframework_input="${1:-Iroh.xcframework}"
ios_max_minos="${IROH_IOS_MAX_MINOS:-18.0}"
macos_max_minos="${IROH_MACOS_MAX_MINOS:-14.5}"
library_name="libiroh_ffi.a"

case "$xcframework_input" in
  /*) xcframework_path="$xcframework_input" ;;
  *) xcframework_path="$PWD/$xcframework_input" ;;
esac

if [[ ! -d "$xcframework_path" ]]; then
  echo "error: xcframework not found: $xcframework_path" >&2
  exit 2
fi
if [[ ! -f "$xcframework_path/Info.plist" ]]; then
  echo "error: missing xcframework Info.plist: $xcframework_path" >&2
  exit 1
fi
plutil -lint "$xcframework_path/Info.plist" >/dev/null

embedded_framework="$(find "$xcframework_path" -type d -name '*.framework' -print -quit)"
if [[ -n "$embedded_framework" ]]; then
  echo "error: flat static-library xcframework contains a framework bundle: $embedded_framework" >&2
  exit 1
fi

library_count="$(plutil -extract AvailableLibraries raw -expect array -o - "$xcframework_path/Info.plist")"
if [[ "$library_count" != "3" ]]; then
  echo "error: expected exactly 3 xcframework libraries, found $library_count" >&2
  exit 1
fi

version_gt() {
  awk -v a="$1" -v b="$2" 'BEGIN {
    split(a, av, "."); split(b, bv, ".");
    for (i = 1; i <= 4; i++) {
      ai = (av[i] == "" ? 0 : av[i] + 0);
      bi = (bv[i] == "" ? 0 : bv[i] + 0);
      if (ai > bi) exit 0;
      if (ai < bi) exit 1;
    }
    exit 1;
  }'
}

work_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$work_dir"
}
trap cleanup EXIT

scan_archive() {
  local archive="$1"
  local label="$2"
  local expected_platform="$3"
  local max_minos="$4"
  local out_dir="$work_dir/objects/${label//[^A-Za-z0-9_.-]/_}"
  local saw_version_command=0
  local saw_max_minos=0
  local obj
  local records
  local record_kind
  local platform
  local minos
  local reported_platform

  mkdir -p "$out_dir"
  (cd "$out_dir" && ar -x "$archive")

  while IFS= read -r -d '' obj; do
    if ! otool -l "$obj" >/dev/null 2>&1; then
      continue
    fi

    records="$(otool -l "$obj" | awk '
      $1 == "cmd" && $2 == "LC_BUILD_VERSION" {
        kind="build"; platform=""; minos=""; next
      }
      kind == "build" && $1 == "platform" { platform=$2 }
      kind == "build" && $1 == "minos" { minos=$2 }
      kind == "build" && $1 == "sdk" {
        if (platform != "" && minos != "") print kind, platform, minos
        kind=""; next
      }
      $1 == "cmd" && $2 ~ /^LC_VERSION_MIN_/ {
        kind=$2; version=""; next
      }
      kind ~ /^LC_VERSION_MIN_/ && $1 == "version" { version=$2 }
      kind ~ /^LC_VERSION_MIN_/ && $1 == "sdk" {
        if (version != "") print kind, "-", version
        kind=""; next
      }
    ')"
    # Rust's compiler_builtins archive members can be valid Mach-O objects
    # without a minimum-version load command. The linker assigns their
    # effective platform from the surrounding archive, so validate every
    # modern or legacy command that is present and require the slice as a
    # whole to contain target metadata.
    if [[ -z "$records" ]]; then
      continue
    fi

    while read -r record_kind platform minos; do
      saw_version_command=1
      case "$record_kind" in
        build)
          if [[ "$platform" != "$expected_platform" ]]; then
            echo "error: $label object $(basename "$obj") has platform=$platform, expected=$expected_platform" >&2
            exit 1
          fi
          reported_platform="$platform"
          ;;
        LC_VERSION_MIN_IPHONEOS)
          if [[ "$expected_platform" != "2" && "$expected_platform" != "7" ]]; then
            echo "error: $label object $(basename "$obj") has legacy iOS metadata for platform=$expected_platform" >&2
            exit 1
          fi
          reported_platform="legacy-ios"
          ;;
        LC_VERSION_MIN_MACOSX)
          if [[ "$expected_platform" != "1" ]]; then
            echo "error: $label object $(basename "$obj") has legacy macOS metadata for platform=$expected_platform" >&2
            exit 1
          fi
          reported_platform="legacy-macos"
          ;;
        *)
          echo "error: $label object $(basename "$obj") has unsupported deployment metadata $record_kind" >&2
          exit 1
          ;;
      esac
      if version_gt "$minos" "$max_minos"; then
        echo "error: $label object $(basename "$obj") has minos=$minos above supported maximum $max_minos" >&2
        exit 1
      fi
      if [[ "$minos" == "$max_minos" ]]; then
        saw_max_minos=1
      fi
      printf '%s platform=%s minos=%s object=%s\n' \
        "$label" "$reported_platform" "$minos" "$(basename "$obj")" >> "$work_dir/build-versions.txt"
    done <<< "$records"
  done < <(find "$out_dir" -type f -print0)

  if [[ "$saw_version_command" != "1" ]]; then
    echo "error: no deployment-version load commands found in $label" >&2
    exit 1
  fi
  if [[ "$saw_max_minos" != "1" ]]; then
    echo "error: $label never reaches the declared deployment target $max_minos" >&2
    exit 1
  fi
}

verify_slice() {
  local identifier="$1"
  local expected_platform_name="$2"
  local expected_variant="$3"
  local expected_arches="$4"
  local expected_platform_number="$5"
  local max_minos="$6"
  local slice_path="$xcframework_path/$identifier"
  local archive="$slice_path/$library_name"
  local index=""
  local candidate
  local actual_path
  local actual_platform
  local actual_variant
  local actual_arches
  local arch
  local thin_archive

  for ((candidate = 0; candidate < library_count; candidate++)); do
    if [[ "$(plutil -extract "AvailableLibraries.${candidate}.LibraryIdentifier" raw -expect string -o - "$xcframework_path/Info.plist")" == "$identifier" ]]; then
      index="$candidate"
      break
    fi
  done
  if [[ -z "$index" ]]; then
    echo "error: xcframework metadata is missing slice $identifier" >&2
    exit 1
  fi

  actual_path="$(plutil -extract "AvailableLibraries.${index}.LibraryPath" raw -expect string -o - "$xcframework_path/Info.plist")"
  actual_platform="$(plutil -extract "AvailableLibraries.${index}.SupportedPlatform" raw -expect string -o - "$xcframework_path/Info.plist")"
  actual_variant="$(plutil -extract "AvailableLibraries.${index}.SupportedPlatformVariant" raw -expect string -o - "$xcframework_path/Info.plist" 2>/dev/null || true)"
  if [[ "$actual_path" != "$library_name" ]]; then
    echo "error: $identifier LibraryPath is '$actual_path', expected '$library_name'" >&2
    exit 1
  fi
  if [[ "$actual_platform" != "$expected_platform_name" || "$actual_variant" != "$expected_variant" ]]; then
    echo "error: $identifier platform metadata is platform='$actual_platform' variant='$actual_variant'" >&2
    exit 1
  fi

  for required in \
    "$archive" \
    "$slice_path/Headers/iroh_ffiFFI.h" \
    "$slice_path/Headers/Export.h" \
    "$slice_path/Headers/module.modulemap"; do
    if [[ ! -f "$required" ]]; then
      echo "error: $identifier is missing ${required#"$slice_path"/}" >&2
      exit 1
    fi
  done

  actual_arches="$(lipo -archs "$archive" | tr ' ' '\n' | sort | paste -sd ' ' -)"
  expected_arches="$(tr ' ' '\n' <<< "$expected_arches" | sort | paste -sd ' ' -)"
  if [[ "$actual_arches" != "$expected_arches" ]]; then
    echo "error: $identifier architectures are '$actual_arches', expected '$expected_arches'" >&2
    exit 1
  fi

  for arch in $actual_arches; do
    if [[ "$actual_arches" == *" "* ]]; then
      thin_archive="$work_dir/${identifier}_${arch}.a"
      lipo -thin "$arch" "$archive" -output "$thin_archive"
      scan_archive "$thin_archive" "${identifier}_${arch}" "$expected_platform_number" "$max_minos"
    else
      scan_archive "$archive" "${identifier}_${arch}" "$expected_platform_number" "$max_minos"
    fi
  done
}

: > "$work_dir/build-versions.txt"
verify_slice "ios-arm64" "ios" "" "arm64" "2" "$ios_max_minos"
verify_slice "ios-arm64_x86_64-simulator" "ios" "simulator" "arm64 x86_64" "7" "$ios_max_minos"
verify_slice "macos-arm64" "macos" "" "arm64" "1" "$macos_max_minos"

echo "Iroh flat XCFramework verified: $xcframework_path"
echo "  iOS/device + simulator maximum minos: $ios_max_minos"
echo "  macOS maximum minos: $macos_max_minos"
echo "  build versions seen:"
awk '{ print "    " $1 " " $2 " " $3 }' "$work_dir/build-versions.txt" | sort -u
