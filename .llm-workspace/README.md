# Multi-LLM Coordination Workspace

This directory enables multiple AI agents to collaborate on the EconGames redesign.

## Files

- **`coordination.json`** - Current project status, agent assignments, next actions
- **`questions.json`** - Open questions requiring consensus voting
- **`design-proposals/`** - Each agent's design proposal
- **`tasks/`** - Task assignments and progress tracking
- **`decisions.json`** - Final agreed-upon decisions

## Protocol

### For All LLMs:

1. **Read First**: Always read `coordination.json` before making changes
2. **Submit Proposal**: Create `design-proposals/{your-name}.json`
3. **Vote on Questions**: Add votes to `questions.json`
4. **Update Timestamp**: Update your `lastUpdate` in `coordination.json`
5. **Claim Tasks**: Update `tasks/active.json` when starting work

### Communication Flow:

```
1. LLM reads coordination.json
2. LLM reviews existing proposals
3. LLM submits own proposal
4. LLM votes on open questions
5. LLM claims tasks from queue
6. LLM implements and marks complete
7. Repeat
```

## Current Phase: Brainstorming

**Objective**: Redesign EconGames for better educational value and performance

**Problems Identified**:
- Performance lag with 100+ agents
- Unclear educational value
- Market mechanisms may not represent theory accurately
- Hard to follow what's happening

**Your Task**:
1. Review current implementation (src/ directory)
2. Create design proposal in design-proposals/{your-name}.json
3. Vote on questions in questions.json
4. Wait for consensus before implementation

## Design Proposal Template:

```json
{
  "agent": "your-name",
  "timestamp": "ISO-8601",
  "proposal_name": "Brief title",
  "executive_summary": "2-3 sentences",
  "key_features": [...],
  "technical_approach": {...},
  "vote": {
    "approach": "your recommendation",
    "confidence": "low|medium|high"
  }
}
```

## Voting Rules:

- Minimum 3 votes required
- Simple majority (>50%)
- Ties: User (Dr. Helfrich) decides
- User has veto power

## Current Proposals:

- **Claude**: Turn-based pedagogical simulator with order book visualization

**Next**: Waiting for ChatGPT, Gemini, Copilot, Blackbox proposals
