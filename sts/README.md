
This action retrieves short-lived Github credentials from using the Octopus STS service.

**Inputs:**
- `scope` (required): The repository to which you want to gain access, in the format `owner/repo`.
- `identity` (required): The name of the identity file created in the target repository (see below for details).

**Outputs:**
- `GIT_CONFIG_PATH`: The path to a git config file that has been created to use the retrieved token for authentication for the specified scope.

**Usage:**

This action requires few setup steps in order to grant you a short-lived token for accessing a specific repository.
1. First, you need to create an "identity(==file name)" in the *to-be-consumed(==private)* repository, which looks something like this:
```yaml
# File name: .github/chainguard/NAME_OF_YOUR_IDENTITY.yaml
issuer: https://token.actions.githubusercontent.com
# this example subject allows for any repository under the odigos-io organization,
# and allows for pull requests and branch/tag references.
subject_pattern: '^repo:odigos-io/[-a-zA-Z0-9_]+:(pull_request|ref:.*)$'

permissions:
  contents: read
```
The above configuration will grant workflows running in any repository under the `odigos-io` organization the ability to request short-lived tokens with `read` access to the contents of the repository where this identity file is defined.

2. In the consuming workflow, you need to make sure to provide `id-token: write` permission to the job that will use the action, like so:
```yaml
jobs:
  example-job:
    runs-on: ubuntu-latest
    permissions:
      id-token: write # this is required to request OIDC tokens
    steps:
    - name: Get GitHub STS Token
      uses: odigos-io/ci-core/.github/sts
      with:
        scope: "odigos-io/TO_BE_CONSUMED_REPOSITORY"
        identity: "NAME_OF_YOUR_IDENTITY"
```
By running the above, your local git config will be updated to use the retrieved token for authentication for the specified scope(aka repository).

**Usage with Docker 🐳:** By utilizing this action in the CI you can build docker images that need to pull private repositories as part of their build process without having to bake long-lived tokens or SSH keys into the image `#securityfirst`.

Since the action outputs a gitconfig file with the granted tokens which you could pass to down-the-line `docker build`s.

In such a case, you can do something like this:
```yaml
    steps:
    - name: Get GitHub STS Token
      id: get-git-sts
      uses: odigos-io/ci-core/.github/sts
      with:
        scope: "odigos-io/TO_BE_CONSUMED_REPOSITORY"
        identity: "NAME_OF_YOUR_IDENTITY"

    - name: Build Docker Image
      run: |
        docker build --secret id=GIT_CONFIG_PATH,src=${{ steps.get-git-sts.outputs.GIT_CONFIG_PATH }} .
```
and in your `Dockerfile`, you can use the secret like so:
```Dockerfile
...
RUN --mount=type=secret,id=gitconfig,required=false \
    git config --global include.path /run/secrets/gitconfig; \
    go mod download
...
```