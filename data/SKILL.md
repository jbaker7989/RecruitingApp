---
name: data
description: JSON file-based data persistence, observability logging, hire tracking, and data access patterns
---

# Data Skills

This skill governs all data layer operations for the New Fronteir Recruiting application.

## Core Functions

### JSON File-Based Persistence
- All data stored as JSON files in `data/` directory
- No database required — file-based storage for development and prototyping
- Each entity type has its own JSON file
- Atomic read/write operations with file locking

### Data Files
| File | Contents |
|------|----------|
| `data/companies.json` | All company records |
| `data/jobs.json` | All job postings |
| `data/applicants.json` | All applicant profiles (includes hireRecords) |
| `data/applications.json` | All application records |
| `data/hires.json` | All hire records |
| `data/users.json` | All user/auth records |
| `data/observability.json` | All transaction logs |
| `data/imports/` | Archived imported files |

### Observability & Logging
- Every transaction logged to `data/observability.json`
- Fields: `id`, `timestamp`, `action`, `entityType`, `entityId`, `userId`, `details`, `outcome`
- Used for tracking, auditing, and debugging
- Supports role-based action logging
- Entity types now include: `Company`, `Job`, `Applicant`, `Application`, `User`, `Hire`

### Hire Tracking Data
- `data/hires.json` stores all hire records
- Each hire record: `id`, `applicantId`, `companyId`, `jobPostingId`, `hireDate`, `positionTitle`, `status`, `notifiedEmployer`
- Applicant profiles have `hireRecords` array referencing hire IDs
- Company records track new hire count and list
- Employer notifications tracked via `notifiedEmployer` flag

### Import Data
- `data/imports/` directory stores archived import files
- Import metadata tracked with timestamps, company ID, file format, row count

### Data Access Patterns
- Read: Load JSON file, parse, return data
- Write: Validate input, append/merge to JSON file, write back
- Update: Find record by ID, update fields, write back
- Delete: Filter out record by ID, write back

### Authentication Storage
- `data/users.json` — Username/password (encrypted), role, OAuth stubs
- Password hashing for all user credentials
- OAuth provider stubs ready for future integration

### MCP Layer
- MCP-compatible API endpoints for external/internal interaction
- JSON-based request/response format
- Supports model context protocol queries

## File Operations
- Read entire JSON file on access
- Write entire JSON file on update
- Parse and validate on every read
- Create file if it doesn't exist
- Backup on every write

## Observability Schema
```json
{
  "id": "uuid",
  "timestamp": "ISO-8601",
  "action": "create|read|update|delete|status_change|login|apply|import|hire|close",
  "entityType": "Company|Job|Applicant|Application|User|Hire",
  "entityId": "uuid",
  "userId": "uuid",
  "details": {},
  "outcome": "success|failure"
}
```

## Hire Record Schema
```json
{
  "id": "uuid",
  "applicantId": "uuid",
  "companyId": "uuid",
  "jobPostingId": "uuid",
  "hireDate": "ISO-8601",
  "positionTitle": "string",
  "status": "active|probation|terminated",
  "notifiedEmployer": boolean,
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

## Roles & Access
All data operations respect role-based access:
- `applicant`: Read own data, create applications, view own hire records
- `recruiter`: Read applications, update statuses, view hire statuses
- `hiring-manager`: Full CRUD on jobs/companies, create hires, view company hires
- `member-services`: Full system access, all hire records
