"""
Candidate Screening LangGraph — Parallel Candidate Processing
Uses langgraph Send API for fan-out/fan-in parallel execution.
"""
from dataclasses import dataclass, field
from typing import Annotated, Literal, Sequence
from langgraph.graph import StateGraph, END, Send
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import JsonOutputParser
import json

# ─── LLM Setup ────────────────────────────────────────────────────────────────

llm = ChatOpenAI(model="gpt-4o", temperature=0)

skill_prompt = ChatPromptTemplate.from_messages([
    ("system", """You are an HR resume parser. Extract structured information from a resume.
Return ONLY valid JSON with this exact shape:
{
  "skills": ["skill1", "skill2", ...],
  "experience_years": number,
  "education": [{"degree": "...", "field": "...", "institution": "..."}]
}"""),
    ("human", "{resume_text}")
])
skill_chain = skill_prompt | llm | JsonOutputParser()

score_prompt = ChatPromptTemplate.from_messages([
    ("system", """You are an HR matching specialist. Score a candidate against a job posting.
Be strict but fair. Return ONLY valid JSON:

{
  "skill_score": 0-100,
  "experience_score": 0-100,
  "education_score": 0-100,
  "overall_score": 0-100,
  "reasoning": "concise explanation of each score"
}

Scoring rubric:
- skill_score: overlap between required_skills and candidate skills (semantic matching counts)
- experience_score: does candidate meet or exceed required years?
- education_score: does education align with qualifications?
- overall_score: weighted average (skills 50%, experience 30%, education 20%)"""),
    ("human", """JOB POSTING:\n{job_posting}\n\nCANDIDATE RESUME:\n{resume_text}\n\nCANDIDATE PROFILE:\n{applicant}""")
])
score_chain = score_prompt | llm | JsonOutputParser()

rank_prompt = ChatPromptTemplate.from_messages([
    ("system", """You are an HR ranking specialist. Rank candidates by overall score.
Return ONLY valid JSON:
{
  "ranked": [
    {"applicant_id": "...", "name": "...", "overall_score": 85, "reason": "..."},
    ...
  ]
}
Sort by overall_score descending. Include all candidates passed in."""),
    ("human", "Candidates:\n{candidates}")
])
rank_chain = rank_prompt | llm | JsonOutputParser()

output_prompt = ChatPromptTemplate.from_messages([
    ("system", """You are an HR report generator. Create a professional hiring report in markdown.
Include a summary table and brief analysis."""),
    ("human", "Ranked candidates:\n{ranked}\n\nJob Posting:\n{job_title}")
])
output_chain = output_prompt | llm | (lambda msg: msg.content)


# ─── Single-Candidate Subgraph State ─────────────────────────────────────────

@dataclass
class CandidateState:
    """State for a single candidate's processing subgraph."""
    applicant_id: str = ""
    applicant_name: str = ""
    resume_text: str = ""
    job_posting: dict = field(default_factory=dict)
    # Parsed
    parsed_skills: list[str] = field(default_factory=list)
    parsed_experience_years: int = 0
    parsed_education: list[dict] = field(default_factory=list)
    # Scores
    skill_score: float = 0.0
    experience_score: float = 0.0
    education_score: float = 0.0
    overall_score: float = 0.0
    scoring_reasoning: str = ""
    # Pass-through for fan-in
    passed_threshold: bool = False


# ─── Single-Candidate Subgraph Nodes ─────────────────────────────────────────

def parse_resume(state: CandidateState) -> CandidateState:
    """Parse raw resume text into structured data via LLM."""
    result = skill_chain.invoke({"resume_text": state.resume_text})
    state.parsed_skills = result.get("skills", [])
    state.parsed_experience_years = result.get("experience_years", 0)
    state.parsed_education = result.get("education", [])
    return state


