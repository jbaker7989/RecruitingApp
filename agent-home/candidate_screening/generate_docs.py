"""
Generate: candidate_screening_documentation.docx
Run: python3 generate_docs.py
"""
from docx import Document
from docx.shared import Pt, Inches, RGBColor, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
import copy

doc = Document()

# ─── Page margins ─────────────────────────────────────────────────────────────
for section in doc.sections:
    section.top_margin = Inches(1)
    section.bottom_margin = Inches(1)
    section.left_margin = Inches(1.2)
    section.right_margin = Inches(1.2)

# ─── Helpers ──────────────────────────────────────────────────────────────────

def add_heading(text, level=1, color=None):
    p = doc.add_heading(text, level=level)
    if color:
        for run in p.runs:
            run.font.color.rgb = color
    return p

def add_para(text, bold=False, italic=False, indent=False):
    p = doc.add_paragraph()
    if indent:
        p.paragraph_format.left_indent = Inches(0.3)
    run = p.add_run(text)
    run.bold = bold
    run.italic = italic
    run.font.size = Pt(11)
    return p

def add_code_block(text):
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Inches(0.3)
    p.paragraph_format.space_before = Pt(4)
    p.paragraph_format.space_after = Pt(4)
    # Shade
    pPr = p._p.get_or_add_pPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), 'F0F0F0')
    pPr.append(shd)
    run = p.add_run(text)
    run.font.name = 'Courier New'
    run.font.size = Pt(9)
    return p

def add_bullet(text, indent=1):
    for _ in range(indent):
        p = doc.add_paragraph(style='List Bullet')
        p.paragraph_format.left_indent = Inches(0.3 * indent)
        run = p.add_run(text)
        run.font.size = Pt(11)
        return p

def add_table(headers, rows, col_widths=None):
    table = doc.add_table(rows=1 + len(rows), cols=len(headers))
    table.style = 'Table Grid'
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    # Header row
    hdr_cells = table.rows[0].cells
    for i, h in enumerate(headers):
        hdr_cells[i].text = h
        for run in hdr_cells[i].paragraphs[0].runs:
            run.bold = True
            run.font.size = Pt(10)
        hdr_cells[i].paragraphs[0].paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER
        # Shade header
        tc = hdr_cells[i]._tc
        tcPr = tc.get_or_add_tcPr()
        shd = OxmlElement('w:shd')
        shd.set(qn('w:val'), 'clear')
        shd.set(qn('w:color'), 'auto')
        shd.set(qn('w:fill'), '2E4057')
        tcPr.append(shd)
        for run in hdr_cells[i].paragraphs[0].runs:
            run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
    # Data rows
    for ri, row in enumerate(rows):
        cells = table.rows[ri + 1].cells
        for ci, val in enumerate(row):
            cells[ci].text = str(val)
            for run in cells[ci].paragraphs[0].runs:
                run.font.size = Pt(10)
        if ri % 2 == 0:
            for cell in cells:
                tc = cell._tc
                tcPr = tc.get_or_add_tcPr()
                shd = OxmlElement('w:shd')
                shd.set(qn('w:val'), 'clear')
                shd.set(qn('w:color'), 'auto')
                shd.set(qn('w:fill'), 'F7F9FC')
                tcPr.append(shd)
    # Column widths
    if col_widths:
        for row in table.rows:
            for ci, w in enumerate(col_widths):
                row.cells[ci].width = Inches(w)
    return table

# ─── TITLE PAGE ────────────────────────────────────────────────────────────────
doc.add_paragraph()
doc.add_paragraph()
title = doc.add_paragraph()
title.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = title.add_run("Candidate Screening Workflow")
r.bold = True
r.font.size = Pt(26)
r.font.color.rgb = RGBColor(0x2E, 0x40, 0x57)

subtitle = doc.add_paragraph()
subtitle.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = subtitle.add_run("LangGraph Agentic Pipeline — Technical Documentation")
r.font.size = Pt(14)
r.italic = True

doc.add_paragraph()
meta = doc.add_paragraph()
meta.alignment = WD_ALIGN_PARAGRAPH.CENTER
meta.add_run("New Frontier Recruiting\n").font.size = Pt(12)
meta.add_run("Version 1.0\n").font.size = Pt(10)
meta.add_run("October 2025").font.size = Pt(10)

doc.add_page_break()

# ─── TABLE OF CONTENTS ────────────────────────────────────────────────────────
add_heading("Table of Contents", 1)
toc_items = [
    ("1.", "Overview"),
    ("2.", "Architecture Overview"),
    ("3.", "Graph Topology & Data Flow"),
    ("4.", "Node Reference"),
    ("5.", "LLM Prompt Engineering"),
    ("6.", "Scoring Methodology"),
    ("7.", "Parallel Execution (Fan-Out / Fan-In)"),
    ("8.", "State Schemas"),
    ("9.", "Installation & Dependencies"),
    ("10.", "Usage Examples"),
    ("11.", "Configuration & Tuning"),
    ("12.", "Extensibility & Future Work"),
    ("13.", "Troubleshooting"),
    ("14.", "File Inventory"),
]
for num, item in toc_items:
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Inches(0.3)
    p.add_run(f"{num}  {item}").font.size = Pt(11)

doc.add_page_break()

