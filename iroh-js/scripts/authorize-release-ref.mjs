import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'

import { releaseConfig } from './release-config.mjs'

const ownedRepository = 'volt-hq/iroh-ffi'
const ownedBranch = 'volt/owned-iroh'

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

assert.equal(releaseConfig.targets.length, 11)
for (const spec of releaseConfig.targets) {
  assert.ok(spec.host)
  assert.ok(spec.build)
  assert.ok(spec.trustedInputs.length >= 3)
}

if (process.argv.includes('--check-config-only')) {
  console.log(`trusted release matrix contains ${releaseConfig.targets.length} targets`)
  process.exit(0)
}

assert.equal(process.env.GITHUB_ACTIONS, 'true')
assert.equal(process.env.GITHUB_EVENT_NAME, 'push')
assert.equal(process.env.GITHUB_REPOSITORY, ownedRepository)
const ref = process.env.GITHUB_REF ?? ''
const refName = process.env.GITHUB_REF_NAME ?? ''
const outputPath = process.env.GITHUB_OUTPUT
const token = process.env.GITHUB_TOKEN
assert.ok(outputPath)
assert.ok(token, 'GITHUB_TOKEN is required to verify protected release refs')

const branchResponse = await fetch(
  `https://api.github.com/repos/${ownedRepository}/branches/${encodeURIComponent(ownedBranch)}`,
  {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  },
)
assert.equal(branchResponse.status, 200, `GitHub branch API returned ${branchResponse.status}`)
const branch = await branchResponse.json()
assert.equal(branch.protected, true, `${ownedBranch} must remain protected`)

// Fetch only the protected owned branch. A tag is authorized only when it
// resolves to this exact remote branch head, not merely to an arbitrary commit
// that once appeared in repository history.
git(
  'fetch',
  '--no-tags',
  'origin',
  `+refs/heads/${ownedBranch}:refs/remotes/origin/${ownedBranch}`,
)
const branchCommit = git('rev-parse', `refs/remotes/origin/${ownedBranch}^{commit}`)
let release = false
let authorizedCommit

if (ref === `refs/heads/${ownedBranch}`) {
  authorizedCommit = git('rev-parse', 'HEAD^{commit}')
  assert.equal(authorizedCommit, branchCommit, 'branch workflow commit is no longer the protected branch head')
} else {
  assert.match(ref, /^refs\/tags\/npm-v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
  // The workflow checked out trusted authorization code from the owned branch,
  // so fetch the candidate tag only as data after validating its ref name.
  git('fetch', '--force', 'origin', `+${ref}:${ref}`)
  assert.equal(git('cat-file', '-t', ref), 'tag', 'release ref must be an annotated tag object')
  authorizedCommit = git('rev-parse', `${ref}^{commit}`)
  assert.equal(authorizedCommit, branchCommit, 'release tag must point at the exact protected branch head')

  const tagObject = git('rev-parse', ref)
  const response = await fetch(
    `https://api.github.com/repos/${ownedRepository}/git/tags/${tagObject}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  )
  assert.equal(response.status, 200, `GitHub tag verification API returned ${response.status}`)
  const tag = await response.json()
  assert.equal(tag.sha, tagObject)
  assert.equal(tag.object?.type, 'commit')
  assert.equal(tag.object?.sha, authorizedCommit)
  assert.equal(tag.verification?.verified, true, `tag signature is not verified: ${tag.verification?.reason}`)
  assert.equal(tag.verification?.reason, 'valid')
  release = true
}

assert.equal(process.env.GITHUB_SHA, authorizedCommit, 'event SHA must equal the authorized protected-branch commit')
appendFileSync(outputPath, `is_release=${release}\n`)
appendFileSync(outputPath, `authorized_sha=${authorizedCommit}\n`)
appendFileSync(outputPath, `build_matrix=${JSON.stringify(releaseConfig.targets)}\n`)
console.log(`authorized ${refName} at ${authorizedCommit}${release ? ' for release' : ' for trusted branch CI'}`)
