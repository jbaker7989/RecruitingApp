# Feature: Interview Scheduling

**Story ID:** IS-001  
**Priority:** P1 (High)  
**Points:** 8  
**Phase:** 1 - Foundation

## Overview

The Interview Scheduling feature implements a state machine workflow that automates the coordination of interview scheduling between candidates, interviewers, and the calendar system.

## Technical Implementation

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Interview Scheduling State Machine            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────┐     ┌────────────────────┐     ┌──────────────┐      │
│  │ init │────▶│ collecting_        │────▶│ finding_     │      │
│  └──────┘     │ availability      │     │ slot         │      │
│                └────────────────────┘     └──────┬───────┘      │
│                       ▲     │                     │              │
│                       │     │ (reschedule)         ▼              │
│                       │     │              ┌──────────────┐      │
│                       │     │              │ sending_     │      │
│                       │     │              │ invites      │      │
│                       │     │              └──────┬───────┘      │
│                       │     │                     │              │
│                       │     │                     ▼              │
│                       │     │              ┌──────────────┐      │
│                       │     │              │  confirmed   │──────┼──▶ (reschedule/cancel/complete)
│                       │     │              └──────────────┘      │
│                       │     │                                       │
│                       │     │ (cancel/max_retries)                  │
│                       │     └────────────────────▶  ┌──────────┐ │
│                       └─────────────────────────────▶│ cancelled│ │
│                                                       └──────────┘ │
│                                                       ┌──────────┐ │
│  ┌──────┐                                           │ completed │◀┘
│  │ error│───────────────────────────────────────────▶└──────────┘
│  └──────┘
└─────────────────────────────────────────────────────────────────┘
```

### State Definitions

| State | Description | Terminal? |
|-------|-------------|-----------|
| `init` | Validate application, candidate, job exist | No |
| `collecting_availability` | Request availability from candidate & interviewers | No |
| `finding_slot` | Find overlapping time slots | No |
| `sending_invites` | Create calendar events, send invitations | No |
| `confirmed` | Interview scheduled, awaiting interview | No |
| `reschedule_requested` | Reschedule triggered, returns to availability | No |
| `cancelled` | Interview cancelled | **Yes** |
| `completed` | Interview finished | **Yes** |
| `error` | Error occurred | **Yes** |

### State Machine

```typescript
interface InterviewSchedulingState {
  // Core identifiers
  applicationId: string;
  candidateId: string;
  jobId: string;
  companyId: string;
  
  // Participants
  interviewerIds: string[];
  
  // Scheduling data
  proposedTimes: string[];  // ISO 8601
  selectedTime: string | null;
  durationMinutes: number;
  location: string;  // Video link or address
  
  // State tracking
  currentState: InterviewState;
  retryCount: number;
  maxRetries: number;  // Default: 3
  error: string | null;
  
  // Calendar
  calendarEventId: string | null;
  
  // Notifications
  reminderSent24h: boolean;
  reminderSent1h: boolean;
  confirmationReceived: boolean;
  
  // Post-interview
  feedbackReceived: boolean;
  thankYouSent: boolean;
  