# ─── SECTION 1: OVERVIEW ──────────────────────────────────────────────────────
add_heading("1. Overview", 1)
add_para(
    "The Candidate Screening Workflow is an LLM-powered, graph-based pipeline that "
    "evaluates job applicants against a job posting using semantic scoring. It replaces "
    "manual keyword matching with a multi-stage LangGraph application that parses resumes, "
    "scores candidates across three dimensions (skills, experience, education), ranks "
    "qualified applicants, and produces a formatted hiring report."
)
add_para(
    "The system is designed to handle multiple candidates concurrently via LangGraph's "
    "Send API, enabling parallel evaluation while preserving individual scoring reasoning "
    "and aggregate statistics."
)

add_heading("1.1 Goals", 2)
for goal in [
    "Automate resume screening with LLM-backed semantic understanding",
    "Provide transparent, explainable scoring (not a black-box score)",
    "Scale to N candidates in parallel via fan-out/fan-in execution",
    "Integrate with the existing New Frontier Recruiting data model (JobPosting, Applicant, Application)",
    "Produce a ranked shortlist with reasoning for human review",
]:
    add_bullet(goal)

add_heading("1.2 Non-Goals", 2)
for ng in [
    "This is NOT a hiring decision engine — it produces recommendations for human review",
    "It does NOT persist data — it operates on in-memory state (persistence is handled by the calling application)",
    "It does NOT handle interview scheduling or candidate communication",
]:
    add_bullet(ng)

add_heading("1.3 Terminology", 2)
headers = ["Term", "Definition"]
rows = [
    ["Node", "A processing step in the LangGraph (e.g., parse_resume, match_score)"],
    ["Edge", "A directed connection between two nodes defining execution order"],
    ["Conditional Edge", "An edge whose destination depends on runtime state"],
    ["State", "A typed dataclass that flows through all nodes in a graph invocation"],
    ["Fan-Out", "Dispatching multiple parallel invocations from one node"],
    ["Fan-In", "Aggregating results from multiple parallel invocations into one"],
    ["Subgraph", "A reusable compiled graph invoked as a single node in the root graph"],
    ["Send", "LangGraph primitive for dispatching a subgraph call with custom input state"],
]
add_table(headers, rows, [1.5, 5.5])

doc.add_page_break()

# ─── SECTION 2: ARCHITECTURE OVERVIEW ─────────────────────────────────────────
add_heading("2. Architecture Overview", 1)

add_heading("2.1 Two-Graph Design", 2)
add_para(
    "The implementation uses two graphs: a single-candidate subgraph and a root graph "
    "that orchestrates parallel execution."
)

add_heading("2.1.1 Candidate Subgraph", 2)
add_para("Processes ONE candidate through the full evaluation pipeline:")
for item in ["parse_resume → match_score → END"]:
    add_bullet(item)

add_heading("2.1.2 Root Graph", 2)
add_para("Orchestrates parallel processing and final reporting:")
for item in [
    "dispatch_candidates → [parallel process_candidate] → aggregate_results → rank_candidates → generate_report → END"
]:
    add_bullet(item)

add_heading("2.2 Component Diagram", 2)
add_para("The following diagram shows the relationship between components:")
add_code_block("""
┌─────────────────────────────────────────────────────────┐
│                   Root Graph (ScreeningGraph)             │
│                                                          │
│  dispatch_candidates                                     │
│         │                                                │
│         │ Send(...) for each candidate                  │
│         ▼                                                │
│  ┌──────────────┐   ┌──────────────┐   ┌────────────┐ │
│  │ Candidate    │   │ Candidate    │   │ Candidate  │ │
│  │ Subgraph 1   │   │ Subgraph 2   │   │ Subgraph N │ │
│  │              │   │              │   │            │ │
│  │ parse_resume │   │ parse_resume │   │ parse_resume│ │
│  │ match_score  │   │ match_score  │   │ match_score│ │
│  └──────┬───────┘   └──────┬───────┘   └─────┬──────┘ │
│         │                  │                  │         │
│         └──────────────────┴──────────────────┘         │
│                            │                             │
│                            ▼                             │
│                   aggregate_results                      │
│                            │                             │
│                            ▼                             │
│                    rank_candidates                       │
│                            │                             │
│                            ▼                             │
│                    generate_report                       │
│                            │                             │
│                            ▼                             │
│                           END                             │
└─────────────────────────────────────────────────────────┘
""")

add_heading("2.3 Technology Stack", 2)
headers = ["Layer", "Technology", "Purpose"]
rows = [
    ["Graph Framework", "LangGraph (langgraph)", "Orchestration, state management, parallelism"],
    ["LLM", "OpenAI GPT-4o (ChatOpenAI)", "Semantic parsing and scoring"],
    ["Prompts", "LangChain ChatPromptTemplate", "Structured prompt composition"],
    ["Output Parsing", "LangChain JsonOutputParser", "JSON extraction from LLM output"],
    ["Language", "Python 3.10+", "Runtime"],
]
add_table(headers, rows, [1.8, 2.2, 3.2])

doc.add_page_break()

# ─── SECTION 3: GRAPH TOPOLOGY & DATA FLOW ────────────────────────────────────
add_heading("3. Graph Topology & Data Flow", 1)

