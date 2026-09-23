"""
Candidate Screening LangGraph — LLM Semantic Scoring
"""
from dataclasses import dataclass, field
from typing import Literal
from langgraph.graph import StateGraph, END
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import JsonOutputParser

# ─── State ────────────────────────────────────────────────────────────────────

@dataclass
class CandidateState:
    """Shared state across all nodes."""
    job_posting: dict = field(default_factory=dict)
    applicant: dict = field(default_factory=dict)
    resume_text: str = ""
    # Parsed resume
    parsed_skills: list[str] = field(default_factory=list)
    parsed_experience_years: int = 0
    parsed_education: list[dict] = field(default_factory=list)
    # Scores
    skill_score: float = 0.0
    experience_score: float = 0.0
    education_score: float = 0.0
    overall_score: float = 0.0
    scoring_reasoning: str = ""
    # Routing
    next_node: Literal["rank_candidates", "disqualify"] = "disqualify"
    # Final output
    ranked_results: list[dict] = field(default_factory=list)
    output: str = ""


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
skill_parser = JsonOutputParser()
skill_chain = skill_prompt | llm | skill_parser


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
score_parser = JsonOutputParser()
score_chain = score_prompt | llm | score_parser


rank_prompt = ChatPromptTemplate.from_messages([
    ("system", """You are an HR ranking specialist. Rank candidates by overall score.
Return ONLY valid JSON:
{
  "ranked": [
    {"applicant_id": "...", "name": "...", "overall_score": 85, "reason": "..."},
    ...
  ]
}
Sort by overall_score descending."""),
    ("human", "Candidates:\n{candidates}")
])
rank_parser = JsonOutputParser()
rank_chain = rank_prompt | llm | rank_parser


output_prompt = ChatPromptTemplate.from_messages([
    ("system", "Format the candidate results as a clean markdown hiring report."),
    ("human", "Ranked candidates:\n{ranked}")
])
output_chain = output_prompt | llm | (lambda msg: msg.content)


# ─── Nodes ────────────────────────────────────────────────────────────────────

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
    state.next_node = "rank_candidates" if state.overall_score >= 70 else "disqualify"
    return state


def rank_candidates(state: CandidateState) -> CandidateState:
    """Rank this candidate among any pending candidates."""
    candidates_str = "\n".join([
        f"- id: {c['id']}, name: {c['name']}, score: {c['score']}"
        for c in state.ranked_results
    ])
    # Add this candidate
    candidates_str += f"\n- id: {state.applicant.get('id','?')}, name: {state.applicant.get('firstName','')} {state.applicant.get('lastName','')}, score: {state.overall_score}"

    result = rank_chain.invoke({"candidates": candidates_str})
    state.ranked_results = result.get("ranked", [])
    return state


def disqualify(state: CandidateState) -> CandidateState:
    """Handle below-threshold candidates."""
    state.output = f"Candidate {state.applicant.get('firstName')} {state.applicant.get('lastName')} disqualified — score {state.overall_score}/100 (threshold: 70)"
    return state


def output_results(state: CandidateState) -> CandidateState:
    """Format final hiring report."""
    state.output = output_chain.invoke({"ranked": state.ranked_results})
    return state


# ─── Graph ────────────────────────────────────────────────────────────────────

def should_continue(state: CandidateState) -> str:
    return state.next_node


def build_screening_graph():
    g = StateGraph(CandidateState)
    g.add_node("parse_resume", parse_resume)
    g.add_node("match_score", match_score)
    g.add_node("rank_candidates", rank_candidates)
    g.add_node("disqualify", disqualify)
    g.add_node("output_results", output_results)

    g.set_entry_point("parse_resume")
    g.add_edge("parse_resume", "match_score")
    g.add_conditional_edges(
        "match_score",
        should_continue,
        {
            "rank_candidates": "rank_candidates",
            "disqualify": "disqualify"
        }
    )
    g.add_edge("rank_candidates", "output_results")
    g.add_edge("disqualify", END)
    g.add_edge("output_results", END)

    return g.compile()


# ─── Usage ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    graph = build_screening_graph()

    # Example invocation
    initial_state = CandidateState(
        job_posting={
            "jobTitle": "Senior Python Engineer",
            "requiredSkills": ["python", "langchain", "postgres", "aws"],
            "requiredExperience": 5,
            "qualifications": ["BS Computer Science or equivalent"],
            "requirements": ["5+ years backend", "API design", "cloud deployment"]
        },
        applicant={
            "id": "app-123",
            "firstName": "Jane",
            "lastName": "Doe",
            "email": "jane@example.com"
        },
        resume_text="""
        Jane Doe — Senior Software Engineer
        Skills: Python, LangChain, PostgreSQL, AWS, FastAPI, Docker
        6 years backend experience at TechCorp and StartupXYZ
        BS Computer Science, MIT 2018
        """
    )

    result = graph.invoke(initial_state)
    print(result.output)
