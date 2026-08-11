# Deployment runbook

## Supabase

1. Create a free project.
2. Enable Authentication → Providers → Anonymous.
3. Run `supabase/migrations/202608100001_initial.sql`.
4. Confirm `room_players` and `room_events` are enabled in Realtime.
5. Copy the project URL and anon key into GitHub Actions repository secrets named `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

The migration uses RLS and `security definer` RPCs. Do not grant the browser a service-role key. Keep the Supabase dashboard’s database password and service-role key out of GitHub secrets unless a separate server-side operation requires them.

## GitHub Pages

1. Create or use a GitHub repository containing this project.
2. Push the default branch as `main`.
3. In Settings → Pages choose GitHub Actions.
4. Add the two Vite secrets above.
5. Push a change or run the “Deploy Pages” workflow manually.

The workflow sets `VITE_BASE_PATH=/<repository-name>/`, builds, uploads `dist/`, and deploys the Pages artifact. The resulting public URL is `https://<owner>.github.io/<repository-name>/`.

## Smoke test

Open the public URL in two separate browser profiles. Create a room, copy the invite, join from the second browser, confirm two seats, start the race, refresh during planning, and verify that the room code, phase, public player counts, and own hand remain available. Run the unit suite and the configured Playwright multi-context test before inviting friends.

## Manual setup still required in this workspace

No GitHub or Supabase credentials were available to this build session. The code, migration, workflows, and docs are complete locally, but creating the remote project, applying the migration, adding secrets, pushing the repository, and smoke-testing the public URL require the owner’s accounts and permissions.