add_heading("3.1 Root Graph Flow", 2)
add_para("Step-by-step execution:")
steps = [
    ("Step 1 — dispatch_candidates", "Iterates over all candidates in state.candidates and returns a list of Send objects, one per candidate. This is the fan-out point."),
    ("Step 2 — process_candidate (parallel)", "The compiled candidate subgraph is invoked once per Send object. All invocations run in parallel. Each returns a CandidateState."),
    ("Step 3 — aggregate_results", "Collects all CandidateState results from parallel invocations. Computes passed_count and failed_count."),
    ("Step 4 — rank_candidates", "LLM-powered ranking of all passed candidates by overall_score. Returns a sorted ranked_candidates list."),
    ("Step 5 — generate_report", "Formats the ranked list into a markdown hiring report. If no candidates passed, outputs a zero-result report with the job title and pass count."),
]
for title, desc in steps:
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Inches(0.3)
    p.add_run(f"{title}: ").bold = True
    p.add_run(desc)

add_heading("3.2 Candidate Subgraph Flow", 2)
add_para("Each candidate subgraph runs two nodes sequentially:")
sub_steps = [
    ("parse_resume", "LLM extracts structured skills, years of experience, and education from raw resume text."),
    ("match_score", "LLM scores the candidate against the job posting across skill_score, experience_score, education_score, and overall_score (weighted average). Sets passed_threshold = (overall_score >= 70)."),
]
for node, desc in sub_steps:
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Inches(0.3)
    p.add_run(f"{node}: ").bold = True
    p.add_run(desc)

add_heading("3.3 Conditional Routing", 2)
add_para("In the candidate subgraph, there is currently no conditional branching — all parsed resumes proceed to scoring. In the root graph, candidates who score below 70 are not disqualified from the results list; they are simply excluded from the ranked shortlist. Future versions may add a disqualify node with a separate END path.")

add_heading("3.4 Data Flow Diagram", 2)
add_code_block("""
Input (ScreeningState)
│
├─ job_posting: dict
│   └─ {jobTitle, requiredSkills, requiredExperience, qualifications, requirements}
│
├─ candidates: list[dict]
│   └─ [{id, name, resume_text}, ...]
│
│   ┌── Fan-out via Send() ──────────────────────────┐
│   │                                                 │
│   │  For each candidate → CandidateState           │
│   │    parse_resume → CandidateState               │
│   │    match_score  → CandidateState               │
│   │               (with overall_score, passed)     │
│   │                                                 │
│   └── Fan-in to aggregate_results ──────────────────┘
│
├─ candidate_results: list[CandidateState]
│   └─ [{applicant_id, skill_score, overall_score, passed, ...}, ...]
│
├─ ranked_candidates: list[dict]
│   └─ [{applicant_id, name, overall_score, reason, skill/exp/edu_scores}, ...]
│
└─ output_report: str (markdown)
    └─ Formatted hiring report
""")

doc.add_page_break()

# ─── SECTION 4: NODE REFERENCE ────────────────────────────────────────────────
add_heading("4. Node Reference", 1)

nodes = [
    {
        "name": "dispatch_candidates",
        "type": "Root graph node (not a subgraph)",
        "description": "Entry point of the root graph. Converts the flat list of candidates into a list of Send objects for parallel dispatch.",
        "input": "ScreeningState (candidates, job_posting)",
        "output": "list[Send] — one Send per candidate",
        "logic": "list comprehension over state.candidates, constructing a CandidateState for each",
    },
    {
        "name": "process_candidate",
        "type": "Invoked subgraph (compiled from build_candidate_subgraph)",
        "description": "The candidate subgraph runs in parallel for each dispatched candidate. This node name appears once in the root graph but is invoked N times.",
        "input": "CandidateState (per Send, from dispatch_candidates)",
        "output": "CandidateState (enriched with scores)",
        "logic": "parse_resume → match_score, both via LLM chains",
    },
    {
        "name": "parse_resume",
        "type": "Node inside candidate subgraph",
        "description": "Uses an LLM to extract structured resume data from free-text resume input.",
        "input": "CandidateState.resume_text",
        "output": "CandidateState (parsed_skills, parsed_experience_years, parsed_education)",
        "logic": "skill_chain.invoke({resume_text}) → JSON → populate state fields",
    },
    {
        "name": "match_score",
        "type": "Node inside candidate subgraph",
        "description": "Uses an LLM to semantically compare the parsed resume against the job posting requirements.",
        "input": "CandidateState (parsed_skills, parsed_experience_years, parsed_education, job_posting, resume_text)",
        "output": "CandidateState (skill_score, experience_score, education_score, overall_score, reasoning, passed_threshold)",
        "logic": "score_chain.invoke(job_str, resume_text, applicant_str) → JSON → populate state",
    },
    {
        "name": "aggregate_results",
        "type": "Root graph node",
        "description": "Fan-in point. Receives all CandidateState results from parallel subgraph executions and computes aggregate statistics.",
        "input": "list[CandidateState] from all parallel process_candidate calls",
        "output": "ScreeningState (candidate_results, passed_count, failed_count)",
        "logic": "Collect results, tally passed/failed against passed_threshold",
    },
    {
        "name": "rank_candidates",
        "type": "Root graph node",
        "description": "Uses an LLM to rank all passed candidates by their overall_score.",
        "input": "ScreeningState.candidate_results (filtered to passed=True)",
        "output": "ScreeningState.ranked_candidates (sorted list with reasoning)",
        "logic": "rank_chain.invoke with formatted candidate strings → sorted ranked list",
    },
    {
        "name": "generate_report",
        "type": "Root graph node (terminal)",
        "description": "Formats the final ranked candidate list into a human-readable markdown report.",
        "input": "ScreeningState.ranked_candidates, job_posting.jobTitle",
        "output": "ScreeningState.output_report (markdown string)",
        "logic": "output_chain.invoke with ranked string + job title → markdown",
    },
]

