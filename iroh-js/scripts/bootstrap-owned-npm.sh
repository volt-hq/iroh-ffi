#!/usr/bin/env bash
set -euo pipefail

readonly NPM_VERSION=11.17.0
readonly BOOTSTRAP_VERSION=0.0.0-bootstrap.0
readonly EXPECTED_USER=hansjm10
readonly REPOSITORY=https://github.com/volt-hq/iroh-ffi.git
readonly RELEASE_ENVIRONMENT=npm-release
readonly WORKFLOW_FILE=ci_js.yml

if [[ ${CI:-} == true ]]; then
  echo "ERROR: publisher bootstrap is an interactive, one-time owner operation" >&2
  exit 1
fi
if [[ $(npm --version) != "$NPM_VERSION" ]]; then
  echo "ERROR: npm $NPM_VERSION is required exactly" >&2
  exit 1
fi
if [[ $(npm whoami) != "$EXPECTED_USER" ]]; then
  echo "ERROR: npm session must belong to $EXPECTED_USER" >&2
  exit 1
fi

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
work=$(mktemp -d)
logged_in=1
cleanup() {
  local status=$?
  rm -rf "$work"
  if (( logged_in )); then
    if ! npm logout; then
      echo "ERROR: npm logout failed; revoke the bootstrap session manually" >&2
      status=1
    fi
  fi
  trap - EXIT
  exit "$status"
}
trap cleanup EXIT

packages=(
  @hansjm10/volt-iroh
  @hansjm10/volt-iroh-darwin-arm64
  @hansjm10/volt-iroh-android-arm64
  @hansjm10/volt-iroh-android-arm-eabi
  @hansjm10/volt-iroh-linux-x64-gnu
  @hansjm10/volt-iroh-linux-x64-musl
  @hansjm10/volt-iroh-linux-arm64-gnu
  @hansjm10/volt-iroh-linux-arm64-musl
  @hansjm10/volt-iroh-linux-arm-gnueabihf
  @hansjm10/volt-iroh-linux-arm-musleabihf
  @hansjm10/volt-iroh-win32-x64-msvc
  @hansjm10/volt-iroh-win32-arm64-msvc
)

package_exists() {
  local package=$1
  local error_file=$2
  if npm view "$package" name --json > /dev/null 2>"$error_file"; then
    return 0
  fi
  if grep -Eq 'E404|404 Not Found' "$error_file"; then
    return 1
  fi
  cat "$error_file" >&2
  echo "ERROR: registry lookup failed for $package; refusing to treat it as absent" >&2
  exit 1
}

verify_registry_metadata() {
  local package=$1
  PACKAGE="$package" BOOTSTRAP_VERSION="$BOOTSTRAP_VERSION" REPOSITORY="$REPOSITORY" node <<'NODE'
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const view = (...fields) => JSON.parse(execFileSync('npm', ['view', process.env.PACKAGE, ...fields, '--json'], { encoding: 'utf8' }))
const normalizeArray = (value) => Array.isArray(value) ? value : [value]
assert.equal(view('name'), process.env.PACKAGE)
assert.deepEqual(normalizeArray(view('versions')), [process.env.BOOTSTRAP_VERSION])
assert.deepEqual(view('dist-tags'), { bootstrap: process.env.BOOTSTRAP_VERSION })
assert.equal(view('repository.url'), process.env.REPOSITORY)
assert.equal(view('license'), 'MIT OR Apache-2.0')
const maintainers = normalizeArray(view('maintainers')).map((entry) => typeof entry === 'string' ? entry.split(' ')[0] : entry.name)
assert.deepEqual(maintainers, ['hansjm10'])
NODE

  local owners
  owners=$(npm owner ls "$package" | sed -E 's/[[:space:]]*<.*$//' | sed '/^[[:space:]]*$/d')
  [[ "$owners" == "$EXPECTED_USER" ]] || {
    echo "ERROR: unexpected owners for $package: $owners" >&2
    exit 1
  }
}

