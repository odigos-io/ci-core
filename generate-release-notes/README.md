# generate-release-notes

Provides an action to generate release notes for an input tag/release branch.

## Local testing

Can be run locally with [act](https://github.com/nektos/act):

For example, when running from `odigos-io/odigos`:

```
$ cd odigos-io/odigos
$ act workflow_dispatch -W .github/workflows/update-release-notes.yml --input tag=v1.19.1 --input release_branch=releases/v1.19.0 --input dry_run=true -s GITHUB_TOKEN="$(gh auth token)" --env-file .env.act
```

### .env.act

I used `.env.act` when testing changes to this action from my fork. For example,
I updated the workflow definition to import from `damemi/odigos@branch-name`. When
I did this, I had to tell act to use `odigos-io/odigos` for checkout instead of `damemi/odigos`.

I also hit weird hanging on checkout that seems to be a known issue with act. So I passed it some extra git ssh
commands to avoid that.

So my `.env.act` looks like this:

```
# .env.act
GITHUB_REPOSITORY=odigos-io/odigos
GIT_SSH_COMMAND='ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null'
```
