# Contributing

Work is tracked through GitHub issues, milestones and the [project board](https://github.com/users/Gichezz/projects/1). Every change reaches `main` through a pull request.

## Workflow

1. **Pick an issue.** Every change starts from an issue with acceptance criteria. Move its board item to **In progress**.
2. **Branch from the latest `main`:**

   ```bash
   git switch main
   git pull
   git switch -c <type>/<issue-number>-<short-description>
   ```

   | Prefix | Use for | Example |
   |--------|---------|---------|
   | `feature/` | New functionality or integration | `feature/17-forecast-api-integration` |
   | `fix/` | Bug fixes | `fix/8-conflict-fk-order` |
   | `test/` | Test coverage | `test/19-backend-api-tests` |
   | `docs/` | Documentation | `docs/24-readme-update` |
   | `chore/` | Cleanup, configuration, CI | `chore/10-remove-dead-files` |

3. **Keep to the issue's scope.** Unrelated problems get their own issue.
4. **Commit** using [Conventional Commits](https://www.conventionalcommits.org/) and reference the issue:

   ```text
   fix(sync): insert sync operation before conflict record (#8)
   ```

5. **Run the relevant tests** before pushing:

   | Service | Command |
   |---------|---------|
   | Forecasting | `cd forecasting` then `venv\Scripts\python -m pytest tests` |
   | Frontend | `cd frontend` then `npm run build` |
   | Backend | `cd backend` then `npm test` (needs PostgreSQL; creates and drops a `*_test` database) |

6. **Push the branch** (never `main`) and open a pull request into `main` using the template.
7. **Link the issue.** Use `Closes #N` only when the PR meets every acceptance criterion. Otherwise use `Part of #N` and leave the issue open.
8. **Review the diff and merge** once checks pass. Prefer squash merges, so each PR becomes one commit on `main`. Delete the branch afterwards.
9. **Confirm the issue closed** and its board item is in **Done**.

## Branch protection

`main` is protected by a repository ruleset: changes require a pull request, and force pushes and branch deletion are blocked, for everyone including administrators.

## Issue conventions

- **Labels:** one `type:` label, one or more `area:` labels, and one `priority:` label.
- **Milestone:** every issue belongs to the milestone for its phase.
- **Backfilled issues:** issues marked *Backfilled record* document work implemented before tracking began on 2026-10-11. They are closed only after verification, with the evidence in the closing comment.
