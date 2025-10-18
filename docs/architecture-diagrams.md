# PeerPrep Architecture Diagrams - Milestone 2

## Table of Contents

1. [Overall System Architecture](#1-overall-system-architecture)
2. [User Request Flow Diagram](#2-user-request-flow-diagram)
3. [Question Service Architecture](#3-question-service-architecture)
4. [Matching Service Architecture](#4-matching-service-architecture)
5. [Collaboration Service Architecture](#5-collaboration-service-architecture)
6. [Database Architecture](#6-database-architecture)
7. [CI/CD Pipeline](#7-cicd-pipeline)
8. [Deployment Architecture](#8-deployment-architecture)
9. [Sequence Diagrams](#9-sequence-diagrams)

---

## 1. Overall System Architecture

```mermaid
graph TB
    subgraph "Client Layer"
        UI[Next.js Frontend<br/>Vercel Deployed]
    end

    subgraph "API Gateway Layer"
        Gateway[API Gateway Service<br/>Port: 8000]
    end

    subgraph "Microservices Layer"
        UserService[User Service<br/>Port: 6001]
        QuestionService[Question Service<br/>Port: 6002]
        MatchingService[Matching Service<br/>Port: 6006]
        CollabService[Collaboration Service<br/>Port: 6004]
    end

    subgraph "Data Layer"
        MongoDB[(MongoDB<br/>Question DB)]
        Supabase[(Supabase<br/>User & Auth<br/>Queue Storage)]
        Redis[(Redis<br/>Matching Queue)]
    end

    subgraph "Real-time Layer"
        SupabaseRT[Supabase Realtime<br/>WebSocket]
    end

    subgraph "Code Execution"
        Piston[Piston API<br/>Code Runner]
    end

    UI -->|HTTPS| Gateway
    Gateway -->|HTTP| UserService
    Gateway -->|HTTP| QuestionService
    Gateway -->|HTTP| MatchingService
    Gateway -->|HTTP| CollabService

    UserService -->|Query| Supabase
    QuestionService -->|Query| MongoDB
    MatchingService -->|Preference| Redis
    MatchingService -->|Queue| Supabase
    CollabService -->|WebSocket| SupabaseRT

    UI -->|WebSocket| SupabaseRT
    UI -->|HTTP| Piston

    style UI fill:#4CAF50
    style Gateway fill:#2196F3
    style UserService fill:#FF9800
    style QuestionService fill:#FF9800
    style MatchingService fill:#FF9800
    style CollabService fill:#FF9800
```

---

## 2. Collaboration Flow Diagram

```mermaid
sequenceDiagram
    participant Client as Frontend Client
    participant Gateway as API Gateway
    participant Service as Microservice
    participant Domain as Domain Layer
    participant DB as Database

    Client->>Gateway: 1. HTTP Request<br/>(e.g., GET /api/collaboration-service/sessions/123)
    Gateway->>Gateway: 2. Route Resolution<br/>(Match /collaboration-service/* pattern)
    Gateway->>Service: 3. Forward to Collaboration Service<br/>(GET /sessions/123)
    Service->>Domain: 4. Invoke Collaboration Domain<br/>(getSessionById)
    Domain->>DB: 5. Database Query
    DB-->>Domain: 6. Return session Data
    Domain-->>Service: 7. Return Domain Object
    Service-->>Gateway: 8. HTTP Response (200 OK)
    Gateway-->>Client: 9. Forward Response

    Note over Client,DB: Typical request flow through microservices
```

---

## 3. Question Service Architecture

```mermaid
graph TB
    subgraph "Question Service"
        QController[Question Controller<br/>REST Endpoints]
        QDomain[Question Domain Layer]
        QRepo[Question Repository]

        QController -->|Uses| QDomain
        QDomain -->|CRUD Operations| QRepo
    end

    subgraph "MongoDB Schema"
        QuestionDoc[Question Document<br/>- questionId: string<br/>- title: string<br/>- content: string<br/>- difficulty: enum<br/>- tags: array<br/>- codeSnippets: array<br/>- testCases: array]
    end

    QRepo -->|Query| QuestionDoc

    subgraph "API Endpoints"
        E1[GET /questions<br/>Filter by difficulty & topics]
        E2[GET /questions/:id<br/>Get specific question]
        E3[GET /questions/random<br/>Get random question]
    end

    E1 -.->|Handled by| QController
    E2 -.->|Handled by| QController
    E3 -.->|Handled by| QController

    style QuestionDoc fill:#4DB33D
```

**Database Choice Justification:**

- **MongoDB** chosen for flexible schema to store arrays (tags, codeSnippets, testCases)
- Allows nested objects for language-specific code snippets
- Easy querying with filters (difficulty, tags)
- Horizontal scaling capabilities for large question banks

---

## 4. Matching Service Architecture

```mermaid
graph TD
    matchFound[Match Found]
    
    subgraph "Matching Service"
        MController[Matching Controller] -->|2. Process Request| MService[Matching Service]
    end

    subgraph "Data Stores"
        Redis[(Redis Cache)]
        Supabase[(Supabase DB<br/>Queue & Preferences)]
    end

    subgraph "External Systems"
        CollabSvc[Collaboration Service]
        WebSocket[WebSocket Manager]
    end

    User[User] -->|1. Request Match| MController

    MService -->|3. Read/Write Cache| Redis
    MService -->|4. Read/Write DB| Supabase
    MService --> matchFound -->|5. Create Room API Call| CollabSvc
    matchFound -->|6. Send Match Notification| WebSocket

WebSocket -->|7. Push Notification to User| User

style MService fill:#BDE0FE,stroke:#333,stroke-width:2px
```

**Matching Algorithm:**

```mermaid
flowchart TD
    Start([User Requests Match]) --> AddToQueue[Add User to Queue &<br/>Trigger Matching Process]

    AddToQueue --> CheckQueue{Are there at least<br/>2 users in the queue?}
    CheckQueue -- No --> Wait[Wait for more users]

    CheckQueue -- Yes --> FindPairs[Iterate through users<br/>to find the best possible pairs]

    FindPairs --> MatchFound{Pair Found?}

    MatchFound -- No Match This Round --> Wait

    MatchFound -- Yes, Pair Found! --> CreateRoom[Create Collaboration Room<br/>& Notify Both Users]

    CreateRoom --> RemoveFromQueue[Remove Matched Users<br/>from Queue]

    style CreateRoom fill:#4CAF50
```

**Edge Cases Handled:**

- Simultaneous requests → Supabase atomic operations
- User disconnects → Remove from queue
- Duplicate requests → Check existing queue entry

---

## 5. Collaboration Service Architecture

```mermaid
graph TB
    subgraph "Frontend Clients"
        Client1[User A Browser]
        Client2[User B Browser]
    end

    subgraph "Collaboration Service"
        CController[Collaboration Controller]
        SessionMgr[Session Manager]
        CodeSync[Code Sync Handler]
    end

    subgraph "Supabase Realtime"
        Channel[Realtime Channel]
        Presence[Presence Tracking]
        Broadcast[Broadcast Events]
    end

    subgraph "Storage"
        SupaDB[(Supabase DB<br/>Session Storage)]
    end

    Client1 -->|WebSocket| Channel
    Client2 -->|WebSocket| Channel
    Channel -->|Presence Events| Presence
    Channel -->|Code Updates| Broadcast

    CController -->|Manage| SessionMgr
    SessionMgr -->|Store| SupaDB
    CodeSync -->|Listen| Channel
    CodeSync -->|Sync| Broadcast

    Broadcast -->|Real-time Updates| Client1
    Broadcast -->|Real-time Updates| Client2

    style Channel fill:#3ECF8E
```

**Real-time Collaboration Flow:**

```mermaid
sequenceDiagram
    participant U1 as User A
    participant Channel as Supabase Channel
    participant U2 as User B

    U1->>Channel: Join room-123
    U2->>Channel: Join room-123
    Channel->>U1: Presence: User B joined
    Channel->>U2: Presence: User A joined

    U1->>U1: Types code
    U1->>Channel: Broadcast: code_update
    Channel->>U2: Receive: code_update
    U2->>U2: Apply code changes

    U2->>U2: Types code
    U2->>Channel: Broadcast: code_update
    Channel->>U1: Receive: code_update
    U1->>U1: Apply code changes

    Note over U1,U2: Real-time synchronization via WebSocket
```

**Technology Stack:**

- **Supabase Realtime** (WebSocket-based)
- **Presence API** for user tracking
- **Broadcast API** for code synchronization
- **CodeMirror** for collaborative editing

---

## 6. Database Architecture

```mermaid
graph TB
    subgraph "Supabase PostgreSQL"
        users["
            <b>users</b>
            <hr>
            - uuid: id (PK)<br/> 
            - timestamptz: created_at<br/>
            - text: name<br/>
            - text: email<br/>
            - text: avatar_url<br/>
            - boolean: in_queue<br/>
            - uuid: match_id
            "]
            
            user_preferences["
            <b>user_preferences</b>
            <hr>
            - uuid: user_id (PK, FK)<br/>
            - ARRAY: topics<br/>
            - varchar: difficulty
            "]
            
            sessions["
            <b>sessions</b>
            <hr>
            - uuid: id (PK)<br/>
            - text: interviewer_id (FK)<br/>
            - text: interviewee_id (FK)<br/>
            - text: status<br/>
            - text: current_code<br/>
            - timestamptz: created_at<br/>
            - timestamptz: updated_at<br/>
            - text: question_id
        "]
    end

    subgraph "MongoDB"
        Questions["Questions Collection<br/>- questionId: string<br/>- title: string<br/>- content: html<br/>- difficulty: string<br/>- tags: array<br/>- codeSnippets: array<br/>- testCases: array"]
    end

    subgraph "Redis"
        PreferenceCache["User Preference Cache<br/>Key: user_match_pref:{userId}<br/>Value: JSON of prefs"]
        MatchStatusCache["Match Status Cache<br/>Key: matches:{matchId}<br/>Value: JSON of match data"]
    end

    sessions -.->|References| Questions
    
    %% --- Relationships ---
    users -- "one-to-one" --> user_preferences
    users -- "one-to-many (interviewer)" --> sessions
    users -- "one-to-many (interviewee)" --> sessions
    
    style users fill:#3ECF8E
    style sessions fill:#3ECF8E
    style user_preferences fill:#3ECF8E
    style Questions fill:#4DB33D
    style PreferenceCache fill:#DC382D
    style MatchStatusCache fill:#DC382D
```

---

## 7. CI/CD Pipeline

```mermaid
graph LR
    subgraph "Source Control"
        GitHub[GitHub Repository]
    end

    subgraph "CI Pipeline - Backend"
        Trigger1[Push to Branch]
        Build1[Build Services<br/>npm ci]
        Test1[Run Tests<br/>Jest]
        Lint1[Lint Code<br/>ESLint]
        Docker1[Build Docker Images]
    end

    subgraph "CI Pipeline - Frontend"
        Trigger2[Push to Branch]
        Build2[Build Next.js<br/>npm run build]
        Test2[Run Tests]
        Deploy[Deploy to Vercel]
    end

    subgraph "Planned CD Pipeline"
        Push[Push Docker Images<br/>to ECR/Docker Hub]
        Deploy2[Deploy to AWS<br/>Elastic Beanstalk]
        Health[Health Checks]
    end

    GitHub -->|Webhook| Trigger1
    GitHub -->|Webhook| Trigger2

    Trigger1 --> Build1 --> Test1 --> Lint1 --> Docker1
    Trigger2 --> Build2 --> Test2 --> Deploy

    Docker1 -.->|Future| Push
    Push -.->|Future| Deploy2
    Deploy2 -.->|Future| Health

    style Deploy fill:#4CAF50
    style Deploy2 fill:#FF9800
```

**Current CI/CD Status:**

- ✅ **Backend**: Build + Test automation (User & Question services)
- ✅ **Frontend**: Automated deployment to Vercel
- 🔄 **Planned**: Docker image push to AWS ECR
- 🔄 **Planned**: Automated deployment to AWS Elastic Beanstalk

---

## 8. Deployment Architecture

```mermaid
graph TB
    subgraph "Production Environment - AWS"
        subgraph "Elastic Beanstalk"
            EB1[API Gateway<br/>Docker Container]
            EB2[User Service<br/>Docker Container]
            EB3[Question Service<br/>Docker Container]
            EB4[Matching Service<br/>Docker Container]
            EB5[Collaboration Service<br/>Docker Container]
        end

        subgraph "Load Balancer"
            ALB[Application Load Balancer]
        end

        subgraph "Container Registry"
            ECR[Amazon ECR<br/>Docker Images]
        end
    end

    subgraph "External Services"
        Vercel[Vercel<br/>Next.js Frontend]
        MongoDB[MongoDB Atlas]
        Supabase[Supabase Cloud]
        Redis[Redis Cloud]
    end

    Users[End Users] -->|HTTPS| Vercel
    Vercel -->|API Calls| ALB
    ALB --> EB1
    EB1 --> EB2
    EB1 --> EB3
    EB1 --> EB4
    EB1 --> EB5

    ECR -.->|Pull Images| EB1
    ECR -.->|Pull Images| EB2
    ECR -.->|Pull Images| EB3
    ECR -.->|Pull Images| EB4
    ECR -.->|Pull Images| EB5

    EB2 -->|Query| Supabase
    EB3 -->|Query| MongoDB
    EB4 -->|Queue| Redis
    EB5 -->|WebSocket| Supabase

    style Vercel fill:#4CAF50
    style ALB fill:#FF9800
```

**Why AWS Elastic Beanstalk?**

1. **Simplified Container Orchestration**: Automatically handles Docker deployment
2. **Auto-scaling**: Scales based on traffic
3. **Load Balancing**: Built-in ALB for distributing requests
4. **Easy Rollback**: Version management for deployments
5. **Cost-Effective**: Pay only for resources used
6. **Integration**: Works seamlessly with ECR, CloudWatch
7. **Monitoring**: Built-in health monitoring

---

## 9. Sequence Diagrams

### 9.1 Complete User Matching Flow

```mermaid
sequenceDiagram
    participant U1 as User A
    participant Frontend
    participant Gateway as API Gateway
    participant MatchSvc as Matching Service
    participant Supabase as Supabase DB
    participant CollabSvc as Collaboration Service
    participant WebSocket

    U1->>Frontend: Clicks "Find Match"
    Frontend->>Gateway: POST /queue/add
    Gateway->>MatchSvc: Add User A to queue

    MatchSvc->>Supabase: UPDATE users SET in_queue=true WHERE id=A
    MatchSvc->>MatchSvc: processMatchingQueue()
    note right of MatchSvc: Not enough users yet.
    MatchSvc-->>Frontend: HTTP 200 OK (Queued)

%% Some time later... %%

    participant U2 as User B
    U2->>Frontend: Clicks "Find Match"
    Frontend->>Gateway: POST /queue/add
    Gateway->>MatchSvc: Add User B to queue
    MatchSvc->>Supabase: UPDATE users SET in_queue=true WHERE id=B
    MatchSvc->>MatchSvc: processMatchingQueue()

    alt Match Found
        note right of MatchSvc: Algorithm finds A and B match.
        MatchSvc->>CollabSvc: POST /sessions (Create Room)
        CollabSvc-->>MatchSvc: Returns { room_id }
        MatchSvc->>Supabase: Removes A & B from queue
        MatchSvc->>WebSocket: Notify User A (room_id)
        MatchSvc->>WebSocket: Notify User B (room_id)
        WebSocket-->>U1: Pushes notification
        WebSocket-->>U2: Pushes notification
        Frontend->>U1: Redirect to /room/{room_id}
        Frontend->>U2: Redirect to /room/{room_id}
    else No Match Found
        note right of MatchSvc: Users wait for next trigger.
    end
```

### 9.2 Real-time Code Collaboration

```mermaid
sequenceDiagram
    participant U1 as User A Browser
    participant Channel as Supabase Channel
    participant DB as Supabase DB
    participant U2 as User B Browser

    U1->>Channel: Subscribe to room-123
    U2->>Channel: Subscribe to room-123

    Channel->>U1: Presence: User B online
    Channel->>U2: Presence: User A online

    loop Code Editing
        U1->>U1: Type code
        U1->>Channel: Broadcast code_update
        Channel->>U2: Receive code_update
        U2->>U2: Update editor

        Note over Channel,DB: Periodic snapshot every 5s
        Channel->>DB: Save code snapshot
    end

    U1->>Channel: Execute code
    U1->>Piston: Run code
    Piston-->>U1: Execution results
    U1->>Channel: Broadcast results
    Channel->>U2: Show results
```

### 9.3 Question Retrieval Flow

```mermaid
sequenceDiagram
    participant UI as Frontend
    participant Gateway as API Gateway
    participant QService as Question Service
    participant MongoDB as MongoDB

    UI->>Gateway: GET /api/question-service/questions/random?<br/>difficulty=Medium&topics=Array
    Gateway->>QService: GET /questions/random
    QService->>MongoDB: db.questions.aggregate([<br/>{$match: {difficulty: "Medium", tags: "Array"}},<br/>{$sample: {size: 1}}<br/>])
    MongoDB-->>QService: Return random question
    QService-->>Gateway: Question object
    Gateway-->>UI: Question data
    UI->>UI: Display question in room
```

---

## Summary of Architecture Decisions

### 1. **Question Service**

- **Database**: MongoDB for flexible schema
- **Integration**: REST API via API Gateway
- **Scaling**: Horizontal scaling with MongoDB sharding

### 2. **Matching Service**

- **Algorithm**: Batch-processing on a persistent queue, matching users based on shared topics and identical difficulty.
- **Hybrid Data Storage**: Supabase acts as the definitive source of truth for all user data, while Redis serves as a high-speed, in-memory cache for frequently accessed user preferences.
- **Key Integrations**: Supabase for the persistent queue, Redis for caching user preferences, and WebSockets for real-time match notifications.

### 3. **Collaboration Service**

- **Technology**: Supabase Realtime (WebSocket)
- **Real-time**: Code synchronization, presence tracking
- **Scaling**: Supabase handles WebSocket connections

### 4. **Service Containerization**

- **Approach**: Docker + AWS Elastic Beanstalk
- **CI/CD**: GitHub Actions → Build → Test → Push → Deploy
- **Monitoring**: CloudWatch logs, health checks

### 5. **Nice-to-Have Features**

- Code execution (Piston API)
- Language-specific code templates
- Execution history tracking
- Real-time collaboration indicators

---

## How to Use These Diagrams

1. **Copy Mermaid code** to https://mermaid.live
2. **Export as PNG/SVG** for your presentation
3. **Include in documentation** (GitHub renders Mermaid natively)
4. **Use for mentor meetings** to explain architecture
