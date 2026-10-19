# GPG custody — Linux package signing

This page covers the GPG key that signs Odigos `.deb` and `.rpm` packages: what the key
is, where each half lives, how the public key reaches customers, and how a new key is
issued. Image signing is keyless cosign and entirely separate — see
[SIGNING.md](../SIGNING.md).

The design is deliberately minimal: **one key, one secret, one gated workflow**. There is
no offline root, no subkey, no passphrase, no vault copy and no ceremony. The GitHub
secret store is the security boundary, and the published keyring is what customers
trust.

## The two-key model

Two unrelated keys are involved in package distribution:

- **Google's Artifact Registry key** signs the **repo metadata**: apt `InRelease` and yum
  `repomd.xml`. It is the key served at `apt.odigos.io/doc/repo-signing-key.gpg` and
  `yum.odigos.io/doc/repo-signing-key.gpg`; Google holds it, we do not. The yum repo
  config keeps `repo_gpgcheck=0` so that `gpgkey=` only has to list our key; turning it
  on would mean adding Google's key URL to `gpgkey=` as well.
- **The Odigos package signing key** (this page) signs the **packages themselves**: a
  header signature in each `.rpm` and a `debsigs`-style `_gpgorigin` member in each
  `.deb`. It proves a package came out of our release pipeline even when the file is
  obtained outside the repo (direct download, mirror, air-gapped copy).

On rpm systems `gpgcheck=1` verifies our key per package. On Debian/Ubuntu `apt` only
checks the repo metadata, so Google's key is what makes `apt install` work and the
embedded deb signature is defence in depth, verifiable with `debsig-verify` or `gpg`.

## The key

| | |
|---|---|
| Type | RSA-4096, sign-capable primary key, no subkeys, no expiry, **no passphrase** |
| User ID | `Odigos Package Signing <security@odigos.io>` |
| Current fingerprint | `6E80516AF71835E5FD12E3D8272251E89CC74CFF` (issued 2026-10-18) |
| Issued by | the `rotate-package-signing-key` workflow in the private repository `odigos-io/release-signing` |

Why no passphrase: nfpm can read one from `NFPM_PASSPHRASE`, but a passphrase stored
next to the key in the same secret store protects nothing while adding a second secret to
scope and rotate. Why no offline root or subkeys: nobody holds the key, so there is nothing
to protect offline; if the key is lost or compromised a new one is issued and the
keyring grows by one entry.

## Where each half lives

| Material | Lives | Never |
|---|---|---|
| Private key | organization secret `ODIGOS_PKG_SIGNING_KEY`, visibility *selected*: `odigos-io/vm-agent`, `odigos-io/odigos-enterprise` | a repo secret, a vault, a laptop, a human's hands |
| Public key | `docs/keys/odigos-package-signing-keys.asc` in `odigos-io/odigos`, served at `https://raw.githubusercontent.com/odigos-io/odigos/main/docs/keys/odigos-package-signing-keys.asc` | `apt.odigos.io/doc/repo-signing-key.gpg` (that is Google's key) |
| Key status table | "Linux package signing keys" section of `docs/snippets/shared/setup/verifying-images.mdx` in `odigos-io/odigos` | — |
| Revocation certificate | none exists (see [Compromise](#compromise)) | — |

The keyring file is **append-only**: it holds every key that ever signed a published
package, so old packages keep verifying after a rotation. The status table says which
key is current and which are retired.

A repository-level secret named `ODIGOS_PKG_SIGNING_KEY` **shadows** the organization
secret. None may exist on the consumer repos, otherwise CI silently keeps signing with
whatever that repo secret holds.

## Issuing a key

The only way a key is created is the `rotate-package-signing-key` workflow in
`odigos-io/release-signing` (`workflow_dispatch`, inputs `reason` and `dry_run`). It runs
in the `release-gate` environment: a required reviewer must approve the run, and it only
runs from a protected branch. Every key that ever existed therefore maps to one visible,
approved run. The job:

1. generates the key with `gpg --quick-generate-key ... rsa4096 sign never` in a
   temporary `GNUPGHOME` and asserts the export carries no passphrase (no S2K packet);
2. writes the armored private key to the organization secret, sealed with the
   organization's secrets public key, using a GitHub App token whose only permission is
   `organization_secrets: write`, and reads the secret metadata back to confirm the
   repository scope;
3. appends the public key to the keyring, updates the status table (the previous
   `current` key becomes `retired`), commits as `odigos-automations` and opens the docs
   PR in `odigos-io/odigos` as `octo-sts[bot]`, authenticated through the `sts` action in
   this repository (trust policy `.github/chainguard/release-signing-docs.sts.yaml` in
   `odigos-io/odigos`);
4. removes the temporary key material.

The private key exists only in the runner's temporary directory for the duration of the
job and in the organization secret afterwards. Nobody sees it.

After a run: merge the docs PR, confirm the keyring URL above returns the new key, and
check that no repo-level `ODIGOS_PKG_SIGNING_KEY` shadows the new value.

## What CI expects

Both consumers hand nfpm an unencrypted ASCII-armored secret key file through goreleaser
v2's `nfpms[].rpm.signature.key_file` and `nfpms[].deb.signature.key_file`:

- **vm-agent** passes the secret into the Docker release stage as a BuildKit secret
  mount (`pkg_signing_key`); the Dockerfile exports its path as `PKG_SIGNING_KEY_FILE`.
  Staging builds in CI sign too, and a verify step checks every rpm (`rpmkeys --import`
  + `rpm -K`) and deb (`_gpgorigin` detached signature) before the staging upload; tag
  releases rely on the fail-closed secret check.
- **odigos-enterprise** (collector packages) writes the secret to a `umask 077` temp
  file, exports its path as `ODIGOS_PKG_SIGNING_KEY_FILE`, and shreds the file after
  goreleaser runs.

Signing is **fail-closed** in both: a missing or empty secret fails the release job
before goreleaser runs, the same way `sign-oci` gates image publishes. There are no
passphrase variables anywhere.

## Customer side

```ini
[odigos]
baseurl=https://yum.odigos.io/projects/odigos-cloud/odigos-rpm
enabled=1
gpgcheck=1
repo_gpgcheck=0
gpgkey=https://raw.githubusercontent.com/odigos-io/odigos/main/docs/keys/odigos-package-signing-keys.asc
```

`rpm --import <keyring URL>` imports every key in the file, so a customer who imported
it once keeps verifying old and new packages across a rotation. apt users change
nothing: metadata verification stays on Google's key.

## Rotation

The key has no expiry and is rotated **only on compromise or loss**. Rotation is the
workflow above with a `reason`: it overwrites the organization secret, appends the new
public key and retires the previous one in the status table. Then cut a vm-agent and a
collector release so the current packages carry signatures from the new key. Customers
only need to re-import the keyring.

### Compromise

There is no offline root and therefore no revocation certificate; the status table is
the revocation signal.

1. Issue a new key (workflow, `reason` states the compromise) and merge the docs PR,
   editing the table so the old key's status is `compromised` with the date.
2. Audit Artifact Registry and the `odigos-releases` S3 bucket for packages published
   inside the compromise window; rebuild and re-publish them so they carry the new
   signature.
3. Tell customers to drop the compromised key from their rpm database
   (`rpm -e gpg-pubkey-<last 8 hex of the fingerprint, lowercased>`) and re-import the
   keyring.

A compromised key stays listed in the keyring and table for the record, but anything it
signed after the compromise date must be treated as untrusted.
