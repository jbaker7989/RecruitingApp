"""
Candidate Screening Service — FastAPI wrapper around the LangGraph workflow.
Exposes REST endpoints for the TypeScript backend to invoke parallel candidate screening.

Usage:
    uvicorn candidate_screening_service:app --reload --port 8001
    # Or: python candidate_screening_service.py

Requires: OPENAI_API_KEY in environment.
"""

import os
import uuid
import threading
import time
from dataclasses import dataclass, field
from typing import Annotated, Literal, Sequence

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import uvicorn

from langgraph.graph import StateGraph, END, Send
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import JsonOutputParser

# ─── Config ───────────────────────────────────────────────────────────────────

SERVICE_PORT = int(os.getenv("CANDIDATE_SCREENING_PORT", "8001"))
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    raise RuntimeError("OPENAI_API_KEY environment variable is required")

# ─── LLM Setup ────────────────────────────────────────────────────────────────

llm = ChatOpenAI(model="gpt-4o", temperature=0)

skill_prompt = ChatPromptTemplate.from_messages([
    ("system",
     "You are an HR resume parser. Extract structured information from a resume.\n"
     "Return ONLY valid JSON with this exact shape:\n"
     '{"skills": ["skill1", "skill2", ...], "experience_years": number, '
     '"education": [{"degree": "...", "field": "...", "institution": "..."}]}'),
    ("human", "{resume_text}")
])
skill_chain = skill_prompt | llm | JsonOutputParser()

score_prompt = ChatPromptTemplate.from_messages([
    ("system",
     "You are an HR matching specialist. Score a candidate against a job posting.\n"
     "Be strict but fair. Return ONLY valid JSON:\n\n"
     '{"skill_score": 0-100, "experience_score": 0-100, "education_score": 0-100, '
     '"overall_score": 0-100, "reasoning": "concise explanation"}\n\n'
     "Scoring rubric:\n"
     "- skill_score: overlap between required_skills and candidate skills (semantic matching counts)\n"
     "- experience_score: does candidate meet or exceed required years?\n"
     "- education_score: does education align with qualifications?\n"
     "- overall_score: weighted average (skills 50%, experience 30%, education 20%)"),
    ("human",
     "JOB POSTING:\n{job_posting}\n\n"
     "CANDIDATE RESUME:\n{resume_text}\n\n"
     "CANDIDATE PROFILE:\n{applicant}")
])
score_chain = score_prompt | llm | JsonOutputParser()

rank_prompt = ChatPromptTemplate.from_messages([
    ("system",
     "You are an HR ranking specialist. Rank candidates by overall score.\n"
     "Return ONLY valid JSON:\n"
     '{"ranked": [{"applicant_id": "...", "name": "...", "overall_score": 85, "reason": "..."}, ...]}\n'
     "Sort by overall_score descending. Include all candidates passed in."),
    ("human", "Candidates:\n{candidates}")
])
rank_chain = rank_prompt | llm | JsonOutputParser()

output_prompt = ChatPromptTemplate.from_messages([
    ("system",
     "You are an HR report generator. Create a professional hiring report in markdown.\n"
     "Include a summary table and brief analysis."),
    ("human", "Ranked candidates:\n{ranked}\n\nJob Posting:\n{job_title}")
])
output_chain = output_prompt | llm | (lambda msg: msg.content)

# ─── LangGraph: Single-Candidate Subgraph ───────────────────────────────────────


@dataclass
class CandidateState:
    """Per-candidate state used inside the parallel subgraph."""
    applicant_id: str = ""
    applicant_name: str = ""
    resume_text: str = ""
    job_posting: dict = field(default_factory=dict)
    # Parsed
    parsed_skills: list = field(default_factory=list)
    parsed_experience_years: int = 0
    parsed_education: list = field(default_factory=list)
    # Scores
    skill_score: float = 0.0
    experience_score: float = 0.0
    education_score: float = 0.0
    overall_score: float = 0.0
    scoring_reasoning: str = ""
    # Pass/fail
    passed_threshold: bool = False