for node in nodes:
    add_heading(f"4.x {node['name']}", 2)
    for label, val in [
        ("Type", node["type"]),
        ("Description", node["description"]),
        ("Input", node["input"]),
        ("Output", node["output"]),
        ("Logic", node["logic"]),
    ]:
        p = doc.add_paragraph()
        p.paragraph_format.left_indent = Inches(0.3)
        p.add_run(f"{label}: ").bold = True
        p.add_run(val)
    doc.add_paragraph()

doc.add_page_break()

# ─── SECTION 5: LLM PROMPT ENGINEERING ────────────────────────────────────────
add_heading("5. LLM Prompt Engineering", 1)

add_heading("5.1 parse_resume — Skill Extraction Prompt", 2)
add_para("System prompt instructs the LLM to act as an HR resume parser and return structured JSON. The few-shot JSON schema anchors the output format.")
add_code_block("""System: You are an HR resume parser. Extract structured information 
from a resume. Return ONLY valid JSON with this exact shape:
{
  "skills": ["skill1", "skill2", ...],
  "experience_years": number,
  "education": [{"degree": "...", "field": "...", "institution": "..."}]
}

Human: {resume_text}""")

add_heading("5.2 match_score — Semantic Scoring Prompt", 2)
add_para("The scoring prompt includes an explicit rubric, score ranges, and weighting. The job posting is flattened into a readable string format so the LLM can compare it against the parsed candidate profile.")
add_code_block("""System: You are an HR matching specialist. Score a candidate against 
a job posting. Be strict but fair. Return ONLY valid JSON:
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
- overall_score: weighted average (skills 50%, experience 30%, education 20%)

Human: JOB POSTING:\n{job_posting}\n\nCANDIDATE RESUME:\n{resume_text}\n\nCANDIDATE PROFILE:\n{applicant}""")

add_heading("5.3 rank_candidates — Ranking Prompt", 2)
add_para("The ranking prompt sorts candidates by overall_score descending and asks for a brief reason per candidate.")
add_code_block("""System: You are an HR ranking specialist. Rank candidates by overall 
score. Return ONLY valid JSON:
{
  "ranked": [
    {"applicant_id": "...", "name": "...", "overall_score": 85, "reason": "..."},
    ...
  ]
}
Sort by overall_score descending. Include all candidates passed in.

Human: Candidates:\n{candidates}""")

add_heading("5.4 generate_report — Report Formatting Prompt", 2)
add_code_block("""System: You are an HR report generator. Create a professional hiring 
report in markdown. Include a summary table and brief analysis.

Human: Ranked candidates:\n{ranked}\n\nJob Posting:\n{job_title}""")

add_heading("5.5 Prompt Design Principles", 2)
for principle in [
    "Return ONLY JSON (or markdown for output): Eliminates hallucinated extra text that breaks parsing",
    "Explicit rubrics: Score descriptions prevent arbitrary scoring",
    "Formatted job posting as string: Avoids sending raw dicts that confuse LLMs",
    "Chain of thought in reasoning field: Forces LLM to explain scores (auditability)",
    "Strict/fair language: Avoids both inflated and deflated scores",
]:
    add_bullet(principle)

doc.add_page_break()

# ─── SECTION 6: SCORING METHODOLOGY ──────────────────────────────────────────
add_heading("6. Scoring Methodology", 1)

add_heading("6.1 Score Dimensions", 2)
headers = ["Dimension", "Weight", "Input Source", "Score Range"]
rows = [
    ["skill_score", "50%", "parsed_skills vs requiredSkills", "0-100"],
    ["experience_score", "30%", "parsed_experience_years vs requiredExperience", "0-100"],
    ["education_score", "20%", "parsed_education vs qualifications", "0-100"],
    ["overall_score", "100%", "weighted average", "0-100"],
]
add_table(headers, rows, [1.5, 1.0, 2.5, 1.2])

add_heading("6.2 Skill Score Calculation", 2)
add_para(
    "The LLM performs semantic matching between required_skills (from JobPosting.requiredSkills) "
    "and parsed_skills (from the resume). Semantic matching means the LLM understands that "
    "'Python' and 'Python 3' are the same skill, and 'React' and 'React.js' refer to the same "
    "technology. This is fundamentally different from keyword matching which requires exact string "
    "overlap. The LLM is instructed to count overlapping semantic concepts, not just literal tokens."
)

add_heading("6.3 Experience Score Calculation", 2)
add_para(
    "The experience score checks whether the candidate meets or exceeds the required years of "
    "experience. If candidate years >= required years, full marks (100). If below, the score "
    "scales proportionally: (candidate_years / required_years) * 100. The LLM is also instructed "
    "to consider the relevance and recency of experience (e.g., 6 years of backend Python "
    "experience is scored higher than 6 years of unrelated work)."
)

add_heading("6.4 Education Score Calculation", 2)
add_para(
    "The education score checks alignment between the candidate's education history and the "
    "job posting's qualifications field. A BS in Computer Science for a Software Engineer "
    "role scores higher than an unrelated degree. An advanced degree (MS/PhD) scores higher "
    "than the minimum requirement. The LLM is instructed to be strict about field relevance."
)

add_heading("6.5 Pass/Fail Threshold", 2)
add_para("The default threshold is 70/100. Candidates scoring below this are marked passed_threshold=False and excluded from the ranked shortlist. The threshold is configurable and should be tuned based on:")
for item in ["Role seniority (senior roles may need 75+)",
             "Industry norms",
             "Company hiring volume",
             "Candidate pool size"]:
    add_bullet(item, indent=2)

