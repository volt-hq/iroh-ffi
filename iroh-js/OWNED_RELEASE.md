# Volt-owned npm release

This fork publishes only the Node.js/N-API distribution under Volt-controlled
npm names. It preserves the upstream JavaScript API, native binary name
(`iroh`), Rust crate/module names, repository history, attribution, and the
MIT/Apache-2.0 license choice.

## Initial owned version and lineage

The exact initial version is `1.1.1-volt.1`, derived from upstream `1.1.0`.

- Upstream `v1.1.0` release commit: `5e451092dba0c1a09ee83ff6e5be37b1152a5c58`
- Upstream base immediately below the Volt-only relay patch:
  `3103bf5295be6d50c5272ff7a426e9b539f3f587`
- Carried sync-watch reactor fix:
  `cf04296878593ad66f2462256f075cc7f37f9ba7`
- Volt connected-home-relay filter:
  `2090823126686e2aeb2caa463b22cea3aadbf13f`

The reactor fix keeps synchronous `watch*` registration on N-API's Tokio
runtime so registration cannot panic on a foreign caller thread. The Volt
relay patch exposes URLs only for statuses where `is_connected()` is true.

## Published package set

The root package is `@hansjm10/volt-iroh`. Its exact-version optional native
packages are:

- `@hansjm10/volt-iroh-darwin-arm64`
- `@hansjm10/volt-iroh-android-arm64`
- `@hansjm10/volt-iroh-android-arm-eabi`
- `@hansjm10/volt-iroh-linux-x64-gnu`
- `@hansjm10/volt-iroh-linux-x64-musl`
- `@hansjm10/volt-iroh-linux-arm64-gnu`
- `@hansjm10/volt-iroh-linux-arm64-musl`
- `@hansjm10/volt-iroh-linux-arm-gnueabihf`
- `@hansjm10/volt-iroh-linux-arm-musleabihf`
- `@hansjm10/volt-iroh-win32-x64-msvc`
- `@hansjm10/volt-iroh-win32-arm64-msvc`

`napi pre-publish` writes the root package's exact `optionalDependencies` and
publishes the native packages before npm publishes the root package. Source
`package.json` intentionally omits those unpublished dependencies so branch CI
can install before a version exists in the registry.

## Prepare and release a version

From the repository root:

```sh
cargo make prepare-owned-npm-release 1.1.1-volt.1
cargo make test-js
```

The preparation task changes only the owned JS/N-API version, updates the JS
lockfile/generated loader, validates all platform metadata, and builds the host
addon. Commit and push the result to `volt/owned-iroh`.

A branch push or manual dispatch builds/tests but cannot publish. Publication is
isolated to an exact `npm-v<VERSION>` tag, which intentionally does not match
the fork's cross-language `v*` release workflows:

```sh
git tag -a npm-v1.1.1-volt.1 -m "npm: @hansjm10/volt-iroh@1.1.1-volt.1"
git push origin npm-v1.1.1-volt.1
```

Do not create a `v*` tag for an owned npm release. The publish job runs on a
GitHub-hosted runner, verifies all 11 native artifacts and package manifests,
stages both license texts, checks that the tag exactly matches `package.json`,
and then uses npm trusted publishing (OIDC) with provenance. No npm token or
GitHub secret is required.

## One-time publisher bootstrap

npm requires a package to exist before trusted publishing can be configured.
Jordan must perform this once while logged in to the `hansjm10` npm account
with account-level 2FA. The placeholder version reserves each name under the
non-default `bootstrap` tag; it is not a usable Iroh release.

```sh
cd /Volumes/External/Projects/volt-workspace/iroh-ffi
npm install --global 'npm@^11.15.0'
npm login

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

bootstrap=$(mktemp -d)
for package in "${packages[@]}"; do
  if npm view "$package" name >/dev/null 2>&1; then
    echo "already exists: $package"
    continue
  fi
  dir="$bootstrap/${package##*/}"
  mkdir -p "$dir"
  cp LICENSE-APACHE LICENSE-MIT "$dir/"
  PKG="$package" node - "$dir/package.json" <<'NODE'
const fs = require('node:fs')
const path = process.argv[2]
fs.writeFileSync(path, JSON.stringify({
  name: process.env.PKG,
  version: '0.0.0-bootstrap.0',
  description: 'Reserved for the Volt-owned Iroh N-API distribution',
  repository: {
    type: 'git',
    url: 'https://github.com/volt-hq/iroh-ffi.git',
  },
  license: 'MIT OR Apache-2.0',
  publishConfig: { access: 'public' },
}, null, 2) + '\n')
NODE
  printf '# `%s`\n\nReserved for Volt-owned Iroh releases.\n' "$package" > "$dir/README.md"
  (cd "$dir" && npm publish --access public --tag bootstrap)
done
rm -rf "$bootstrap"
```

Then configure this exact trusted publisher for all 12 packages. `npm trust`
requires npm 11.15+, package write access, and an interactive account session
with 2FA:

```sh
for package in "${packages[@]}"; do
  npm trust github "$package" \
    --repo volt-hq/iroh-ffi \
    --file ci_js.yml \
    --allow-publish \
    --yes
  sleep 2
done
```

On npmjs.com, open each package's **Settings → Publishing access**, select
**Require two-factor authentication and disallow tokens**, and save. No GitHub
environment name is configured. In GitHub, confirm Actions are enabled for
`volt-hq/iroh-ffi`, GitHub-hosted `ubuntu-latest` jobs are allowed, and the
existing self-hosted macOS ARM64/Linux X64 runners are available for the build
matrix. Do not add `NPM_TOKEN` or any npm secret; `ci_js.yml` grants
`id-token: write` only to the tag-gated publish job.

After publication, verify the immutable release before consumption:

```sh
npm view @hansjm10/volt-iroh@1.1.1-volt.1 --json \
  name version dist-tags optionalDependencies repository
npm view @hansjm10/volt-iroh-darwin-arm64@1.1.1-volt.1 --json \
  name version os cpu repository
```
