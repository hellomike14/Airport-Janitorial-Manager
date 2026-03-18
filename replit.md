# Workspace

## Overview

pnpm workspace monorepo using TypeScript. This is the **Marvol Facility Cleaning Management App** for MCO International Airport (KMCO - Orlando).

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite, React Query, Wouter routing, Tailwind CSS, Recharts

## Application Features

### Marvol Facility Cleaning Management

A comprehensive janitorial cleaning management web app for Marvol Facility at MCO International Airport.

**Coverage Areas (7 total):**
1. Terminal A - East Garage
2. Terminal A - West Garage
3. Terminal B - East Garage
4. Terminal B - West Garage
5. Terminal C - Levels 1, 3, 5
6. Terminal C - Levels 2, 4, 6
7. Top Terminal - Levels 4-11

**Team (13 total):**
- 1 Admin (System Administrator)
- 2 Supervisors (Maria Rodriguez, James Thompson)
- 10 Cleaning Staff members

**Role-Based Access Control:**
- **Admin**: Full access — can switch view mode between Admin/Supervisor/Staff views
- **Supervisor**: Dashboard, areas, assignments, issue tracker (no staff management)
- **Staff**: My Tasks page + My Issues (assigned issues with completion flow)

**Auth:** No passwords — click-to-login from grouped staff list; stored in localStorage.

**Pages:**
- Login - Click-to-login with role-grouped staff list
- Dashboard - Real-time overview, stats cards, area progress (admin/supervisor)
- Cleaning Areas - List of all areas with progress (admin/supervisor)
- Area Tasks - 15 daily tasks per area with checkbox completion + timestamps
- Staff Directory - Add/edit/delete staff including admin role (admin only)
- Assignments - Supervisors assign staff to areas daily + special inspector assignments
- Issue Tracker - Report, assign, and resolve facility issues; supervisor assigns to staff
- My Tasks - Staff-only page showing today's assigned area tasks with completion
- My Issues - Staff-only page showing issues assigned to them with completion flow (notes + photos)

**API Routes:**
- `GET /api/dashboard` - Dashboard stats
- `GET/POST /api/staff` - Staff management
- `PUT/DELETE /api/staff/:id` - Update/delete staff
- `GET /api/areas` - Cleaning areas list
- `GET /api/tasks` - Task list (filterable by area + date)
- `POST /api/tasks/:id/complete` - Mark task complete
- `POST /api/tasks/:id/uncomplete` - Mark task incomplete
- `POST /api/tasks/complete-all` - Complete all tasks for an area
- `GET/POST /api/assignments` - Assignments management
- `DELETE /api/assignments/:id` - Remove assignment
- `GET/POST /api/issues` - Issue reporting (GET supports ?assignedToId filter)
- `PATCH /api/issues/:id/assign` - Assign issue to staff member (notifies assignee)
- `PATCH /api/issues/:id/complete` - Staff marks issue done with notes (notifies supervisors)
- `PATCH /api/issues/:id/images` - Attach before/after photos to issue
- `POST /api/issues/:id/resolve` - Supervisor resolves issue
- `GET /api/task-types` - List all task type templates (auto-seeded with 14 defaults)
- `POST /api/task-types` - Create a new task type template
- `PUT /api/task-types/:id` - Update a task type (name, order, active)
- `DELETE /api/task-types/:id` - Delete a task type template
- `POST /api/task-types/reorder` - Reorder task types by dragging
- `GET /api/notifications?staffId=X` - List notifications for a user
- `PATCH /api/notifications/:id/read` - Mark single notification read
- `POST /api/notifications/mark-all-read` - Mark all read for a user
- `POST /api/storage/uploads/request-url` - Request presigned GCS upload URL
- `GET /api/storage/objects/*` - Serve uploaded objects

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   ├── api-server/         # Express API server
│   └── marvol-cleaning/    # React + Vite frontend
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts
│   └── src/seed.ts         # Database seed (staff + areas)
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## Database Schema

- `staff` - Staff members (name, role, phone, email, active)
- `areas` - Cleaning areas (name, terminal, location, sort_order)
- `task_types` - Task type templates (name, order, active); auto-seeded with 14 standard tasks on first GET
- `tasks` - Daily tasks per area (auto-generated from active task_types on first area access per day)
- `assignments` - Staff assignments to areas by date
- `issues` - Issue reports (area, severity, assigned_to_id, completion_notes, before/after image paths)
- `notifications` - In-app notifications (staffId, issueId, type, message, isRead)

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. This means:

- **Always typecheck from the root** — run `pnpm run typecheck` (which runs `tsc --build --emitDeclarationOnly`). This builds the full dependency graph so that cross-package imports resolve correctly. Running `tsc` inside a single package will fail if its dependencies haven't been built yet.
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck; actual JS bundling is handled by esbuild/tsx/vite...etc, not `tsc`.
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array. `tsc --build` uses this to determine build order and skip up-to-date packages.

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages that define it
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references
- `pnpm --filter @workspace/scripts run seed` — seed the database with initial data

## Seeding

Run `pnpm --filter @workspace/scripts run seed` to populate:
- 13 staff members (1 admin + 2 supervisors + 10 cleaning staff)
- 7 cleaning areas at MCO Airport