add_heading("6.6 Transparency & Auditability", 2)
add_para(
    "Every score includes a reasoning field explaining WHY each dimension received its score. "
    "This allows hiring managers to:\n"
    "  • Verify score fairness manually\n"
    "  • Identify borderline cases requiring human review\n"
    "  • Debug cases where the LLM scored unexpectedly high or low\n"
    "  • Provide feedback to improve the scoring rubric"
)

doc.add_page_break()

# ─── SECTION 7: PARALLEL EXECUTION ───────────────────────────────────────────
add_heading("7. Parallel Execution (Fan-Out / Fan-In)", 1)

add_heading("7.1 How LangGraph Send Works", 2)
add_para(
    "LangGraph's Send API is the mechanism for fan-out. It allows a single node to return "
    "multiple values, each of which triggers a separate invocation of a target node (the "
    "subgraph) with its own state. LangGraph automatically parallelizes these invocations "
    "when the underlying executor supports it."
)
add_code_block("""# dispatch_candidates returns this:
return [
    Send(
        "process_candidate",      # target node name
        CandidateState(           # input state for this invocation
            applicant_id=c["id"],
            applicant_name=c["name"],
            resume_text=c["resume_text"],
            job_posting=state.job_posting
        ).__dict__
    )
    for c in state.candidates
]""")

add_heading("7.2 Fan-Out Visualization", 2)
add_code_block("""
dispatch_candidates returns:
  [
    Send("process_candidate", CandidateState(id="app-001", ...)),
    Send("process_candidate", CandidateState(id="app-002", ...)),
    Send("process_candidate", CandidateState(id="app-003", ...)),
    ...
  ]

LangGraph fan-out (parallel):
  ──► process_candidate(app-001 state)
  ──► process_candidate(app-002 state)     (all at once)
  ──► process_candidate(app-003 state)

All three subgraph executions are independent and concurrent.
""")

add_heading("7.3 Fan-In via aggregate_results", 2)
add_para(
    "After all Send targets complete, LangGraph collects all return values and passes "
    "them as a list to the next node (aggregate_results). This is the fan-in pattern. "
    "The next node receives the full list of CandidateState objects, one per candidate."
)

add_heading("7.4 Performance Characteristics", 2)
headers = ["Candidates", "Nodes per Candidate", "Total Sequential Steps", "Parallelism Gain"]
rows = [
    ["1", "2", "2", "1x"],
    ["10", "2", "2", "~10x (vs sequential)"],
    ["50", "2", "2", "~50x (vs sequential)"],
    ["100", "2", "2", "~100x (vs sequential)"],
]
add_table(headers, rows, [1.5, 1.8, 2.2, 1.7])
add_para(
    "Note: The LLM calls themselves have internal latency (~1-3 seconds per call). "
    "Parallelism helps significantly when there are many candidates, but the LLM "
    "provider's rate limits (RPM/TPM) may become the bottleneck at scale."
)

add_heading("7.5 Rate Limiting Considerations", 2)
add_para(
    "When processing many candidates (e.g., 100+), the parallel fan-out will fire all "
    "LLM calls simultaneously. This can hit OpenAI's rate limits. Strategies:"
)
for strategy in [
    "Add a semaphore or concurrency limiter to throttle Send invocations",
    "Batch candidates into chunks and process chunks sequentially",
    "Use a slower but more available model (gpt-4o-mini) for parse_resume (cheaper, faster)",
    "Implement exponential backoff retry logic in the subgraph nodes",
    "Consider using LangGraph's built-in checkpointing for resumable runs",
]:
    add_bullet(strategy, indent=2)

doc.add_page_break()

# ─── SECTION 8: STATE SCHEMAS ─────────────────────────────────────────────────
add_heading("8. State Schemas", 1)

add_heading("8.1 CandidateState", 2)
add_para("Dataclass defining state for a single candidate subgraph invocation.")
fields = [
    ("applicant_id", "str", "Unique applicant identifier"),
    ("applicant_name", "str", "Full name for display"),
    ("resume_text", "str", "Raw resume text input"),
    ("job_posting", "dict", "Job posting dict (passed to scoring)"),
    ("parsed_skills", "list[str]", "LLM-extracted skills from resume"),
    ("parsed_experience_years", "int", "LLM-extracted years of experience"),
    ("parsed_education", "list[dict]", "LLM-extracted education entries"),
    ("skill_score", "float", "0-100 skill dimension score"),
    ("experience_score", "float", "0-100 experience dimension score"),
    ("education_score", "float", "0-100 education dimension score"),
    ("overall_score", "float", "0-100 weighted overall score"),
    ("scoring_reasoning", "str", "LLM explanation for the scores"),
    ("passed_threshold", "bool", "True if overall_score >= 70"),
]
headers = ["Field", "Type", "Description"]
rows = [[f, t, d] for f, t, d in fields]
add_table(headers, rows, [1.8, 1.2, 4.2])

add_heading("8.2 ScreeningState", 2)
add_para("Root state for the full pipeline.")
root_fields = [
    ("job_posting", "dict", "Job posting (title, requiredSkills, etc.)"),
    ("candidates", "list[dict]", "Input list: [{id, name, resume_text}, ...]"),
    ("candidate_results", "list[CandidateState]", "Aggregated results from all parallel runs"),
    ("ranked_candidates", "list[dict]", "Final ranked shortlist with scores"),
    ("output_report", "str", "Formatted markdown hiring report"),
    ("total_candidates", "int", "Total number of candidates processed"),
    ("passed_count", "int", "Number of candidates with passed_threshold=True"),
    ("failed_count", "int", "Number of candidates with passed_threshold=False"),
]
headers = ["Field", "Type", "Description"]
rows = [[f, t, d] for f, t, d in root_fields]
add_table(headers, rows, [1.8, 1.2, 4.2])

