# Member Connections AI (Friendly name: "Fabric")


AI-powered member connections for Slack, helping community members find and connect with each other.

## Tools & Integrations

### CI/CD:

[![Tests](https://github.com/9Zero-Climate/member-connections-ai/actions/workflows/test.yml/badge.svg)](https://github.com/9Zero-Climate/member-connections-ai/actions/workflows/test.yml)
[![Sync](https://github.com/9Zero-Climate/member-connections-ai/actions/workflows/sync-all.yml/badge.svg)](https://github.com/9Zero-Climate/member-connections-ai/actions/workflows/sync-all.yml)
[![Latest Prod deployment](https://github.com/9Zero-Climate/member-connections-ai/actions/workflows/merge-staging-to-prod.yml/badge.svg)](https://github.com/9Zero-Climate/member-connections-ai/actions/workflows/merge-staging-to-prod.yml)

### Backend:

[![Badge - DigitalOcean - Staging](https://img.shields.io/badge/DigitalOcean-staging-blue?logo=digitalocean)](https://cloud.digitalocean.com/apps/e7ea69b2-a358-4423-858c-3e3edcd5e876?i=699ddc)
[![Badge - DigitalOcean - Prod](https://img.shields.io/badge/DigitalOcean-prod-blue?logo=digitalocean)](https://cloud.digitalocean.com/apps/7402bc29-ee0c-4a9a-a749-4d2ffd228660?i=699ddc)

[![Badge - Supabase - Postgres DB](https://img.shields.io/badge/Supabase-Postgres_DB-blue?logo=supabase)](https://supabase.com/dashboard/project/tdafislwgoqgprplkues/database/tables)

### Logging & Monitoring:

[![Badge - BetterStack Logging](https://img.shields.io/badge/BetterStack-logging-blue?logo=betterstack)](https://telemetry.betterstack.com/team/328445/dashboards/426350)

[![Badge - Hex Dashboard](https://img.shields.io/badge/Hex-dashboard-blue?logo=data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4gPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIGlkPSJMYXllcl8yIiBkYXRhLW5hbWU9IkxheWVyIDIiIHZpZXdCb3g9IjAgMCAxNDUwLjMgNjAwIj48ZGVmcz48c3R5bGU+IC5jbHMtMSB7IGZpbGw6ICM0NzM5ODI7IGZpbGwtcnVsZTogZXZlbm9kZDsgfSA8L3N0eWxlPjwvZGVmcz48ZyBpZD0iTGF5ZXJfMS0yIiBkYXRhLW5hbWU9IkxheWVyIDEiPjxwYXRoIGNsYXNzPSJjbHMtMSIgZD0ibTI1MC4xMSwwdjE5OS40OWgtNTBWMEgwdjYwMGgyMDAuMTF2LTMwMC42OWg1MHYzMDAuNjloMjAwLjE4VjBoLTIwMC4xOFptMjQ5LjksMHY2MDBoNDUwLjI5di0yNTAuMjNoLTIwMC4ydjE0OWgtNTB2LTE5OS40NmgyNTAuMlYwaC00NTAuMjlabTIwMC4wOSwxOTkuNDl2LTk5LjQ5aDUwdjk5LjQ5aC01MFptNTUwLjAyLDBWMGgyMDAuMTh2MTUwbC0xMDAsMTAwLjA5LDEwMCwxMDAuMDl2MjQ5LjgyaC0yMDAuMTh2LTMwMC42OWgtNTB2MzAwLjY5aC0yMDAuMTF2LTI0OS44MmwxMDAuMTEtMTAwLjA5LTEwMC4xMS0xMDAuMDlWMGgyMDAuMTF2MTk5LjQ5aDUwWiI+PC9wYXRoPjwvZz48L3N2Zz4g)](https://app.hex.tech/019618bd-d2e7-700b-8b18-0070d1dad34f/app/01961b99-87dc-7000-a597-1be47c8ebbf5/latest)


### Integrations:

[![Badge - Slack - Staging](https://img.shields.io/badge/Slack-staging-blue?logo=slack)](https://api.slack.com/apps/A08MZ6JAM88)
[![Badge - Slack - Prod](https://img.shields.io/badge/Slack-prod-blue?logo=slack)](https://api.slack.com/apps/A08L3V4U3KJ)

[![Badge - Linkedin via Proxycurl](https://img.shields.io/badge/linkedin-via_Proxycurl-blue?logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjEyIiBoZWlnaHQ9IjYwNyIgdmlld0JveD0iMCAwIDYxMiA2MDciIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgY2xpcC1ydWxlPSJldmVub2RkIiBkPSJNMCA0NkMwIDIwLjU5NDkgMjAuNTk0OSAwIDQ2IDBINTY2QzU5MS40MDUgMCA2MTIgMjAuNTk0OSA2MTIgNDZWNTYxQzYxMiA1ODYuNDA1IDU5MS40MDUgNjA3IDU2NiA2MDdINDZDMjAuNTk0OSA2MDcgMCA1ODYuNDA1IDAgNTYxVjQ2Wk0zNTEgMjM4LjVDMzQ1LjQgMjQyLjEgMzM0IDI1NS42NjcgMzI5IDI2MlYyMjdIMjM5VjUxN0gzMjlWMzU3QzMyOS41IDM0MyAzMzQuNSAzMjcuNSAzNDAgMzE5QzM0NS41IDMxMC41IDM1NC41IDMwNC41IDM2MC41IDMwMi41QzM2MC43MyAzMDIuNDIzIDM2MC45NjUgMzAyLjM0NSAzNjEuMjA2IDMwMi4yNjRDMzY3LjIzOCAzMDAuMjQxIDM3Ni42MTMgMjk3LjA5NiAzOTIgMjk5LjVDNDA4IDMwMiA0MTQgMzA5IDQyMSAzMTlDNDI4LjYgMzI3LjggNDMwLjE2NyAzNTAgNDMwIDM2MFY1MTdINTIwVjM2MEM1MTkuNjc5IDMzOC44NDIgNTE3LjM3IDMwNC42OTQgNTE3IDMwOS41QzUxNi44ODEgMzExLjA0OSA1MTUuNDIxIDMwMy44MzcgNTE0LjA3MyAyOTcuMTc2TDUxNC4wNzIgMjk3LjE3NEM1MTMuMjA4IDI5Mi45MDcgNTEyLjM5IDI4OC44NjcgNTEyIDI4Ny41QzUxMSAyODQgNTA2LjUgMjcyIDUwNS41IDI2OS41QzUwNC41IDI2NyA0OTcuNSAyNTMuNSA0ODkuNSAyNDZDNDg5LjEzNSAyNDUuNjU4IDQ4OC43NzYgMjQ1LjMyIDQ4OC40MjEgMjQ0Ljk4N0w0ODguNDE1IDI0NC45ODFMNDg4LjM5MyAyNDQuOTZDNDgwLjk3MSAyMzcuOTg4IDQ3NS40MzkgMjMyLjc4OSA0NjQgMjI4LjVDNDUyIDIyNCA0MjggMjE5LjUgNDEzLjUgMjE5LjVDMzk5IDIxOS41IDM4MiAyMjMuNSAzNzQuNSAyMjZDMzY3IDIyOC41IDM1OCAyMzQgMzUxIDIzOC41Wk05MiAyMjdIMTgyVjUxN0g5MlYyMjdaTTEzNi41IDE4OEMxNjYuMDQ3IDE4OCAxOTAgMTY0LjQ5NSAxOTAgMTM1LjVDMTkwIDEwNi41MDUgMTY2LjA0NyA4MyAxMzYuNSA4M0MxMDYuOTUzIDgzIDgzIDEwNi41MDUgODMgMTM1LjVDODMgMTY0LjQ5NSAxMDYuOTUzIDE4OCAxMzYuNSAxODhaIiBmaWxsPSIjRjhGOEY4Ii8+Cjwvc3ZnPgo=)](https://nubela.co/proxycurl/dashboard)


[![Badge - OfficeRnD - Member Data](https://img.shields.io/badge/officeRND-member_data-blue?logo=slack)](
https://app.officernd.com/admin/climate9zero/home)

### Language Model:

[![Badge - Gemini 2.0 Flash LLM via OpenRouter](https://img.shields.io/badge/Gemini_2.0_Flash-LLM_via_OpenRouter-blue?logo=googlegemini)](https://openrouter.ai/google/gemini-2.0-flash-001)

### Communications:

[![Badge - GitHub](https://img.shields.io/badge/GitHub-projects-blue?logo=github)](https://github.com/orgs/9Zero-Climate/projects/1/views/2)

[![Badge - Slack - Eng channel](https://img.shields.io/badge/Slack-%23eng-blue?logo=slack)](https://api.slack.com/apps/A08L3V4U3KJ)

## Development

### Prerequisites

- Node.js
- Docker (for local Postgres db with PGVector extension)
- pnpm
- .env file with correct environment variables

### Setup

1. Clone the repository
2. Install dependencies:

```bash
pnpm install
```

3. Create a `.env` file. See `config.ts` and `.env.example` for required environment variables

### Running the Bot Server

To run the Slack bot server:

```bash
# Production mode
pnpm start

# Development mode with hot reloading
pnpm dev
```

The bot server provides:
- Interactive member connections through Slack
- Health check endpoint at http://localhost:8080
- Socket Mode for secure communication with Slack

### Manual Sync

To manually sync messages from a Slack channel:

```bash
# Sync recent messages from a channel
pnpm sync introductions
```

### Local database
To set up a local version of the supabase database:

Start local supabase:

```bash
pnpm supabase start
```

Run migrations:

```bash
pnpm migrate:all
```

Optionally, run the various sync scripts to sync production data (skip LinkedIn - that's expensive)

```bash
pnpm sync officernd
pnpm sync notion
pnpm sync slack introductions
```

View the dashboard at `http://localhost:54323/`

## Logging

Logs from this project are handled by pino and sent to BetterStack Telemetry (fka Logtail).
See em at https://telemetry.betterstack.com/team/315967/

Whenever possible, when using the logger, log the relevant user slack ID as "user" in the log object. This facilitates filtering logs in BetterStack.


## GitHub Actions

The project includes automated workflows:

- **Tests**: Runs on push and pull requests to main branch
  - Runs linting checks
  - Runs all tests
  - Uploads coverage reports to Codecov
  - Requires `DB_URL` secret

- **Sync All**: Runs daily at midnight Pacific time to sync data from external sources (OfficeRnD, Notion, LinkedIn, Slack)
  - Can be manually triggered from the Actions tab
  - Requires various environment variables, see `config.ts`