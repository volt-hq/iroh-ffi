# Volt-owned npm release

This fork publishes only the Node.js/N-API distribution under Volt-controlled
npm names. It preserves the upstream JavaScript API, native binary name
(`iroh`), Rust crate/module names, repository history, attribution, and the
MIT/Apache-2.0 dual-license choice.

## Initial owned version and lineage

The exact initial version is `1.1.1-volt.1`, derived from upstream `1.1.0`.

- Upstream `v1.1.0` release commit: `5e451092dba0c1a09ee83ff6e5be37b1152a5c58`
- Upstream base immediately below the Volt-only relay patch:
  `3103bf5295be6d50c5272ff7a426e9b539f3f587`
- Carried sync-watch reactor fix:
  `cf04296878593ad66f2462256f075cc7f37f9ba7`
- Volt connected-home-relay filter:
  `2090823126686e2aeb2caa463b22cea3aadbf13f`
- Volt Iroh-core authenticated relay reconnect:
  `5cd4d861c0546538e3912a1847c5c264873c2bcb`

The reactor fix keeps synchronous `watch*` registration on N-API's Tokio
runtime so registration cannot panic on a foreign caller thread. The Volt
relay patch exposes URLs only for statuses where `is_connected()` is true.
`bindingCapabilities()` is the release contract for those behaviors; consumers
must not infer watcher or reconnect safety from an upstream package version.

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

Source `package.json` intentionally omits unpublished optional dependencies so
branch CI can install before a version exists in the registry. In release CI,
`napi pre-publish --skip-optional-publish` stages exact optional dependencies
and platform metadata without publishing. Verification then packs all 12
packages with lifecycle scripts disabled. npm receives exactly those immutable,
hash-verified tarballs, platform packages first and the root package last.
Every `npm publish` uses OIDC provenance.

## Required GitHub controls (not encoded by this repository)

Keep `.github/workflows/ci_js.yml` disabled until all controls below exist.
The workflow itself has no PR/manual trigger and authorizes the ref on a
GitHub-hosted runner before repository code reaches a self-hosted runner.

1. Protect `volt/owned-iroh`: restrict direct pushes to designated release
   maintainers, require signed commits, block force-pushes and deletion, and do
   not permit administrators to bypass the rule for releases.
2. Add a tag ruleset for `npm-v*`: restrict creation to designated release
   maintainers and block updates and deletion. Do not allow ruleset bypass.
3. Create environment `npm-release` with no required reviewer and restrict
   deployments to protected tags matching only `npm-v*` from this repository.
   Volt currently has one organization maintainer, so independent environment
   review is unavailable by explicit owner decision. The signed annotated tag,
   protected exact-head requirement, and trusted-publisher checks are the
   release authorization; do not weaken or bypass those remaining controls.
4. Do not add repository/environment `NPM_TOKEN`, `NODE_AUTH_TOKEN`, or other
   npm credentials. The publish job alone has `id-token: write`.
5. Keep the existing self-hosted macOS ARM64 and Linux X64 runners restricted
   to this private trusted workflow/repository. GitHub-hosted Windows and Ubuntu
   jobs must also be allowed.

The exact release-ref policy is fail-closed:

- the event must be a push in `volt-hq/iroh-ffi`;
- a branch run must be the current `origin/volt/owned-iroh` head;
- a release ref must be an annotated `npm-v<package-version>` tag;
- the tag must point to exactly the current protected branch head; and
- GitHub's Git tag API must report the annotated tag signature as `verified`
  with reason `valid` and a direct commit target.

Use `git tag -s -a`; configure Git for a GitHub-verified GPG, SSH, or S/MIME
signing identity before tagging. Lightweight, unsigned, stale, side-branch, and
unverified signed tags are rejected before the build matrix.

`release-targets.json` is the trusted 11-target matrix. It pins Node, Rust,
Yarn, Zig/Python, NDK, actions, and test-container digests. Inputs that cannot
be made repository-immutable are explicitly recorded there: protected
self-hosted runner images, Xcode/Apple SDKs, GitHub-hosted runner images, and
Linux distribution cross-compiler packages. Each native artifact manifest
records the runner/tool versions and resolved distribution package versions.
Publication fails unless every downloaded manifest matches that trusted matrix.