doc.add_page_break()

# ─── SECTION 9: INSTALLATION & DEPENDENCIES ────────────────────────────────────
add_heading("9. Installation & Dependencies", 1)

add_heading("9.1 Requirements", 2)
add_code_block("""langgraph>=0.2.0
langchain-openai>=0.2.0
langchain-core>=0.3.0
openai>=1.0.0
python-docx>=1.0.0   # for documentation generation""")

add_heading("9.2 Installation", 2)
add_code_block("""pip install langgraph langchain-openai langchain-core openai python-docx""")

add_heading("9.3 Environment Variables", 2)
add_para("Set your OpenAI API key:")
add_code_block("""export OPENAI_API_KEY=sk-...""")

add_heading("9.4 File Structure", 2)
add_code_block("""agent-home/
└── candidate_screening/
    ├── graph.py              # Original single-candidate graph (reference, not required)
    ├── parallel_graph.py     # Main parallel processing graph (USE THIS)
    ├── generate_docs.py      # Documentation generator
    └── candidate_screening_documentation.docx  # This document""")

add_heading("9.5 Running the Pipeline", 2)
add_code_block("""from parallel_graph import build_screening_graph, ScreeningState

graph = build_screening_graph()

state = ScreeningState(
    job_posting={...},
    candidates=[...],
)

result = graph.invoke(state)
print(result.output_report)""")

doc.add_page_break()

# ─── SECTION 10: USAGE EXAMPLES ────────────────────────────────────────────────
add_heading("10. Usage Examples", 1)

add_heading("10.1 Minimal Example", 2)
add_code_block("""from parallel_graph import build_screening_graph, ScreeningState

graph = build_screening_graph()

state = ScreeningState(
    job_posting={
        "jobTitle": "Senior Python Engineer",
        "requiredSkills": ["python", "langchain", "postgres", "aws"],
        "requiredExperience": 5,
        "qualifications": ["BS Computer Science"],
        "requirements": ["5+ years backend"]
    },
    candidates=[
        {
            "id": "app-001",
            "name": "Jane Doe",
            "resume_text": "Skills: Python, LangChain, AWS. 6 years experience. BS CS, MIT."
        },
        {
            "id": "app-002",
            "name": "John Smith",
            "resume_text": "Skills: JavaScript, React. 2 years frontend. Bootcamp grad."
        }
    ]
)

result = graph.invoke(state)
print(result.output_report)
print(f"Passed: {result.passed_count} / {result.total_candidates}")""")

add_heading("10.2 Integration with Existing Data Model", 2)
add_para(
    "The system is designed to integrate with your existing JobPosting and Applicant models. "
    "The job_posting dict maps directly from your JobPosting JSON structure. Candidates "
    "can be loaded from your Application records, extracting resume text and applicant info."
)
add_code_block("""# Example: loading from your existing model
from parallel_graph import build_screening_graph, ScreeningState

# Load job posting from your persistence layer
job = load_job_posting(job_id)

# Load all applications for this job
applications = load_applications_for_job(job_id)

candidates = [
    {
        "id": app["applicantId"],
        "name": f\"{applicant.firstName} {applicant.lastName}\",
        "resume_text": applicant.resumeText or applicant.employmentHistoryText
    }
    for app in applications
]

state = ScreeningState(
    job_posting=job.__dict__,
    candidates=candidates
)

result = build_screening_graph().invoke(state)
# Persist results back to Application records
for ranked in result.ranked_candidates:
    update_application_score(ranked["applicant_id"], ranked["overall_score"])""")

add_heading("10.3 Async Batch Processing", 2)
add_para(
    "For very large candidate pools, process in batches to avoid rate limits:"
)
add_code_block("""import asyncio
from concurrent.futures import ThreadPoolExecutor

def process_batch(job_posting, candidates_batch):
    graph = build_screening_graph()
    state = ScreeningState(job_posting=job_posting, candidates=candidates_batch)
    return graph.invoke(state)

def process_all(job_posting, all_candidates, batch_size=20):
    batches = [
        all_candidates[i:i+batch_size]
        for i in range(0, len(all_candidates), batch_size)
    ]
    all_ranked = []
    with ThreadPoolExecutor(max_workers=3) as executor:
        results = list(executor.map(
            lambda b: process_batch(job_posting, b),
            batches
        ))
    for r in results:
        all_ranked.extend(r.ranked_candidates)
    return sorted(all_ranked, key=lambda x: x["overall_score"], reverse=True)""")

doc.add_page_break()

# ─── SECTION 11: CONFIGURATION & TUNING ────────────────────────────────────────
add_heading("11. Configuration & Tuning", 1)

add_heading("11.1 Model Configuration", 2)
headers = ["Parameter", "Default", "Recommendation", "Notes"]
rows = [
    ["model", "gpt-4o", "gpt-4o for accuracy; gpt-4o-mini for speed/cost", "All LLM nodes use same model"],
    ["temperature", "0", "0 for consistent scoring; 0.1-0.2 for ranking variety", "Scoring should be deterministic"],
    ["max_tokens", "N/A", "Set if you see truncated JSON responses", "Monitor for parse failures"],
]
add_table(headers, rows, [1.3, 1.3, 2.5, 1.5])

