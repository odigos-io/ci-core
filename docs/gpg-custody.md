# GPG custody — Linux package signing

This runbook covers the GPG key that signs Odigos `.deb` and `.rpm` packages: the key
ceremony, where each piece of key material lives, how the public key is published, and
what to do on rotation or compromise. Image signing is keyless cosign and entirely
separate — see [SIGNING.md](../SIGNING.md).

The design is key-agnostic: CI consumes whatever key sits in the
`ODIGOS_PKG_SIGNING_KEY` repo secret, so swapping the key never requires a workflow
change. (`ODIGOS_PKG_SIGNING_KEY_PASSPHRASE` also exists but stays empty — see
[What CI expects](#what-ci-expects).)

## The two-key model

Two unrelated keys are involved in package distribution, and they must never be
confused:

- **Google's Artifact Registry key** signs the **repo metadata** (apt `InRelease`, yum
  `repomd.xml`). This is the key served at `apt.odigos.io/doc/repo-signing-key.gpg` —
  it belongs to Google, we don't hold it, and it proves the *repo index* is what
  Artifact Registry published.
- **The Odigos package signing key** (this runbook) signs the **packages themselves**:
  an embedded `debsign` signature in each `.deb` and a header signature in each `.rpm`.
  It proves each *package* was built by our release pipeline, even when the file is
  obtained outside the repo (direct download, mirror, air-gap copy).

`apt` only checks the repo metadata, so on Debian/Ubuntu the Google key is what makes
`apt install` work; our embedded deb signature is defense-in-depth, verifiable with
`debsig-verify`. On rpm systems, `gpgcheck=1` verifies our key per-package. Publishing
one key never replaces the other.

## Key ceremony (~15 minutes)

Run on the operator's machine, **never in CI**. Produces:

- an **offline root**: rsa4096, certify-only, no expiry — the identity customers trust.
  It leaves the machine only as an armored export into the vault, and exists to mint
  and revoke subkeys.
- a **signing subkey**: rsa4096, sign-only, 2-year expiry — the only secret CI ever
  holds, exported **without passphrase protection** (step 6). Losing it costs a
  rotation, not the customer-facing identity.

One caveat on the subkey design: `rpm` older than 4.13 (RHEL 7 era) cannot verify
signatures made by a subkey. Anything modern is fine.

### 1. Temp GNUPGHOME

```bash
export GNUPGHOME="$(mktemp -d -t gpg)"
chmod 700 "$GNUPGHOME"
```

**macOS pitfall:** gpg-agent creates unix sockets inside `GNUPGHOME`, and socket paths
are capped at ~104 bytes on macOS. A deep path (e.g. under a repo checkout) fails with
opaque "can't connect to the agent" errors — `mktemp -d -t gpg` stays short enough.
(`-t gpg` is BSD/macOS syntax; on Linux use `mktemp -d /tmp/gpg.XXXXXX`.)

### 2. Passphrase and root key

One passphrase protects the whole key during the ceremony and guards the offline
root copy — generated here, stored only in the vault. It is **not** a CI secret: the
subkey sheds it in step 6 before its export becomes the repo secret.

```bash
PASS="$(openssl rand -base64 32)"

gpg --batch --pinentry-mode loopback --generate-key <<EOF
Key-Type: RSA
Key-Length: 4096
Key-Usage: cert
Name-Real: Odigos Package Signing
Name-Email: security@odigos.io
Expire-Date: 0
Passphrase: ${PASS}
%commit
EOF

FPR="$(gpg --list-keys --with-colons security@odigos.io | awk -F: '/^fpr:/ {print $10; exit}')"
```

### 3. Signing subkey

```bash
gpg --batch --pinentry-mode loopback --passphrase "$PASS" \
  --quick-add-key "$FPR" rsa4096 sign 2y
```

Sanity-check the shape — root must show `[C]` with no expiry, subkey `[S]` with one:

```bash
gpg --list-keys --with-subkey-fingerprints security@odigos.io
```

### 4. Revocation certificate

gpg already generated one at key creation:

```bash
cat "$GNUPGHOME/openpgp-revocs.d/$FPR.rev"
```

**Print this file on paper** during the ceremony. Note the safety guard: the armored
block starts with `:-----BEGIN PGP PUBLIC KEY BLOCK-----` — the leading colon must be
deleted before the certificate can be imported. Anyone holding it can kill the key
(denial of service, not forgery), so it stores alongside the root, never in CI.

### 5. Export the three artifacts

```bash
cd "$GNUPGHOME"

# (a) secret SUBKEY ONLY, still passphrase-protected — step 6 turns this into the CI artifact
gpg --batch --pinentry-mode loopback --passphrase "$PASS" \
  --armor --export-secret-subkeys "$FPR" > subkey-protected.asc

# (b) public key — published to customers
gpg --armor --export "$FPR" > odigos-package-signing.asc

# (c) full secret root — offline vault only, never CI
gpg --batch --pinentry-mode loopback --passphrase "$PASS" \
  --armor --export-secret-keys "$FPR" > root-offline.asc
```

### 6. Strip the subkey passphrase for CI

The GitHub secret store is the security boundary: an encrypted key whose passphrase
sits in the same store adds no protection, and it breaks the tooling outright — nfpm
(v2.47) refuses protected key material with `openpgp: invalid argument: signing key
is encrypted` even when its passphrase env vars are set. So the CI artifact is the
subkey with its protection **removed**; only the offline root stays
passphrase-protected.

gpg has no "export unprotected" switch, so clear the passphrase in a second scratch
home that holds only the subkey:

```bash
STRIP="$(mktemp -d -t gpgs)"; chmod 700 "$STRIP"
GNUPGHOME="$STRIP" gpg --batch --pinentry-mode loopback --passphrase "$PASS" \
  --import subkey-protected.asc
printf '%s\n\n' "$PASS" | GNUPGHOME="$STRIP" gpg --batch --pinentry-mode loopback \
  --command-fd 0 --status-fd 1 --passwd "$FPR"
GNUPGHOME="$STRIP" gpg --batch --armor --export-secret-subkeys "$FPR" > subkey-ci.asc
rm -rf "$STRIP"
```

The `printf` feeds the old passphrase, then an empty new one, through the command fd.
Expect the `--passwd` step to **exit non-zero** with `error changing passphrase: No
secret key` — that is gpg failing on the root *stub*, which has no secret material to
re-protect. The `[GNUPG:] SUCCESS keyedit.passwd` line confirms the subkey itself was
cleared, and step 7 proves it.

### 7. Prove the CI export lacks the root and carries no passphrase

Import `subkey-ci.asc` into a scratch keyring and confirm the primary shows `sec#` —
the `#` means the root's secret material is *absent* from the blob CI will hold —
then confirm a signature needs no passphrase:

```bash
VERIFY="$(mktemp -d -t gpgv)"; chmod 700 "$VERIFY"
GNUPGHOME="$VERIFY" gpg --import subkey-ci.asc
GNUPGHOME="$VERIFY" gpg -K       # expect: sec#  ...  ssb
echo probe | GNUPGHOME="$VERIFY" gpg --batch --pinentry-mode error \
  -u "$FPR" -o /dev/null --sign -   # must succeed with no passphrase, no pinentry
gpg --list-packets subkey-ci.asc | grep S2K   # must print nothing
rm -rf "$VERIFY"
```

If `gpg -K` prints `sec` without the `#`, or the sign probe wants a passphrase, stop —
the wrong file is about to become a CI secret.

### 8. Set the CI secret

This **overwrites** the throwaway TEST key currently in place (see
[Storage](#storage)):

```bash
for repo in odigos-io/vm-agent odigos-io/odigos; do
  gh secret set ODIGOS_PKG_SIGNING_KEY --repo "$repo" < subkey-ci.asc
done
```

`ODIGOS_PKG_SIGNING_KEY_PASSPHRASE` stays **reserved but empty** — the key is
unencrypted, nothing reads it, and the workflows tolerate an empty value. Do not set
it to the vault passphrase: that would put the root passphrase inside the CI boundary
for nothing.

### 9. Store offline, then destroy the workspace

Put `root-offline.asc`, the passphrase, and the revocation certificate in the vault
(next section), upload `odigos-package-signing.asc` (see
[Publishing the public key](#publishing-the-public-key)), then:

```bash
cd / && rm -rf "$GNUPGHOME"; unset PASS GNUPGHOME
```

Nothing from the ceremony may survive on disk.

## Storage

| Material | Lives | Never |
|---|---|---|
| Root secret key (`root-offline.asc`) | password-manager security vault | CI, any repo, any laptop keyring |
| Passphrase | vault only (`ODIGOS_PKG_SIGNING_KEY_PASSPHRASE` stays reserved and empty) | CI, committed anywhere |
| Revocation certificate | vault **and** a printed copy, stored separately | CI |
| Signing subkey (`subkey-ci.asc`, unencrypted) | `ODIGOS_PKG_SIGNING_KEY` repo secret on `odigos-io/vm-agent` and `odigos-io/odigos` | the vault is optional, nowhere else |
| Public key | S3 (below) + importable from any package | — |

**Today these two secrets hold a throwaway TEST key** — uid
`Odigos Package Signing TEST (throwaway, do not trust)`, fingerprint
`510DC64414507ACC3CA14BB640C96A2A4C005C5A` — set up purely to validate the CI
plumbing. The ceremony above **replaces it under the same secret names**; no workflow
changes, and nothing signed by the TEST key is trustworthy.

## What CI expects

The release workflows write `ODIGOS_PKG_SIGNING_KEY` to a temp file and point
goreleaser v2's nfpm signature config at it — `nfpms[].rpm.signature.key_file` and
`nfpms[].deb.signature.key_file` both accept an ASCII-armored secret key, **as long
as it is unencrypted**. nfpm (v2.47) fails on protected key material with
`openpgp: invalid argument: signing key is encrypted` even when its passphrase
environment (`NFPM_<ID>_<FORMAT>_PASSPHRASE`, `NFPM_<ID>_PASSPHRASE`,
`NFPM_PASSPHRASE`) is set — which is why ceremony step 6 strips the subkey's
protection. `ODIGOS_PKG_SIGNING_KEY_PASSPHRASE` remains defined as a reserved
secret; the workflows tolerate it empty and nothing consumes it today.

nfpm signs with the **first subkey carrying the signing flag** (goreleaser doesn't
expose `key_id`), which is exactly the subkey this ceremony produces — so the export
from step 6 drops in with zero config knobs. Signing is **fail-closed**: a missing
or empty key fails the release job loudly, same as sign-oci gates image publishes.

## Publishing the public key

Customers fetch our key from the release bucket:

```bash
aws s3 cp odigos-package-signing.asc \
  s3://odigos-releases/keys/odigos-package-signing.asc \
  --content-type text/plain --cache-control max-age=300
```

Do **not** touch `apt.odigos.io/doc/repo-signing-key.gpg` — that path serves Google's
Artifact Registry repo-metadata key (see [The two-key model](#the-two-key-model)).
Re-upload to the same S3 key after any rotation: the file carries the subkey and
revocation state, while the root — the identity customers actually trust — never
changes.

## Rotation

### Routine (expiry bump or re-issue) — no customer key change

Run at least a month before subkey expiry. Restore the root into a fresh temp
`GNUPGHOME` (same `mktemp -d -t gpg` setup as the ceremony), and re-derive `$PASS`
and `$FPR` — a fresh session has neither:

```bash
read -rs PASS                      # paste the passphrase from the vault entry
gpg --batch --pinentry-mode loopback --passphrase "$PASS" \
  --import root-offline.asc        # from the vault
FPR="$(gpg --list-keys --with-colons security@odigos.io | awk -F: '/^fpr:/ {print $10; exit}')"
```

A bare `gpg --import` works too, but gpg verifies the passphrase of a protected
secret key as it imports — expect a pinentry popup; the loopback flags keep it
non-interactive.

Then either extend the existing subkey:

```bash
SUBFPR="$(gpg --list-keys --with-colons "$FPR" | awk -F: '$1=="fpr"' | sed -n 2p | cut -d: -f10)"
gpg --batch --pinentry-mode loopback --passphrase "$PASS" \
  --quick-set-expire "$FPR" 2y "$SUBFPR"
```

or mint a fresh subkey (`--quick-add-key`, ceremony step 3). Either way, re-run the
ceremony from step 5: re-export, strip the passphrase, re-verify, overwrite the key
secret, re-upload the public key, destroy the workspace. Customers do nothing — the root
fingerprint they trust is unchanged; the refreshed public key just carries the new
expiry/subkey.

### Compromise

If the **subkey** (i.e. the CI secret) may have leaked:

1. Restore the root offline as above (including the `$PASS`/`$FPR` re-derivation);
   revoke the subkey: `gpg --edit-key "$FPR"`, then `key 1`, `revkey`, `save`.
2. Mint a new subkey and overwrite `ODIGOS_PKG_SIGNING_KEY` on **both** repos
   (ceremony steps 3, 5–8). If the passphrase may have leaked too, rotate it —
   generate a fresh one and change it before exporting. `gpg --passwd "$FPR"` alone
   is interactive (pinentry asks for the old and new passphrase); the non-interactive
   equivalent:

   ```bash
   NEWPASS="$(openssl rand -base64 32)"
   printf '%s\n%s\n' "$PASS" "$NEWPASS" | gpg --batch --pinentry-mode loopback \
     --command-fd 0 --passwd "$FPR"
   ```

   Rotating the passphrase only re-protects **this keyring** — the vault's
   `root-offline.asc` is still encrypted under the leaked passphrase. Re-export and
   replace the vault entry (and its stored passphrase), or the rotation changed
   nothing:

   ```bash
   gpg --batch --pinentry-mode loopback --passphrase "$NEWPASS" \
     --armor --export-secret-keys "$FPR" > root-offline.asc
   ```
3. Re-upload the public key — it now carries the revocation, so verifiers reject
   anything the old subkey signs from here on.
4. Re-sign and re-upload the latest packages with the new subkey, and audit Artifact
   Registry for packages signed inside the compromise window.

If the **root** may have leaked (vault breach): import the printed revocation
certificate (delete its leading-colon guard first), publish the revoked key, and run a
full ceremony — this is the one case where customers must re-trust a new key.

## Current state

- Once the plumbing PRs land, `vm-agent` and `odigos` release workflows sign every
  `.deb`/`.rpm` **fail-closed** — a missing or empty `ODIGOS_PKG_SIGNING_KEY` fails
  the release, it never silently ships unsigned.
- The secrets still hold the **throwaway TEST key**; packages signed today validate
  plumbing only and must not be trusted.
- Customer-facing install docs stay on `gpgcheck=0` / no key import until the real
  key ships via the ceremony above — flipping docs to `gpgcheck=1` and publishing the
  key is a separate, later phase.
