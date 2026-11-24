# Automatic Apps Script deployment

Every Google Apps Script backend of the site is listed in [`projects.json`](projects.json)
(script ID, the existing web-app deployment ID, and which files in this repo belong to it).

When a change is merged to `main`, the GitHub Action
[`deploy-gas.yml`](../.github/workflows/deploy-gas.yml) redeploys **only the projects whose
files changed**. It uploads the code with `clasp push`, then publishes a new version on the
**existing** deployment, so the `/exec` URLs never change.

| Key | Project | Files |
|---|---|---|
| `admin` | Receipt Upload + Donation Certificates | `admin/api/Code.gs` |
| `school-admin` | School Admin Kanban + Teacher Attendance | `school-admin/api/Code.gs` |
| `marriage` | Marriage Request & Contract Upload | `marriage/api/Code.gs` |
| `school` | Alsalam School Registration | `school/api/main.gs` |
| `fifs-proxy` | FIFS Membership Proxy | `membership-check/api/membership-proxy.gs` |
| `bonetider` | Bönetider (Prayer Times) Proxy | `bonetider/api/bonetider.gs` |
| `tv-slides` | TV Slides API | `stats/api/slides.gs` |
| `membership-sheet` | Membership donator checker | `membership-check/api/membership-sheet.gs` |
| `swish-reader` | Swish app reader | `stats/api/Code.gs`, `stats/api/get.gs` |
| `stripe-donations` | Stripe Donations | `donations/api/` (pulled from Google) |
| `stripe-fetch` | Alsalam stripe fetch | `stats/api/stripe/` (pulled from Google) |

## One-time setup (about 15 minutes, on your PC)

1. **Turn on the Apps Script API** for the Google account that owns the scripts:
   <https://script.google.com/home/usersettings> → *Google Apps Script API* → On.
2. **Install clasp** (needs Node.js): `npm install -g @google/clasp@2.4.2`
3. **Log in:** `clasp login` — a browser window opens; approve with the account that owns
   the scripts. This creates `%USERPROFILE%\.clasprc.json` (Windows) or `~/.clasprc.json`.
4. **Pull what is live** — from the repo root: `node gas/pull.mjs`
   - saves each project's settings file (`appsscript.json`) to `gas/manifests/<key>.json`
     — a project is never auto-deployed until its manifest is here;
   - overwrites repo files whose live version differs (the live code is the truth), saves
     files that exist only online, and brings in the two Stripe projects whose code was
     never in the repo;
   - deploys nothing.

   Review the result with `git diff`, then commit it.
5. **Give GitHub the login:** add the content of `.clasprc.json` as an Actions secret named
   `CLASPRC_JSON` — repo *Settings → Secrets and variables → Actions → New repository secret*,
   or `gh secret set CLASPRC_JSON < "%USERPROFILE%\.clasprc.json"`.
   **Never commit this file** — it gives access to the Google account.
6. **Test:** GitHub → *Actions → Deploy Apps Script → Run workflow* with `all` and
   *dry run* ticked. Every project should show "dry run" instead of "skipped".

## Day to day

- Edit the `.gs` file in this repo, merge to `main` → it is live a minute later.
- Deploy by hand: *Actions → Deploy Apps Script → Run workflow* (`all`, or keys such as
  `admin,school-admin`). Locally: `node gas/deploy.mjs --only admin` (uses your own login).
- **Do not edit code in the online Apps Script editor** — the next deploy overwrites it.
  If you had to, run `node gas/pull.mjs <key>` and commit before the next merge.
- **New permissions** (e.g. a script starts sending email) still need one manual approval:
  open the project in the editor, run any function once and accept. The automation cannot
  click that button.
- Script properties (passwords, API keys) live in Google, not in this repo, and are never
  touched by a deploy.

## Adding a new Apps Script project

Add an entry to `projects.json` (script ID from *Project Settings*, deployment ID from
*Deploy → Manage deployments*), run `node gas/pull.mjs <key>`, commit.
