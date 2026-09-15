/**
 * Interview Scheduling State Machine
 * State machine for managing interview scheduling workflow
 */

import { addObservabilityEntry, generateId, now, readStore, writeStore } from '../../models/store.js';
import type { Application } from '../../models/store.js';

// State definition
export interface InterviewSchedulingState {
  // Core identifiers
  applicationId: string;
  candidateId: string;
  jobId: string;
  companyId: string;
  
  // Participants
  interviewerIds: string[];
  
  // Scheduling data
  proposedTimes: string[];  // ISO date strings
  selectedTime: string | null;
  durationMinutes: number;
  location: string;  // video link or physical address
  
  // State tracking
  currentState: InterviewState;
  retryCount: number;
  maxRetries: number;
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

export type InterviewState =
  | 'init'
  | 'collecting_availability'
  | 'finding_slot'
  | 'sending_invites'
  | 'confirmed'
  | 'cancelled'
  | 'reschedule_requested'
  | 'completed'
  | 'error';

// Initial state factory
export function createInitialState(
  applicationId: string,
  candidateId: string,
  jobId: string,
  companyId: string,
  interviewerIds: string[]
): InterviewSchedulingState {
  const nowStr = now();
  return {
    applicationId,
    candidateId,
    jobId,
    companyId,
    interviewerIds,
    proposedTimes: [],
    selectedTime: null,
    durationMinutes: 60,
    location: '',
    currentState: 'init',
    retryCount: 0,
    maxRetries: 3,
    error: null,
    calendarEventId: null,
    reminderSent24h: false,
    reminderSent1h: false,
    confirmationReceived: false,
    feedbackReceived: false,
    thankYouSent: false,
    createdAt: nowStr,
    updatedAt: nowStr,
  };
}

// State machine definition
type StateNode = (state: InterviewSchedulingState) => Promise<Partial<InterviewSchedulingState>>;

interface StateMachine {
  states: Record<InterviewState, StateNode>;
  transitions: Record<InterviewState, InterviewState[]>;
  initial: InterviewState;
  finalStates: InterviewState[];
}

// Node implementations
async function initNode(state: InterviewSchedulingState): Promise<Partial<InterviewSchedulingState>> {
  const store = await readStore();
  
  // Validate application exists
  const application = store.applications.find((a: Application) => a.id === state.applicationId);
  if (!application) {
    return {
      currentState: 'error',
      error: 'Application not found',
    };
  }
  
  // Validate candidate exists
  const candidate = store.applicants.find((a: any) => a.id === state.candidateId);
  if (!candidate) {
    return {
      currentState: 'error',
      error: 'Candidate not found',
    };
  }
  
  // Validate job exists
  const job = store.jobs.find((j: any) => j.id === state.jobId);
  if (!job) {
    return {
      currentState: 'error',
      error: 'Job not found',
    };
  }
  
  // Log init
  await addObservabilityEntry({
    id: generateId(),
    timestamp: now(),
    action: 'state_transition',
    entityType: 'Interview',
    entityId: state.applicationId,
    userId: 'system',
    details: { from: 'init', to: 'collecting_availability', applicationId: state.applicationId },
    outcome: 'success',
  });
  
  return {
    currentState: 'collecting_availability',
    updatedAt: now(),
  };
}

async function collectingAvailabilityNode(
  state: InterviewSchedulingState
): Promise<Partial<InterviewSchedulingState>> {
  // In a real implementation, this would:
  // 1. Send availability request to candidate
  // 2. Send availability request to all interviewers
  // 3. Wait for responses
  
  // For now, we'll simulate receiving proposed times
  // In production, this would integrate with calendar APIs
  
  // If we already have proposed times, move to finding_slot
  if (state.proposedTimes.length > 0) {
    return {
      currentState: 'finding_slot',
      updatedAt: now(),
    };
  }
  
  // If max retries reached without proposed times, cancel
  if (state.retryCount >= state.maxRetries) {
    await addObservabilityEntry({
      id: generateId(),
      timestamp: now(),
      action: 'scheduling_abandoned',
      entityType: 'Interview',
      entityId: state.applicationId,
      userId: 'system',
      details: { reason: 'max_retries_exceeded', retryCount: state.retryCount },
      outcome: 'failure',
    });
    
    return {
      currentState: 'cancelled',
      error: 'Maximum retry attempts exceeded for availability collection',
      updatedAt: now(),
    };
  }
  
  // Increment retry count and wait
  return {
    currentState: 'collecting_availability',
    retryCount: state.retryCount + 1,
    updatedAt: now(),
  };
}

async function findingSlotNode(
  state: InterviewSchedulingState
): Promise<Partial<InterviewSchedulingState>> {
  // Find overlapping availability
  // In production, this would check:
  // - Candidate's availability
  // - All interviewers' calendars
  // - Room/resources availability
  
  if (state.proposedTimes.length === 0) {
    return {
      currentState: 'collecting_availability',
      retryCount: 0,  // Reset retry count when going back to availability
      updatedAt: now(),
    };
  }
  
  // Select the first proposed time (in production, would find optimal overlap)
  const selectedTime = state.proposedTimes[0];
  
  await addObservabilityEntry({
    id: generateId(),
    timestamp: now(),
    action: 'state_transition',
    entityType: 'Interview',
    entityId: state.applicationId,
    userId: 'system',
    details: { from: 'finding_slot', to: 'sending_invites', selectedTime },
    outcome: 'success',
  });
  
  return {
    currentState: 'sending_invites',
    selectedTime,
    updatedAt: now(),
  };
}

async function sendingInvitesNode(
  state: InterviewSchedulingState
): Promise<Partial<InterviewSchedulingState>> {
  // In production, this would:
  // 1. Create calendar events for candidate and all interviewers
  // 2. Send email invitations
  // 3. Generate video conference link if remote
  
  if (!state.selectedTime) {
    return {
      currentState: 'error',
      error: 'No selected time for interview',
      updatedAt: now(),
    };
  }
  
  // Simulate calendar event creation
  const calendarEventId = `cal_${generateId()}`;
  const videoLink = `https://meet.example.com/interview-${calendarEventId}`;
  
  // Update application status
  const store = await readStore();
  const appIndex = store.applications.findIndex((a: Application) => a.id === state.applicationId);
  if (appIndex !== -1) {
    store.applications[appIndex].status = 'interview scheduled';
    store.applications[appIndex].updatedAt = now();
    await writeStore(store);
  }
  
  await addObservabilityEntry({
    id: generateId(),
    timestamp: now(),
    action: 'state_transition',
    entityType: 'Interview',
    entityId: state.applicationId,
    userId: 'system',
    details: {
      from: 'sending_invites',
      to: 'confirmed',
      calendarEventId,
      selectedTime: state.selectedTime,
    },
    outcome: 'success',
  });
  
  return {
    currentState: 'confirmed',
    calendarEventId,
    location: videoLink,
    updatedAt: now(),
  };
}

async function confirmedNode(
  state: InterviewSchedulingState
): Promise<Partial<InterviewSchedulingState>> {
  // Interview is confirmed, waiting for completion
  // This is a terminal state until something triggers reschedule or completion
  
  return {
    currentState: 'confirmed',
    updatedAt: now(),
  };
}

async function cancelledNode(
  state: InterviewSchedulingState
): Promise<Partial<InterviewSchedulingState>> {
  // Update application status if needed
  const store = await readStore();
  const appIndex = store.applications.findIndex((a: Application) => a.id === state.applicationId);
  if (appIndex !== -1) {
    // Don't change status back, just log the cancellation
    await writeStore(store);
  }
  
  await addObservabilityEntry({
    id: generateId(),
    timestamp: now(),
    action: 'interview_cancelled',
    entityType: 'Interview',
    entityId: state.applicationId,
    userId: 'system',
    details: { reason: state.error || 'user_cancelled' },
    outcome: 'success',
  });
  
  return {
    currentState: 'cancelled',
    updatedAt: now(),
  };
}

async function rescheduleNode(
  state: InterviewSchedulingState
): Promise<Partial<InterviewSchedulingState>> {
  // Handle reschedule request
  await addObservabilityEntry({
    id: generateId(),
    timestamp: now(),
    action: 'state_transition',
    entityType: 'Interview',
    entityId: state.applicationId,
    userId: 'system',
    details: { from: 'confirmed', to: 'collecting_availability', reason: 'reschedule_requested' },
    outcome: 'success',
  });
  
  return {
    currentState: 'collecting_availability',
    proposedTimes: [],  // Reset proposed times
    selectedTime: null,
    retryCount: 0,
    calendarEventId: null,
    updatedAt: now(),
  };
}

async function completedNode(
  state: InterviewSchedulingState
): Promise<Partial<InterviewSchedulingState>> {
  // Mark interview as completed
  await addObservabilityEntry({
    id: generateId(),
    timestamp: now(),
    action: 'interview_completed',
    entityType: 'Interview',
    entityId: state.applicationId,
    userId: 'system',
    details: {
      duration: state.durationMinutes,
      feedbackReceived: state.feedbackReceived,
      selectedTime: state.selectedTime,
    },
    outcome: 'success',
  });
  
  return {
    currentState: 'completed',
    updatedAt: now(),
  };
}

async function errorNode(
  state: InterviewSchedulingState
): Promise<Partial<InterviewSchedulingState>> {
  await addObservabilityEntry({
    id: generateId(),
    timestamp: now(),
    action: 'agent_failed',
    entityType: 'Interview',
    entityId: state.applicationId,
    userId: 'system',
    details: { error: state.error, state: state.currentState },
    outcome: 'failure',
  });
  
  return {
    currentState: 'error',
    updatedAt: now(),
  };
}

// State machine definition
const interviewStateMachine: StateMachine = {
  states: {
    init: initNode,
    collecting_availability: collectingAvailabilityNode,
    finding_slot: findingSlotNode,
    sending_invites: sendingInvitesNode,
    confirmed: confirmedNode,
    cancelled: cancelledNode,
    reschedule_requested: rescheduleNode,
    completed: completedNode,
    error: errorNode,
  },
  transitions: {
    init: ['collecting_availability', 'error'],
    collecting_availability: ['finding_slot', 'cancelled', 'error'],
    finding_slot: ['sending_invites', 'collecting_availability', 'cancelled', 'error'],
    sending_invites: ['confirmed', 'collecting_availability', 'error'],
    confirmed: ['reschedule_requested', 'completed', 'cancelled'],
    cancelled: [], // Terminal state
    reschedule_requested: ['collecting_availability'],
    completed: [], // Terminal state
    error: [], // Terminal state
  },
  initial: 'init',
  finalStates: ['cancelled', 'completed', 'error'],
};

// State machine executor
class InterviewSchedulingMachine {
  private machine: StateMachine;