  // Metadata
  createdAt: string;
  updatedAt: string;
}
```

### Transitions

| From State | Allowed Transitions |
|------------|-------------------|
| `init` | `collecting_availability`, `error` |
| `collecting_availability` | `finding_slot`, `cancelled`, `error` |
| `finding_slot` | `sending_invites`, `collecting_availability`, `cancelled`, `error` |
| `sending_invites` | `confirmed`, `collecting_availability`, `error` |
| `confirmed` | `reschedule_requested`, `completed`, `cancelled` |
| `reschedule_requested` | `collecting_availability` |
| `cancelled` | *(terminal)* |
| `completed` | *(terminal)* |
| `error` | *(terminal)* |

## API Endpoints

### POST /api/agents/scheduling/interview

Start the interview scheduling workflow.

**Request:**
```json
{
  "applicationId": "app_abc123",
  "interviewerIds": ["user_xyz", "user_aaa"],
  "proposedTimes": [
    "2024-03-15T10:00:00Z",
    "2024-03-15T14:00:00Z",
    "2024-03-16T09:00:00Z"
  ],
  "durationMinutes": 60
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "applicationId": "app_abc123",
    "candidateId": "cand_xyz",
    "jobId": "job_123",
    "companyId": "comp_abc",
    "interviewerIds": ["user_xyz", "user_aaa"],
    "proposedTimes": ["2024-03-15T10:00:00Z", "2024-03-15T14:00:00Z", "2024-03-16T09:00:00Z"],
    "selectedTime": "2024-03-15T10:00:00Z",
    "durationMinutes": 60,
    "location": "https://meet.example.com/interview-cal_abc123",
    "currentState": "confirmed",
    "calendarEventId": "cal_abc123",
    "createdAt": "2024-03-10T12:00:00Z",
    "updatedAt": "2024-03-10T12:00:05Z"
  }
}
```

### POST /api/agents/scheduling/reschedule

Request reschedule (transitions from `confirmed` to `reschedule_requested`).

**Request:**
```json
{
  "currentState": { /* full state object from previous call */ }
}
```

**Response:** Updated state with `currentState: "collecting_availability"`

### POST /api/agents/scheduling/cancel

Cancel an interview.

**Request:**
```json
{
  "currentState": { /* full state object */ },
  "reason": "Candidate withdrew from process"
}
```

**Response:** State with `currentState: "cancelled"`

### POST /api/agents/scheduling/complete

Mark interview as completed.

**Request:**
```json
{
  "currentState": { /* full state object */ }
}
```

**Response:** State with `currentState: "completed"`

## User Stories

### US-IS-001: Recruiter Initiates Scheduling
**As a** recruiter  
**I want to** start the scheduling workflow with proposed times  
**So that** the system handles coordination automatically

**Acceptance Criteria:**
- [ ] Validate application exists
- [ ] Validate candidate exists
- [ ] Validate job exists
- [ ] Accept proposed time slots
- [ ] Return current state after init

### US-IS-002: System Finds Available Slot
**As a** system  
**I want to** find a mutually available time slot  
**So that** interviews can be scheduled without conflicts

**Acceptance Criteria:**
- [ ] Check all interviewer calendars
- [ ] Check candidate availability
- [ ] Select optimal time slot
- [ ] Handle no-availability gracefully

### US-IS-003: System Creates Calendar Events
**As a** system  
**I want to** create calendar invites for all participants  
**So that** everyone is notified of the interview

**Acceptance Criteria:**
- [ ] Generate unique calendar event ID
- [ ] Create video conference link
- [ ] Update application status
- [ ] Log observability event

### US-IS-004: Candidate Requests Reschedule
**As a** candidate  
**I want to** request a different interview time  
**So that** I can find a time that works for me

**Acceptance Criteria:**
- [ ] Transition from confirmed to collecting_availability
- [ ] Clear selected time and calendar event
- [ ] Reset retry count
- [ ] Log reschedule request

### US-IS-005: Interview Marked Complete
**As a** interviewer  
**I want to** mark the interview as completed  
**So that** the system knows the interview happened

**Acceptance Criteria:**
- [ ] Transition to completed state
- [ ] Log completion event
- [ ] Enable feedback collection

## Future Integrations

### Calendar Integration (Phase 2)
- [ ] Google Calendar API
- [ ] Microsoft Outlook API
- [ ] Apple iCal/CalDAV

### Notification Integration (Phase 2)
- [ ] Email notifications (SendGrid)
- [ ] SMS reminders (Twilio)
- [ ] In-app notifications

### Conflict Resolution (Phase 2)
- [ ] LLM-powered slot suggestion
- [ ] Multi-time slot voting
- [ ] Automatic reschedule detection
