// PROTOTYPE — NOT PRODUCTION. Synthetic fixtures use current workflow vocabulary.
export const fixtures = [
  {
    id: 'workflow', title: 'Branched review workflow',
    question: 'Can a grouped workflow preserve readable branches, labels, and a retry loop?',
    labels: ['Inspect source', 'Trusted change?', 'Static evidence', 'Run focused tests', 'Review findings', 'Repair accepted findings', 'Fresh review'],
    source: `flowchart LR
  subgraph evidence[Collect evidence]
    A[Inspect source] --> B{Trusted change?}
    B -->|No| C[Static evidence]
    B -->|Yes| D[Run focused tests]
  end
  C --> E[Review findings]
  D --> E
  E --> F{Human decision}
  F -->|Accept| G[Repair accepted findings]
  G --> H[Fresh review]
  H --> E
  F -->|Reject| I[Retain finding disposition]
  F -->|Undecided| J[Wait for a decision]`,
  },
  {
    id: 'sequence', title: 'Feedback delivery with recovery',
    question: 'Are messages, alternative branches, and recovery steps legible?',
    labels: ['Save feedback', 'Claim event', 'Read current artifact', 'Apply authorized revision', 'Keep feedback queued', 'Resume original conversation', 'Show reply'],
    source: `sequenceDiagram
  participant U as Human reviewer
  participant B as Review browser
  participant R as Review runtime
  participant A as Originating agent
  U->>B: Save feedback
  B->>R: Store revision-bound event
  alt Conversation available
    R->>A: Claim event
    A->>R: Read current artifact
    A->>A: Apply authorized revision
    A-->>R: Save reply and revision
  else Conversation unavailable
    R->>R: Keep feedback queued
    U->>A: Resume original conversation
    R->>A: Claim saved event
    A-->>R: Save reply
  end
  R-->>B: Show reply`,
  },
  {
    id: 'domain', title: 'Review domain relationships',
    question: 'Do entity names, attributes, cardinalities, and relationship labels stay readable?',
    labels: ['CONVERSATION', 'ARTIFACT', 'REVISION', 'FEEDBACK', 'FINDING', 'DECISION'],
    source: `erDiagram
  CONVERSATION ||--o{ ARTIFACT : originates
  ARTIFACT ||--|{ REVISION : renders
  REVISION ||--o{ FEEDBACK : binds
  REVISION ||--o{ FINDING : contains
  FINDING ||--o| DECISION : receives
  CONVERSATION ||--o{ FEEDBACK : processes
  CONVERSATION {
    string id PK
    string harness
    string workspace
  }
  ARTIFACT {
    string path PK
    string purpose
  }
  REVISION {
    string digest PK
    string artifact_path FK
  }
  FEEDBACK {
    string id PK
    string processing_state
  }
  FINDING {
    string id PK
    string severity
  }
  DECISION {
    string finding_id FK
    string disposition
  }`,
  },
  {
    id: 'chart', title: 'Numeric chart with long categories',
    question: 'Can a narrow chart show its values and category labels without collisions?',
    labels: ['Evidence', 'Validation', 'Feedback', 'Publication'],
    source: `xychart-beta
  title "Synthetic review stage duration"
  x-axis ["Evidence", "Validation", "Feedback", "Publication"]
  y-axis "Seconds" 0 --> 60
  bar [32, 54, 18, 9]
  line [28, 46, 15, 7]`,
  },
];