def parse_resume(state: CandidateState) -> CandidateState:
    """Parse raw resume text into structured data via LLM."""
    result = skill_chain.invoke({"resume_text": state.resume_text})
    state.parsed_skills = result.get("skills", [])
    state.parsed_experience_years = result.get("experience_years", 0)
    state.parsed_education = result.get("education", [])
    return state


def match_score(state: CandidateState) -> CandidateState:
    """LLM-based semantic scoring against the job posting."""
    job_str = "\n".join([
        f"title: {state.job_posting.get('jobTitle', '')}",
        f"required_skills: {state.job_posting.get('requiredSkills', [])}",
        f"required_experience: {state.job_posting.get('requiredExperience', 0)} years",
        f"qualifications: {state.job_posting.get('qualifications', [])}",
        f"requirements: {state.job_posting.get('requirements', [])}",
    ])
    applicant_str = (
        f"skills: {state.parsed_skills}, "
        f"experience: {state.parsed_experience_years} yrs, "
        f"education: {state.parsed_education}"
    )
    result = score_chain.invoke({
        "job_posting": job_str,
        "resume_text": state.resume_text,
        "applicant": applicant_str,
    })
    state.skill_score = result.get("skill_score", 0)
    state.experience_score = result.get("experience_score", 0)
    state.education_score = result.get("education_score", 0)
    state.overall_score = result.get("overall_score", 0)
    state.scoring_reasoning = result.get("reasoning", "")
    state.passed_threshold = state.overall_score >= 70
    return state


def build_candidate_subgraph():
    g = StateGraph(CandidateState)
    g.add_node("parse_resume", parse_resume)
    g.add_node("match_score", match_score)
    g.set_entry_point("parse_resume")
    g.add_edge("parse_resume", "match_score")
    g.add_edge("match_score", END)
    return g.compile()


# ─── LangGraph: Root Graph ─────────────────────────────────────────────────────


@dataclass
class ScreeningState:
    """Root graph state."""
    job_posting: dict = field(default_factory=dict)
    candidates: list = field(default_factory=list)
    # Fan-in: each parallel process_candidate appends its result here
    candidate_results: list = field(default_factory=list)
    # Final outputs
    ranked_candidates: list = field(default_factory=list)
    output_report: str = ""
    # Stats (populated by aggregate_results)
    total_candidates: int = 0
    passed_count: int = 0
    failed_count: int = 0


def dispatch_candidates(state: ScreeningState) -> list[Send]:
    """
    Fan-out: dispatch each candidate to the subgraph in parallel via Send API.
    Each Send carries a CandidateState dict; langgraph runs process_candidate
    once per Send, in parallel.
    """
    return [
        Send(
            "process_candidate",
            CandidateState(
                applicant_id=c["id"],
                applicant_name=c["name"],
                resume_text=c["resume_text"],
                job_posting=state.job_posting,
            ).__dict__,
        )
        for c in state.candidates
    ]


def aggregate_results(state: ScreeningState) -> ScreeningState:
    """
    Fan-in: langgraph passes all subgraph results via state.candidate_results.
    Compute aggregate statistics here.
    """
    results = state.candidate_results
    state.total_candidates = len(results)
    state.passed_count = sum(1 for r in results if r.get("passed_threshold", False))
    state.failed_count = state.total_candidates - state.passed_count
    return state


def rank_candidates(state: ScreeningState) -> ScreeningState:
    """Rank all passed candidates by overall score using LLM."""
    passed = [r for r in state.candidate_results if r.get("passed_threshold", False)]
    if not passed:
        state.ranked_candidates = []
        return state

    candidates_str = "\n".join([
        f"- id: {r['applicant_id']}, name: {r['applicant_name']}, "
        f"score: {r['overall_score']}, reasoning: {r.get('scoring_reasoning', '')}"
        for r in passed
    ])
    result = rank_chain.invoke({"candidates": candidates_str})
    ranked = result.get("ranked", [])

    # Merge in per-dimension scores from the subgraph
    score_map = {r["applicant_id"]: r for r in state.candidate_results}
    for r in ranked:
        aid = r.get("applicant_id")
        if aid in score_map:
            s = score_map[aid]
            r["skill_score"] = s.get("skill_score", 0)
            r["experience_score"] = s.get("experience_score", 0)
            r["education_score"] = s.get("education_score", 0)
            r["scoring_reasoning"] = s.get("scoring_reasoning", "")

    state.ranked_candidates = ranked
    return state