verify_published_content() {
  local package=$1
  local audit="$work/audit-${package##*/}"
  mkdir -p "$audit"
  local pack_json filename unpack
  pack_json=$(npm pack "$package@$BOOTSTRAP_VERSION" --ignore-scripts --json --pack-destination "$audit")
  filename=$(node -e 'const p=JSON.parse(process.argv[1]); if(p.length!==1) process.exit(1); process.stdout.write(p[0].filename)' "$pack_json")
  unpack="$audit/unpack"
  mkdir "$unpack"
  tar -xzf "$audit/$filename" -C "$unpack"
  PACKAGE="$package" BOOTSTRAP_VERSION="$BOOTSTRAP_VERSION" REPOSITORY="$REPOSITORY" \
    node - "$unpack/package/package.json" <<'NODE'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const packageJson = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
assert.deepEqual(packageJson, {
  name: process.env.PACKAGE,
  version: process.env.BOOTSTRAP_VERSION,
  description: 'Reserved for the Volt-owned Iroh N-API distribution',
  repository: { type: 'git', url: process.env.REPOSITORY },
  license: 'MIT OR Apache-2.0',
  publishConfig: { access: 'public' },
})
NODE
  cmp "$repo_root/LICENSE-APACHE" "$unpack/package/LICENSE-APACHE"
  cmp "$repo_root/LICENSE-MIT" "$unpack/package/LICENSE-MIT"
  grep -Fqx "# \`$package\`" "$unpack/package/README.md"
  local files
  files=$(cd "$unpack/package" && find . -type f -print | LC_ALL=C sort)
  [[ "$files" == $'./LICENSE-APACHE\n./LICENSE-MIT\n./README.md\n./package.json' ]] || {
    echo "ERROR: unexpected bootstrap tarball content for $package:" >&2
    printf '%s\n' "$files" >&2
    exit 1
  }
}

verify_trust() {
  local package=$1
  local trust_json="$work/trust-${package##*/}.json"
  npm trust list "$package" --json > "$trust_json"
  PACKAGE="$package" RELEASE_ENVIRONMENT="$RELEASE_ENVIRONMENT" WORKFLOW_FILE="$WORKFLOW_FILE" \
    node - "$trust_json" <<'NODE'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const text = JSON.stringify(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')))
for (const expected of [process.env.PACKAGE, 'volt-hq/iroh-ffi', process.env.WORKFLOW_FILE, process.env.RELEASE_ENVIRONMENT]) {
  assert.ok(text.includes(expected), `trusted publisher is missing ${expected}`)
}
assert.match(text, /publish/i)
NODE
}

for package in "${packages[@]}"; do
  error_file="$work/view-${package##*/}.err"
  if package_exists "$package" "$error_file"; then
    echo "verifying expected existing bootstrap package: $package"
    verify_registry_metadata "$package"
    verify_published_content "$package"
  else
    dir="$work/package-${package##*/}"
    mkdir -p "$dir"
    cp "$repo_root/LICENSE-APACHE" "$repo_root/LICENSE-MIT" "$dir/"
    PKG="$package" BOOTSTRAP_VERSION="$BOOTSTRAP_VERSION" REPOSITORY="$REPOSITORY" \
      node - "$dir/package.json" <<'NODE'
const fs = require('node:fs')
fs.writeFileSync(process.argv[2], `${JSON.stringify({
  name: process.env.PKG,
  version: process.env.BOOTSTRAP_VERSION,
  description: 'Reserved for the Volt-owned Iroh N-API distribution',
  repository: { type: 'git', url: process.env.REPOSITORY },
  license: 'MIT OR Apache-2.0',
  publishConfig: { access: 'public' },
}, null, 2)}\n`)
NODE
    printf '# `%s`\n\nReserved for Volt-owned Iroh releases.\n' "$package" > "$dir/README.md"
    npm publish "$dir" --ignore-scripts --access public --tag bootstrap
    verify_registry_metadata "$package"
    verify_published_content "$package"
  fi

  npm trust github "$package" \
    --repo volt-hq/iroh-ffi \
    --file "$WORKFLOW_FILE" \
    --env "$RELEASE_ENVIRONMENT" \
    --allow-publish \
    --yes
  verify_trust "$package"

  # npm's mfa=publish package setting is the CLI form of requiring interactive
  # 2FA and disallowing traditional token publication. OIDC trusted publishing
  # remains permitted. Confirm the matching UI setting after this script.
  npm access set mfa=publish "$package"
done

echo "Bootstrap completed. Verify all 12 package settings show 'Require two-factor authentication and disallow tokens'."
# The EXIT trap removes staging and runs `npm logout`, which revokes the
# bootstrap session's registry credential. A logout failure makes this script fail.