## One-time npm publisher bootstrap

Complete the GitHub branch/tag/environment controls first. npm bootstrap is
then an interactive owner operation from a clean checkout. It requires account
2FA and exactly npm `11.17.0`; never use a version range.

```bash
set -euo pipefail
cd /Volumes/External/Projects/volt-workspace/iroh-ffi
npm install --global npm@11.17.0
test "$(npm --version)" = 11.17.0
npm login
./iroh-js/scripts/bootstrap-owned-npm.sh
```

The script batches publication, registry verification, trust discovery, trust
creation, trust verification, and MFA enforcement into separate phases. At the
first web-auth prompt in each protected phase, select npm's option to skip
repeated 2FA for the next five minutes; npm documents this specifically for
bulk trusted-publisher configuration. This normally requires one login and no
more than one browser approval per protected phase, rather than approvals per
package. Every package is still verified independently, and npm will reopen
interactive web auth when a short authorization window expires.

The script fails on registry/network ambiguity and on any unexpected existing
package. For each package it creates or verifies only
`0.0.0-bootstrap.0` under only the `bootstrap` dist-tag, then verifies exact
owner/maintainer, repository, license, and downloaded tarball content. It binds
the trusted publisher to all of:

- repository `volt-hq/iroh-ffi`;
- workflow `ci_js.yml`;
- environment `npm-release`; and
- publish permission.

It verifies `npm trust list`, applies `npm access set mfa=publish`, removes all
staging, and logs out. npm logout revokes the bootstrap session credential; a
logout failure makes the script fail. The script never stores a token in the
repository.

After it succeeds, inspect all 12 package settings on npmjs.com and confirm:

- owner and sole maintainer are the expected `hansjm10` account;
- only the bootstrap version/content exist before the first real release, with
  npm's automatic `bootstrap` and `latest` tags both pointing to it;
- the trusted publisher shows the exact repository/workflow/environment above;
- publishing access says **Require two-factor authentication and disallow
  tokens**; and
- `npm trust list <package>` shows no additional publisher.

Any discrepancy is a stop condition. Revoke the bootstrap session manually if
logout reported failure.

## Prepare and validate a release

From the repository root:

```bash
cargo make prepare-owned-npm-release 1.1.1-volt.1
cargo make test-js
```

The preparation task changes only the owned JS/N-API version, updates the JS
lockfile/generated loader, enforces fatal native-package version checks,
validates platform metadata, and builds the host addon. Commit and push the
result directly to the protected `volt/owned-iroh` branch under the branch
policy above.

After GitHub/npm controls and bootstrap are verified, enable only
`ci_js.yml`. It has no manual-dispatch path. The next trusted direct branch push
must complete the entire non-publishing matrix successfully before tagging.
Do not treat local tests as cross-platform CI.

## Tag and publish

Create an annotated signed tag at the exact protected branch head:

```bash
set -euo pipefail
git fetch origin volt/owned-iroh
branch_head=$(git rev-parse origin/volt/owned-iroh)
test "$(git rev-parse HEAD)" = "$branch_head"
git tag -s -a npm-v1.1.1-volt.1 "$branch_head" \
  -m "npm: @hansjm10/volt-iroh@1.1.1-volt.1"
git verify-tag npm-v1.1.1-volt.1
git push origin refs/tags/npm-v1.1.1-volt.1
```

Do not create a `v*` tag for an owned npm release. The `npm-release`
environment admits only the protected `npm-v*` tag pattern; the GitHub-verified
signature and exact protected-branch head authorize the sole-maintainer
release. The job verifies native
SHA-256 manifests, binary format/architecture, package OS/CPU/libc metadata,
dual-license texts, exact staged dependencies, and all 12 immutable tarballs.
It publishes only those tarballs, with scripts disabled and provenance enabled
for every package.

After publication, verify registry metadata and provenance before consumption:

```bash
npm view @hansjm10/volt-iroh@1.1.1-volt.1 --json \
  name version dist-tags optionalDependencies repository license
npm view @hansjm10/volt-iroh-darwin-arm64@1.1.1-volt.1 --json \
  name version os cpu libc repository license
npm trust list @hansjm10/volt-iroh
```
