# Features

This directory contains documentation for all application features.

## Available Feature Categories

### Agentic Workflows
AI-powered automation using LangChain and LangGraph.

**Location:** [agentic-workflows/](agentic-workflows/)

**Implemented Features:**
- **Intelligent Resume Parsing** - LLM-powered extraction from PDF/DOCX resumes
- **Semantic Matching** - Vector embedding similarity for job-candidate matching
- **Interview Scheduling** - State machine workflow for scheduling coordination

**Planned Features:**
- Background Verification Agent
- Job Description Generator
- Candidate Communication Agent
- Onboarding Orchestration

## Feature Templates

When adding new features, follow this structure:

```
features/
├── README.md                    # This file
├── agentic-workflows/           # AI/LLM features
│   ├── README.md
│   ├── feature-[name].md       # One file per feature
│   └── ...
└── [category]/                  # Other feature categories
    ├── README.md
    └── feature-[name].md
```

## Contributing

Each feature document should include:
1. Overview and purpose
2. Technical architecture/flow diagram
3. API endpoints (if applicable)
4. User stories with acceptance criteria
5. Configuration options
6. Dependencies
7. Future enhancement ideas