def generate_report(state: ScreeningState) -> ScreeningState:
    """Generate final markdown hiring report."""
    if not state.ranked_candidates:
        state.output_report = (
            f"# Screening Report\n\n"
            f"**Job:** {state.job_posting.get('jobTitle', 'Unknown')}\n\n"
            f"**Results:** 0 candidates passed the threshold (70/100).\n"
        )
        return state

    ranked_str = "\n".join([
        f"- **{c['name']}** (Score: {c['overall_score']}/100)\n"
        f"  - Skills: {c.get('skill_score', 0)}, "
        f"Experience: {c.get('experience_score', 0)}, "
        f"Education: {c.get('education_score', 0)}\n"
        f"  - {c.get('reason', c.get('scoring_reasoning', ''))}"
        for c in state.ranked_candidates
    ])
    state.output_report = output_chain.invoke({
        "ranked": ranked_str,
        "job_title": state.job_posting.get("jobTitle", ""),
    })
    return state


def build_screening_graph():
    """
    Root graph:

      dispatch_candidates ──[Send list]──▶ [process_candidate × N in parallel]
                                                 │
                                                 ▼ fan-in via state.candidate_results
                                            aggregate_results
                                                 │
                                                 ▼
                                            rank_candidates
                                                 │
                                                 ▼
                                            generate_report ──▶ END
    """
    candidate_subgraph = build_candidate_subgraph()

    g = StateGraph(ScreeningState)
    g.add_node("dispatch_candidates", dispatch_candidates)
    g.add_node("process_candidate", candidate_subgraph)
    g.add_node("aggregate_results", aggregate_results)
    g.add_node("rank_candidates", rank_candidates)
    g.add_node("generate_report", generate_report)

    g.set_entry_point("dispatch_candidates")

    # Fan-out: dispatch_candidates returns list[Send] → langgraph fans out
    g.add_conditional_edges(
        "dispatch_candidates",
        lambda x: x,  # passthrough — the Send list itself is the routing signal
        {"process_candidate": "process_candidate"},
    )

    # Fan-in: all process_candidate results land in state.candidate_results
    g.add_edge("process_candidate", "aggregate_results")
    g.add_edge("aggregate_results", "rank_candidates")
    g.add_edge("rank_candidates", "generate_report")
    g.add_edge("generate_report", END)

    return g.compile()


# ─── In-Memory Job Store ──────────────────────────────────────────────────────
# Thread-safe store for screening job status/results.
# Production: replace with Redis, PostgreSQL, or your persistence layer.

_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()