def match_score(state: CandidateState) -> CandidateState:
    """LLM-based semantic scoring against job posting."""
    job_str = "\n".join([
        f"title: {state.job_posting.get('jobTitle','')}",
        f"required_skills: {state.job_posting.get('requiredSkills',[])}",
        f"required_experience: {state.job_posting.get('requiredExperience',0)} years",
        f"qualifications: {state.job_posting.get('qualifications',[])}",
        f"requirements: {state.job_posting.get('requirements',[])}"
    ])
    applicant_str = f"skills: {state.parsed_skills}, experience: {state.parsed_experience_years} yrs, education: {state.parsed_education}"

    result = score_chain.invoke({
        "job_posting": job_str,
        "resume_text": state.resume_text,
        "applicant": applicant_str
    })

    state.skill_score = result.get("skill_score", 0)
    state.experience_score = result.get("experience_score", 0)
    state.education_score = result.get("education_score", 0)
    state.overall_score = result.get("overall_score", 0)
    state.scoring_reasoning = result.get("reasoning", "")
    state.passed_threshold = state.overall_score >= 70
    return state


# ─── Build Single-Candidate Subgraph ─────────────────────────────────────────

def build_candidate_subgraph():
    """Subgraph for processing one candidate (runs in parallel for each candidate)."""
    g = StateGraph(CandidateState)
    g.add_node("parse_resume", parse_resume)
    g.add_node("match_score", match_score)
    g.set_entry_point("parse_resume")
    g.add_edge("parse_resume", "match_score")
    g.add_edge("match_score", END)
    return g.compile()


# ─── Root Graph State ─────────────────────────────────────────────────────────

@dataclass
class ScreeningState:
    """Root state for the full screening pipeline."""
    job_posting: dict = field(default_factory=dict)
    candidates: list[dict] = field(default_factory=list)  # [{id, name, resume_text}, ...]
    # Aggregated results from parallel subgraph invocations
    candidate_results: list[CandidateState] = field(default_factory=list)
    # Final output
    ranked_candidates: list[dict] = field(default_factory=list)
    output_report: str = ""
    # Stats
    total_candidates: int = 0
    passed_count: int = 0
    failed_count: int = 0


# ─── Root Graph Nodes ─────────────────────────────────────────────────────────

def dispatch_candidates(state: ScreeningState) -> list[Send]:
    """
    Fan-out: dispatch each candidate to the subgraph in parallel.
    Returns a list of Send objects, one per candidate.
    """
    return [
        Send(
            "process_candidate",
            CandidateState(
                applicant_id=c["id"],
                applicant_name=c["name"],
                resume_text=c["resume_text"],
                job_posting=state.job_posting
            ).__dict__
        )
        for c in state.candidates
    ]


def aggregate_results(state: ScreeningState, results: list[CandidateState]) -> ScreeningState:
    """
    Fan-in: collect all candidate results and compute aggregate stats.
    """
    state.candidate_results = [CandidateState(**r) if isinstance(r, dict) else r for r in results]
    state.total_candidates = len(state.candidate_results)
    state.passed_count = sum(1 for r in state.candidate_results if r.passed_threshold)
    state.failed_count = state.total_candidates - state.passed_count
    return state


def rank_candidates(state: ScreeningState) -> ScreeningState:
    """Rank all passed candidates by overall score."""
    passed = [r for r in state.candidate_results if r.passed_threshold]
    if not passed:
        state.ranked_candidates = []
        return state

    candidates_str = "\n".join([
        f"- id: {r.applicant_id}, name: {r.applicant_name}, "
        f"score: {r.overall_score}, reasoning: {r.scoring_reasoning}"
        for r in passed
    ])

    result = rank_chain.invoke({"candidates": candidates_str})
    state.ranked_candidates = result.get("ranked", [])

    # Preserve scores from subgraph
    score_map = {r.applicant_id: r for r in state.candidate_results}
    for ranked in state.ranked_candidates:
        if ranked["applicant_id"] in score_map:
            r = score_map[ranked["applicant_id"]]
            ranked["skill_score"] = r.skill_score
            ranked["experience_score"] = r.experience_score
            ranked["education_score"] = r.education_score
            ranked["scoring_reasoning"] = r.scoring_reasoning

    return state


