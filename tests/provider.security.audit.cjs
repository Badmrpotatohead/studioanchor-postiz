// Bounded equivalent of registry audit: audit every lockfile version without
// pnpm's exponential reverse-path expansion. Registry failures fail closed.
const fs = require('node:fs');
const yaml = require('yaml');
const semver = require('semver');
const {
  verifyBracesMitigation,
  verifyZodMitigation,
} = require('./provider.security.mitigation.cjs');
(async () => {
  const lock = yaml.parse(fs.readFileSync('pnpm-lock.yaml', 'utf8'));
  const entries = Object.keys(lock.packages).map((key) => [
    key.slice(0, key.lastIndexOf('@')),
    key.slice(key.lastIndexOf('@') + 1),
  ]);
  const versions = {};
  for (const [name, version] of entries) (versions[name] ??= []).push(version);
  const response = await fetch(
    'https://registry.npmjs.org/-/npm/v1/security/advisories/bulk',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(versions),
      signal: AbortSignal.timeout(30000),
    }
  );
  if (!response.ok)
    throw new Error('Registry security audit HTTP ' + response.status);
  const advisories = await response.json();
  if (
    !advisories ||
    typeof advisories !== 'object' ||
    Array.isArray(advisories)
  )
    throw new Error('Invalid registry audit response');
  const findings = [];
  for (const [name, version] of entries)
    for (const advisory of advisories[name] ?? []) {
      if (
        !['low', 'moderate', 'high', 'critical'].includes(advisory.severity) ||
        !semver.validRange(advisory.vulnerable_versions)
      )
        throw new Error('Malformed registry advisory');
      if (
        semver.satisfies(version, advisory.vulnerable_versions, {
          includePrerelease: true,
        })
      )
        findings.push({
          name,
          version,
          id: advisory.id,
          url: advisory.url,
          severity: advisory.severity,
          title: advisory.title,
        });
    }
  // Never suppress a version/range globally. Each unreleased fix requires
  // exact locked patch/source hashes and executable attack-regression checks.
  const proof = verifyBracesMitigation();
  const zodProof = verifyZodMitigation();
  const mitigated = findings.filter(
    (row) =>
      (row.name === 'braces' &&
        row.version === '3.0.3' &&
        row.url === proof.advisory) ||
      (row.name === 'zod' &&
        row.version === '3.25.76' &&
        row.url === zodProof.advisory)
  );
  const blocking = findings.filter(
    (row) =>
      ['high', 'critical'].includes(row.severity) && !mitigated.includes(row)
  );
  const report = {
    checkedAt: new Date().toISOString(),
    packages: entries.length,
    uniquePackages: Object.keys(versions).length,
    rawCounts: findings.reduce(
      (out, row) => ({ ...out, [row.severity]: (out[row.severity] ?? 0) + 1 }),
      {}
    ),
    blocking,
    mitigated,
    mitigationPatchSha256: proof.patchSha256,
    zodMitigationPatchSha256: zodProof.patchSha256,
    findings,
  };
  fs.mkdirSync('.orbit/tmp', { recursive: true });
  fs.writeFileSync(
    '.orbit/tmp/provider-security-audit.json',
    JSON.stringify(report, null, 2) + '\n'
  );
  console.log(
    JSON.stringify({
      packages: report.packages,
      rawCounts: report.rawCounts,
      verifiedLocalMitigations: mitigated.length,
      blockingHighCritical: blocking.length,
    })
  );
  if (blocking.length) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
