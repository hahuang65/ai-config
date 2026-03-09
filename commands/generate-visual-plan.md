---
description: Generate a visual HTML implementation plan — detailed feature specification with state machines, code snippets, and edge cases
---
Generate a comprehensive visual implementation plan for `$ARGUMENTS` as a self-contained HTML page.

Before generating, read these reference files:
- `~/.claude/skills/visual-explainer/core.md` (quality guide — aesthetic, typography, color, style, checks)
- `~/.claude/skills/visual-explainer/references/css-patterns.md` (CSS patterns, Mermaid zoom, card depth)
- `~/.claude/skills/visual-explainer/references/libraries.md` (Mermaid theming, font imports)

Use an editorial or blueprint aesthetic, but vary fonts and palette from previous diagrams.

**Data gathering phase** — understand the context before designing:

1. **Parse the feature request.** Extract:
   - The core problem being solved
   - Desired user-facing behavior
   - Any constraints or requirements mentioned
   - Scope boundaries (what's explicitly out of scope)

2. **Read the relevant codebase.** Identify:
   - Files that will need modification
   - Existing patterns to follow (code style, architecture, naming conventions)
   - Related functionality that the feature should integrate with
   - Types, interfaces, and APIs the feature must conform to

3. **Understand the extension points.** Look for:
   - Hook points, event systems, or plugin architectures
   - Configuration options or flags
   - Public APIs that might need extension
   - Test patterns used in the codebase

4. **Check for prior art.** Search for:
   - Similar features already implemented
   - Related issues or discussions
   - Existing code that can be reused or extended

**Design phase** — work through the implementation before writing HTML:

1. **State design.** What new state variables are needed? What existing state is affected? Draw the state machine if behavior has multiple modes.

2. **API design.** What commands, functions, or endpoints are added? What are the signatures? What are the error cases?

3. **Integration design.** How does this feature interact with existing functionality? What hooks or events are involved?

4. **Edge cases.** Walk through unusual scenarios: concurrent operations, error conditions, boundary values, user mistakes.

Apply the verification checkpoint from core.md before generating HTML.

**Diagram structure** — the page should include:

1. **Header** — feature name, one-line description, scope summary. *Visual treatment: use a distinctive header with monospace label ("Feature Plan", "Implementation Spec", etc.), large italic title, and muted subtitle. Set the tone for the page.*

2. **The Problem** — side-by-side comparison panels showing current behavior vs. desired behavior. Use concrete examples, not abstract descriptions. Show what the user experiences or what the code does, step by step. *Visual treatment: two-column grid with rose-tinted "Before" header and sage-tinted "After" header. Numbered flow steps with arrows between them.*

3. **State Machine** — Mermaid flowchart or stateDiagram showing the states and transitions. Label edges with the triggers (commands, events, conditions). *Wrap in `.mermaid-wrap` with zoom controls per core.md. Use `flowchart TD` instead of `stateDiagram-v2` if labels need special characters like colons or parentheses. Add explanatory caption below the diagram.*

4. **State Variables** — card grid showing new state and existing state (if modified). Use code blocks with proper `white-space: pre-wrap`. *Visual treatment: two cards side-by-side, elevated depth, monospace labels.*

5. **Modified Functions** — for each function that needs changes, show:
   - Function name and file path
   - Key code snippet (not full implementation — 10-20 lines showing the pattern)
   - Explanation of what changed and why
   *Visual treatment: file path as monospace dim text above code block, code in recessed card with accent-dim background.*

6. **Commands / API** — table with command/function name, parameters, and behavior description. Use `<code>` for technical names. *Visual treatment: bordered table with sticky header, alternating row backgrounds.*

7. **Edge Cases** — table listing scenarios and expected behaviors. Be thorough — include error conditions, concurrent operations, boundary values. *Visual treatment: same table style as Commands section.*

8. **Test Requirements** — list every individual test case from the plan's Testing Strategy. Each test must appear as its own row with: test file path, test name/description, scenario being validated, and expected outcome. Group by: unit tests, integration tests, edge case tests. Do NOT summarize or collapse tests into categories — every test case must be individually visible. *Visual treatment: table with file path column, test name column, scenario column, and expected result column.*

9. **File References** — table mapping files to the changes needed. Include file paths and brief descriptions. *Visual treatment: compact reference table, can use `<details>` if many files.*

10. **Implementation Notes** — callout boxes for:
    - Backward compatibility considerations (gold border)
    - Critical implementation warnings (rose border)
    - Performance considerations if relevant (amber border)
    *Visual treatment: callout boxes with colored left borders, strong labels.*

**Visual hierarchy:**
- Sections 1-3 should dominate the viewport on load (hero depth for header, elevated for problem comparison and state machine)
- Sections 4-6 are core implementation details (elevated cards, readable code blocks)
- Sections 7-10 are reference material (flat or recessed depth, compact layout)

Use semantic accent colors: gold for primary accents, sage for "after"/success states, rose for "before"/warning states. Follow typography, color, overflow prevention, and code block rules from core.md. Follow output and AI illustration rules from core.md.