def generate_report(state: ScreeningState) -> ScreeningState:
    """Generate final hiring report."""
    if not state.ranked_candidates:
        state.output_report = f"# Screening Report\n\n**Job:** {state.job_posting.get('jobTitle','')}\n\n**Results:** 0 candidates passed the threshold (70/100).\n"
        return state

    ranked_str = "\n".join([
        f"- **{c['name']}** (Score: {c['overall_score']}/100)\n  - Skills: {c.get('skill_score',0)}, Experience: {c.get('experience_score',0)}, Education: {c.get('education_score',0)}\n  - {c.get('reason','')}"
        for c in state.ranked_candidates
    ])

    state.output_report = output_chain.invoke({
        "ranked": ranked_str,
        "job_title": state.job_posting.get('jobTitle', '')
    })
    return state


# ─── Build Root Graph ─────────────────────────────────────────────────────────

def build_screening_graph():
    """
    Root graph that orchestrates parallel candidate processing.
    
    Flow:
      dispatch_candidates → [parallel: process_candidate] → aggregate_results → rank_candidates → generate_report → END
    
    The process_candidate node is the compiled subgraph, invoked once per candidate
    via the Send API.
    """
    candidate_subgraph = build_candidate_subgraph()

    g = StateGraph(ScreeningState)
    g.add_node("dispatch_candidates", dispatch_candidates)
    g.add_node("process_candidate", candidate_subgraph)
    g.add_node("aggregate_results", aggregate_results)
    g.add_node("rank_candidates", rank_candidates)
    g.add_node("generate_report", generate_report)

    g.set_entry_point("dispatch_candidates")

    # Fan-out: dispatch_candidates returns list[Send] → langgraph executes process_candidate in parallel
    g.add_conditional_edges(
        "dispatch_candidates",
        lambda x: x,  # passthrough — the Send list is the signal
        {
            "process_candidate": "process_candidate"
        }
    )

    # Fan-in: after all parallel invocations complete, aggregate_results is called
    # Note: aggregate_results is invoked with the list of all results from process_candidate
    g.add_edge("process_candidate", "aggregate_results")
    g.add_edge("aggregate_results", "rank_candidates")
    g.add_edge("rank_candidates", "generate_report")
    g.add_edge("generate_report", END)

    return g.compile()


# ─── Usage ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    graph = build_screening_graph()

    initial_state = ScreeningState(
        job_posting={
            "jobTitle": "Senior Python Engineer",
            "requiredSkills": ["python", "langchain", "postgres", "aws"],
            "requiredExperience": 5,
            "qualifications": ["BS Computer Science or equivalent"],
            "requirements": ["5+ years backend", "API design", "cloud deployment"]
        },
        candidates=[
            {
                "id": "app-001",
                "name": "Jane Doe",
                "resume_text": """
                Jane Doe — Senior Software Engineer
                Skills: Python, LangChain, PostgreSQL, AWS, FastAPI, Docker
                6 years backend experience at TechCorp and StartupXYZ
                BS Computer Science, MIT 2018
                """
            },
            {
                "id": "app-002",
                "name": "John Smith",
                "resume_text": """
                John Smith — Software Developer
                Skills: JavaScript, React, Node.js
                2 years frontend development
                Bootcamp graduate 2022
                """
            },
            {
                "id": "app-003",
                "name": "Alice Johnson",
                "resume_text": """
                Alice Johnson — Full Stack Engineer
                Skills: Python, Django, PostgreSQL, AWS, Terraform, Kubernetes
                8 years experience building scalable backend systems
                MS Computer Science, Stanford 2015
                Published researcher in distributed systems
                """
            }
        ]
    )

    result = graph.invoke(initial_state)
    print("=" * 60)
    print("SCREENING REPORT")
    print("=" * 60)
    print(result.output_report)
    print(f"\nStats: {result.passed_count} passed / {result.failed_count} failed out of {result.total_candidates}")
