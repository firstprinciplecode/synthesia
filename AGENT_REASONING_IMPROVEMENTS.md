# Agent Reasoning Improvements

## Overview
Upgraded agent reasoning from heuristic-based pattern matching to LLM-driven structured decision-making.

## Changes Made

### 1. Tool Catalog Visibility
**File**: `backend/src/agents/agent-orchestrator.ts`

Added `formatToolCatalog()` function that exposes all available tools to the agent:
- Shows tool name, function, description, and tags
- Makes tools discoverable by the LLM
- No more guessing which tools exist

**Before**: Agents relied on hardcoded heuristics to know which tools to use
**After**: Agents see the full tool catalog and reason about which tool fits the user's intent

### 2. Structured Reasoning Phases
Added new decision types to force step-by-step reasoning:

1. **type="understand"**: Agent analyzes what the user wants
   - Extracts core intent
   - Identifies requirements
   - Considers conversation context

2. **type="plan"**: Agent decides which action to take
   - Explains chosen approach
   - Specifies which tool (if any) and why
   - Or explains why no tool is needed (creative response)

3. **type="tool"**: Execute the planned tool
4. **type="write"**: Respond to user with personality
5. **type="stop"**: Task complete

### 3. Removed Heuristics
**Deleted**: Lines 149-230 (regex-based pattern matching)

**Removed patterns**:
- Numeric selection ("link 4", "read 2", "third article")
- News query detection ("latest", "today", "headlines")
- Topic extraction with regex substitutions
- Hardcoded special cases

**Why**: These heuristics were brittle, required constant maintenance, and couldn't handle variations. The LLM can reason about user intent more flexibly.

### 4. Updated Decision Prompt
Comprehensive prompt that:
- Lists all available tools
- Defines decision phases
- Explains when to use tools vs creative writing
- Handles tool approval policy
- Provides concrete examples

## Benefits

1. **Smarter**: Agent reasons about what tools to use instead of matching regex patterns
2. **More Flexible**: Can handle variations in user requests naturally
3. **Transparent**: "understand" and "plan" phases show agent's reasoning
4. **Maintainable**: Adding new tools doesn't require new heuristics
5. **Extensible**: Easy to add more decision types or reasoning phases

## Testing

### Test with Buzz Daly
1. News queries: "What's happening with SpaceX?"
2. Article selection: "Read the third article"
3. Creative requests: "Write a segment about AI"
4. Mixed queries: "Find news about Tesla then tell me about it"

### Expected Behavior
- Agent should show "Understanding:" and "Plan:" in analysis
- Should correctly identify when to use tools vs write creatively
- Should handle article selection without hardcoded patterns
- Should ask for approval (if autoExecuteTools=false) with clear tool+args

## Rollback Plan
If issues arise:
```bash
git checkout backend/src/agents/agent-orchestrator.ts
cd backend && npm run build
```

## Future Enhancements
- Add "reflect" phase for self-correction after tool execution
- Implement tool usage learning (track which tools work best)
- Add multi-tool planning (chain multiple tools in one plan)
- Context-aware tool selection (prefer tools based on conversation history)


