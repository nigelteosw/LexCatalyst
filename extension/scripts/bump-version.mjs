// Bumps the patch version in package.json and public/manifest.json together and prints the new version.
// Edits the version line in place so each release is a one-line diff per file.
// Chrome requires manifest versions to be 1-4 dot-separated integers, so keep this plain semver.
import { readFileSync, writeFileSync } from 'node:fs'

const VERSION_LINE = /^(\s*"version":\s*")(\d+)\.(\d+)\.(\d+)(")/m
const paths = ['package.json', 'public/manifest.json'].map((path) => new URL(`../${path}`, import.meta.url))
const sources = paths.map((path) => readFileSync(path, 'utf8'))

const versions = sources.map((source, index) => {
  const match = VERSION_LINE.exec(source)
  if (!match) throw new Error(`No semver "version" in ${paths[index].pathname}`)
  return `${match[2]}.${match[3]}.${match[4]}`
})
if (versions[0] !== versions[1]) {
  throw new Error(`package.json (${versions[0]}) and manifest.json (${versions[1]}) are out of sync`)
}

const [major, minor, patch] = versions[0].split('.').map(Number)
const next = `${major}.${minor}.${patch + 1}`
sources.forEach((source, index) => {
  writeFileSync(paths[index], source.replace(VERSION_LINE, `$1${next}$5`))
})
console.log(next)