add_heading("11.2 Scoring Thresholds", 2)
add_code_block("""# In match_score node, the threshold is checked and passed_threshold is set:
state.passed_threshold = state.overall_score >= 70

# To make configurable, pass threshold in state:
@dataclass
class CandidateState:
    ...
    score_threshold: float = 70.0

# Then in match_score:
state.passed_threshold = state.overall_score >= state.score_threshold""")

add_heading("11.3 Score Weights", 2)
add_para("Weights are hardcoded in the match_score prompt (50/30/20). To make configurable:")
for step in [
    "Pass weights as part of CandidateState or as part of job_posting dict",
    "Update the score_chain prompt template to accept weight parameters",
    "Update aggregate_results to use configured weights for overall_score",
]:
    add_bullet(step, indent=2)

add_heading("11.4 Prompt Tuning Tips", 2)
for tip in [
    "Run the pipeline with 5-10 candidates and manually verify scores before deploying",
    "Log the LLM raw outputs to identify scoring inconsistencies",
    "Adjust the 'strict but fair' language — more strict language produces lower scores",
    "If skills scores are too similar, add a required_skills partial match bonus",
    "If experience scores are inflated, add a recency penalty (older experience scores lower)",
]:
    add_bullet(tip, indent=2)

doc.add_page_break()

# ─── SECTION 12: EXTENSIBILITY ────────────────────────────────────────────────
add_heading("12. Extensibility & Future Work", 1)

add_heading("12.1 Planned Enhancements", 2)

items = [
    ("Human-in-the-loop approval", "Add an interrupt node after scoring that pauses for human review of borderline candidates (score 65-80). Use langgraph's interrupt + update_state pattern."),
    ("Interview type weighting", "Score candidates differently based on interview round (phone screen vs onsite vs technical)."),
    ("Bias detection", "Add a prompt-based bias checker that flags demographic signals in resumes (names, schools) that could introduce unfair advantage."),
    ("Multi-job matching", "Extend to match one candidate against multiple job postings simultaneously, returning the best-fit role."),
    ("Resume redaction", "Add a pre-processing node that redacts PII (SSN, address, photo references) before LLM parsing to reduce bias."),
    ("Confidence scoring", "Return a confidence score alongside each dimension score indicating how certain the LLM is about its assessment."),
    ("Explanation generation", "Generate natural language feedback for candidates explaining their scores (with human review before sending)."),
    ("Checkpointing & resume", "Use LangGraph checkpointing to save state mid-pipeline and resume after rate limit errors."),
]

for title, desc in items:
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Inches(0.3)
    p.add_run(f"• {title}: ").bold = True
    p.add_run(desc)

add_heading("12.2 Adding a New Scoring Dimension", 2)
add_para("To add a new dimension (e.g., 'culture_fit_score'):")
for step in [
    "Add culture_fit_score to CandidateState",
    "Update score_prompt system message to include culture_fit rubric",
    "Update the score JSON output format to include culture_fit_score",
    "Update match_score node to extract culture_fit_score from result",
    "Update overall_score weighting to include the new dimension",
]:
    add_bullet(step, indent=2)

add_heading("12.3 Adding a Disqualify Branch", 2)
add_para(
    "To route below-threshold candidates to a separate end state (rather than just "
    "excluding them from ranking):"
)
add_code_block("""# In the candidate subgraph, add a conditional edge:
def should_continue(state: CandidateState):
    if state.overall_score < 70:
        return "disqualify"
    return END

g.add_conditional_edges(
    "match_score",
    should_continue,
    {
        "disqualify": "disqualify",
        END: END
    }
)
g.add_node("disqualify", disqualify_node)""")

doc.add_page_break()

# ─── SECTION 13: TROUBLESHOOTING ──────────────────────────────────────────────
add_heading("13. Troubleshooting", 1)

add_heading("13.1 Common Issues", 2)
headers = ["Issue", "Cause", "Solution"]
rows = [
    ["JSON parse error in skill_chain", "LLM returned non-JSON text before/after JSON", "Add 'Return ONLY JSON' to prompt; add error handling with retry"],
    ["All candidates score 0", "Empty resume_text or job_posting dict", "Verify input state has non-empty resume_text and job_posting"],
    ["Rate limit error", "Too many parallel LLM calls", "Reduce batch size; add semaphore; use gpt-4o-mini for parsing"],
    ["Inconsistent scores between runs", "temperature > 0", "Set temperature=0 for deterministic scoring"],
    ["Output parser fails on rank_candidates", "LLM returned non-JSON ranked list", "Add retry logic with fallback to sort-by-score if parsing fails"],
    ["Missing candidate in results", "Candidate scored below threshold", "Check passed_count vs total; lower threshold or improve resume parsing"],
    ["Very low skill scores", "Skills not matching requiredSkills semantically", "Refine prompt to emphasize semantic matching; check parsed_skills output"],
]
add_table(headers, rows, [2.0, 2.5, 2.7])

add_heading("13.2 Debugging Tips", 2)
for tip in [
    "Print state after each node to trace data flow",
    "Use graph.get_graph().draw_mermaid() to visualize the current graph",
    "Log raw LLM outputs before parsing to identify prompt issues",
    "Test with a known-good candidate/resume pair to establish baseline",
    "Use graph.stream(state) to stream node-by-node outputs for live inspection",
]:
    add_bullet(tip)