def _run_screening(job_id: str, initial_state: ScreeningState) -> None:
    """Background worker: run the graph and store results."""
    try:
        graph = build_screening_graph()
        result = graph.invoke(initial_state)

        with _jobs_lock:
            _jobs[job_id].update({
                "status": "completed",
                "total_candidates": result.total_candidates,
                "passed_count": result.passed_count,
                "failed_count": result.failed_count,
                "ranked_candidates": result.ranked_candidates,
                "output_report": result.output_report,
                "completed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            })
    except Exception as exc:
        with _jobs_lock:
            _jobs[job_id].update({
                "status": "failed",
                "error": str(exc),
            })


# ─── FastAPI App ──────────────────────────────────────────────────────────────

app = FastAPI(
    title="Candidate Screening Service",
    description="LangGraph-powered parallel candidate screening workflow",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Request / Response Models ─────────────────────────────────────────────────

class CandidateInput(BaseModel):
    id: str = Field(..., description="Application or applicant ID")
    name: str = Field(..., description="Full name for display")
    resume_text: str = Field(..., description="Raw resume text to parse and score")


class ScreeningRequest(BaseModel):
    job_id: str = Field(..., description="Job posting ID (for tracking)")
    job_posting: dict = Field(
        ...,
        description=(
            "Job posting dict. Required keys: jobTitle, requiredSkills, "
            "requiredExperience, qualifications, requirements"
        ),
    )
    candidates: list[CandidateInput] = Field(
        ...,
        min_length=1,
        description="List of candidates to screen (1–100)",
    )
    score_threshold: float = Field(
        default=70.0,
        ge=0,
        le=100,
        description="Minimum score to pass (default 70)",
    )


class CandidateResult(BaseModel):
    applicant_id: str
    applicant_name: str
    overall_score: float
    skill_score: float
    experience_score: float
    education_score: float
    scoring_reasoning: str
    passed_threshold: bool


class ScreeningJobResponse(BaseModel):
    job_id: str
    status: str
    total_candidates: int | None = None
    passed_count: int | None = None
    failed_count: int | None = None
    ranked_candidates: list[dict] | None = None
    output_report: str | None = None
    error: str | None = None
    created_at: str | None = None
    completed_at: str | None = None


# ─── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "service": "candidate-screening"}


@app.post("/screening/screen", response_model=ScreeningJobResponse)
async def screen_candidates(
    request: ScreeningRequest,
    background_tasks: BackgroundTasks,
) -> ScreeningJobResponse:
    """
    Submit a batch screening job.

    The job runs asynchronously in the background.
    Poll GET /screening/jobs/{job_id} for status and results.
    """
    job_id = str(uuid.uuid4())
    created_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    with _jobs_lock:
        _jobs[job_id] = {
            "job_id": job_id,
            "status": "queued",
            "total_candidates": len(request.candidates),
            "passed_count": None,
            "failed_count": None,
            "ranked_candidates": None,
            "output_report": None,
            "error": None,
            "created_at": created_at,
            "completed_at": None,
        }

    initial_state = ScreeningState(
        job_posting=request.job_posting,
        candidates=[c.model_dump() for c in request.candidates],
    )

    # Run in background — langgraph fan-out is CPU/IO bound (LLM calls)
    background_tasks.add_task(_run_screening, job_id, initial_state)

    return ScreeningJobResponse(**_jobs[job_id])


@app.get("/screening/jobs/{job_id}", response_model=ScreeningJobResponse)
async def get_screening_job(job_id: str) -> ScreeningJobResponse:
    """Poll for job status. Returns results when status is 'completed'."""
    with _jobs_lock:
        job = _jobs.get(job_id)

    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    return ScreeningJobResponse(**job)


@app.get("/screening/jobs/{job_id}/result")
async def get_screening_result(job_id: str) -> dict:
    """Shortcut: get full results only (404 until completed)."""
    with _jobs_lock:
        job = _jobs.get(job_id)

    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    if job["status"] != "completed":
        raise HTTPException(
            status_code=202,
            detail={
                "message": f"Job is {job['status']}, not ready yet",
                "status": job["status"],
            },
        )

    return {
        "job_id": job_id,
        "total_candidates": job["total_candidates"],
        "passed_count": job["passed_count"],
        "failed_count": job["failed_count"],
        "ranked_candidates": job["ranked_candidates"],
        "output_report": job["output_report"],
        "completed_at": job["completed_at"],
    }


@app.delete("/screening/jobs/{job_id}")
async def cancel_screening_job(job_id: str) -> dict:
    """Cancel or discard a queued/running job."""
    with _jobs_lock:
        job = _jobs.pop(job_id, None)

    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    return {"job_id": job_id, "status": "cancelled"}


# ─── Dev: run directly ─────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run(
        "candidate_screening_service:app",
        host="0.0.0.0",
        port=SERVICE_PORT,
        reload=True,
    )