  constructor(machine: StateMachine) {
    this.machine = machine;
  }

  async execute(initialState: InterviewSchedulingState): Promise<InterviewSchedulingState> {
    let currentState = initialState;
    
    while (!this.machine.finalStates.includes(currentState.currentState)) {
      const node = this.machine.states[currentState.currentState];
      
      if (!node) {
        throw new Error(`No handler for state: ${currentState.currentState}`);
      }
      
      const updates = await node(currentState);
      currentState = { ...currentState, ...updates } as InterviewSchedulingState;
      
      // Safety check to prevent infinite loops
      if (updates.currentState === currentState.currentState && 
          currentState.currentState !== 'init') {
        // We're stuck, exit
        break;
      }
    }
    
    return currentState;
  }

  async transition(state: InterviewSchedulingState, newState: InterviewState): Promise<InterviewSchedulingState> {
    // Validate transition
    const allowedTransitions = this.machine.transitions[state.currentState];
    if (!allowedTransitions.includes(newState)) {
      throw new Error(
        `Invalid transition from ${state.currentState} to ${newState}. ` +
        `Allowed: ${allowedTransitions.join(', ') || 'none (terminal state)'}`
      );
    }

    const node = this.machine.states[newState];
    if (!node) {
      throw new Error(`No handler for state: ${newState}`);
    }

    const updates = await node({ ...state, currentState: newState });
    return { ...state, ...updates, currentState: newState } as InterviewSchedulingState;
  }
}

const machine = new InterviewSchedulingMachine(interviewStateMachine);

// Convenience functions
export async function startInterviewScheduling(
  applicationId: string,
  candidateId: string,
  jobId: string,
  companyId: string,
  interviewerIds: string[],
  proposedTimes?: string[]
): Promise<InterviewSchedulingState> {
  const initialState = createInitialState(
    applicationId,
    candidateId,
    jobId,
    companyId,
    interviewerIds
  );
  
  if (proposedTimes?.length) {
    initialState.proposedTimes = proposedTimes;
  }
  
  return await machine.execute(initialState);
}

export async function requestReschedule(
  currentState: InterviewSchedulingState
): Promise<InterviewSchedulingState> {
  return await machine.transition(currentState, 'reschedule_requested');
}

export async function cancelInterview(
  currentState: InterviewSchedulingState,
  reason?: string
): Promise<InterviewSchedulingState> {
  const updatedState: InterviewSchedulingState = {
    ...currentState,
    error: reason || 'User cancelled',
  };
  
  return await machine.transition(updatedState, 'cancelled');
}

export async function completeInterview(
  currentState: InterviewSchedulingState
): Promise<InterviewSchedulingState> {
  return await machine.transition(currentState, 'completed');
}

export function getAvailableTransitions(state: InterviewSchedulingState): InterviewState[] {
  return interviewStateMachine.transitions[state.currentState];
}

export function isTerminalState(state: InterviewState): boolean {
  return interviewStateMachine.finalStates.includes(state);
}