doc.add_page_break()

# ─── SECTION 14: SERVICE & INTEGRATION ──────────────────────────────────────
add_heading("14. Service Architecture & TypeScript Integration", 1)

add_para(
    "The parallel_graph.py is the core LangGraph engine. To use it from the TypeScript "
    "backend, deploy candidate_screening_service.py as a separate FastAPI microservice "
    "that wraps the graph behind REST endpoints."
)

add_heading("14.1 Running the Service", 2)
add_code_block("""# Install dependencies
pip install -r requirements.txt

# Set your OpenAI key
export OPENAI_API_KEY=sk-...

# Start the service (port 8001)
uvicorn candidate_screening_service:app --host 0.0.0.0 --port 8001 --reload

# Or run directly:
python candidate_screening_service.py""")

add_heading("14.2 REST API Endpoints", 2)

headers = ["Method + Path", "Description", "Response"]
rows = [
    ["GET  /health", "Health check", "{status: ok}"],
    ["POST /screening/screen", "Submit batch screening job", "202 ScreeningJobResponse"],
    ["GET  /screening/jobs/{id}", "Poll job status", "ScreeningJobResponse"],
    ["GET  /screening/jobs/{id}/result", "Get results (only when completed)", "ScreeningResult"],
    ["DELETE /screening/jobs/{id}", "Cancel/discard a job", "{job_id, status: cancelled}"],
]
add_table(headers, rows, [2.5, 3.0, 2.7])

add_heading("14.3 Environment Variables", 2)
headers = ["Variable", "Default", "Description"]
rows = [
    ["OPENAI_API_KEY", "(required)", "OpenAI API key for LLM calls"],
    ["CANDIDATE_SCREENING_PORT", "8001", "HTTP port for the FastAPI service"],
]
add_table(headers, rows, [2.5, 1.5, 3.2])

add_heading("14.4 TypeScript Integration", 2)
add_para(
    "The TypeScript backend calls the Python service via HTTP. "
    "Endpoints are defined in src/routes/agents/index.ts and types are in src/types/screening.ts."
)
add_code_block("""# Set the Python service URL (defaults to http://localhost:8001)
SCREENING_SERVICE_URL=http://localhost:8001

# TypeScript endpoint: POST /api/agents/screening/screen
# Requires: jobId, applications[{applicationId, applicantId, applicantName, resumeText}]
# Returns: {success, data: ScreeningJobResponse}

# TypeScript endpoint: GET /api/agents/screening/jobs/:pythonJobId
# Returns: {success, data: ScreeningJobResponse}

# TypeScript endpoint: GET /api/agents/screening/:jobId/result?pythonJobId=...
# Returns: {success, data: ScreeningResult} or 202 if still running""")

add_heading("14.5 End-to-End Flow", 2)
add_para("Full integration flow:")
for step in [
    "Frontend calls POST /api/agents/screening/screen with jobId and application list",
    "TypeScript backend fetches JobPosting from store, maps to ScreeningRequest",
    "TypeScript backend POSTs to Python service /screening/screen",
    "Python service queues job, returns 202 with job_id immediately",
    "Background worker runs LangGraph (fan-out → LLM scoring → fan-in → rank → report)",
    "Frontend polls GET /api/agents/screening/jobs/:pythonJobId",
    "When status=completed, GET result endpoint returns ranked candidates",
    "TypeScript backend patches Application records with new LLM scores",
]:
    add_bullet(step)

doc.add_page_break()

# ─── SECTION 15: FILE INVENTORY ───────────────────────────────────────────────
add_heading("15. File Inventory", 1)

add_heading("15.1 parallel_graph.py", 2)
add_para(
    "Core LangGraph implementation. Fan-out via Send API, per-candidate subgraph "
    "(parse_resume → match_score), root graph (dispatch → aggregate → rank → report)."
)

add_heading("15.2 candidate_screening_service.py", 2)
add_para(
    "FastAPI REST wrapper. Runs the LangGraph workflow in a background task. "
    "Provides /screening/screen, /screening/jobs/:id, and /screening/jobs/:id/result endpoints. "
    "Thread-safe in-memory job store (replace with Redis/DB in production)."
)

add_heading("15.3 graph.py (reference)", 2)
add_para(
    "Original single-candidate graph for reference. Does not support parallel processing. "
    "Kept for comparison and understanding."
)

add_heading("15.4 generate_docs.py", 2)
add_para("Documentation generator. Run: python generate_docs.py")

add_heading("15.5 requirements.txt", 2)
add_para("Python dependencies: langgraph, langchain-openai, fastapi, uvicorn, pydantic.")

add_heading("15.6 candidate_screening_documentation.docx", 2)
add_para("This document.")

add_heading("15.7 src/types/screening.ts (TypeScript)", 2)
add_para(
    "TypeScript types mirroring the Python FastAPI service contracts: "
    "ScreeningRequest, ScreeningJobResponse, ScreeningResult, CandidateResult."
)

add_heading("15.8 src/routes/agents/index.ts (TypeScript)", 2)
add_para(
    "Agent routes. Three new endpoints: POST /screening/screen, "
    "GET /screening/jobs/:pythonJobId, GET /screening/:jobId/result."
)

doc.add_page_break()

# ─── SAVE ─────────────────────────────────────────────────────────────────────
doc.save("./agent-home/candidate_screening/candidate_screening_documentation.docx")
print("Documentation saved to ./agent-home/candidate_screening/candidate_screening_documentation.docx")
