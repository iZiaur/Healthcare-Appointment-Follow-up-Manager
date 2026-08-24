# Healthcare Appointment & Follow-up Manager

A comprehensive clinic platform with distinct portals for Patients, Doctors, and Admins. Built with a modern Next.js 14 stack, Prisma ORM, and PostgreSQL.

## Architecture Highlights

- **External Services**: LLMs, Email, and Google Calendar APIs are abstracted behind swappable provider interfaces (e.g. `EmailProvider`, `LLMProvider`) allowing for easy mocking during local development and zero-touch swap-outs in production.
- **Graceful Degradation**: External API calls run asynchronously via an internal background job queue (`BackgroundJob` table). The system utilizes an exponential backoff envelope (3 attempts maximum), completely isolated from the main user-facing execution thread.
- **Horizontal Scaling & Concurrency**: The background worker utilizes atomic PostgreSQL row-level locks (`FOR UPDATE SKIP LOCKED`) to claim jobs. This prevents duplicate email/calendar sync processing in the event of multi-instance or horizontal scaling deployments.

## Deployment Strategy

Because this application relies on high-frequency (per-minute) background jobs to manage the queue and release expired appointment holds, **we strongly recommend deploying to Render or Railway** over stateless providers like Vercel.

Vercel's free/Hobby tier strictly limits cron job execution to once daily, which will severely bottleneck the appointment scheduling flow. Render and Railway both offer robust free tiers that natively support persistent long-running background workers, allowing the `npm run jobs` orchestrator to run continuously without configuration rewrites.

## Third-Party Integrations Setup

### 1. Google Calendar (OAuth 2.0)

To enable calendar syncing for both doctors and patients, you must configure OAuth via the Google Cloud Console.

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (e.g., "Healthcare Platform").
3. Navigate to **APIs & Services > Library** and enable the **Google Calendar API**.
4. Navigate to **APIs & Services > OAuth consent screen**.
   - Choose **External** (unless restricting to an internal Google Workspace).
   - Fill out the required App Information.
   - On the Scopes screen, explicitly add the Calendar Events scope: 
     `https://www.googleapis.com/auth/calendar.events`
5. Navigate to **APIs & Services > Credentials**.
   - Click **Create Credentials > OAuth client ID**.
   - Application type: **Web application**.
   - Add your Authorized Redirect URIs (e.g., `http://localhost:3000/api/auth/google/callback` for local development).
6. Copy your **Client ID** and **Client Secret**. Add them to your `.env` file along with your redirect URI:
   ```env
   GOOGLE_CLIENT_ID="your-client-id"
   GOOGLE_CLIENT_SECRET="your-client-secret"
   GOOGLE_REDIRECT_URI="http://localhost:3000/api/auth/google/callback"
   ```

## Known Limitations

- **Partial-Day Leaves**: The database schema supports recording partial-day leaves (via `isFullDay: false` and specific start/end times). However, the current Admin portal logic only enforces **full-day** absences. If partial leaves are added, the conflict resolution engine (`leave-service.ts`) will need to be updated to compute specific time overlaps before cancelling appointments.
- **Medication Reminder Start Times**: The automated medication schedule defaults to starting at `8:00 AM` on the day *after* the visit, calculating intervals deterministically off the prescribed frequency. Per-patient configuration of preferred anchor times (e.g. "I wake up at 10 AM") is not supported in v1.
