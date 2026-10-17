# Vshow --- Product Requirements Document (PRD)

**Document status:** Draft v1.0\
**Product:** Vshow\
**Purpose:** Define the product scope, users, workflows, requirements,
and acceptance criteria before implementation.

## 1. Product overview

Vshow is a campus screen media submission and approval workflow
platform. It replaces the current email-driven process used to collect
media from campus committees, obtain Corporate Communication approval,
and hand approved media to the Server Room Manager for scheduling in the
campus's existing digital-signage software.

Vshow is the workflow and source-of-truth layer for submissions,
approvals, versions, and handoff status. In Phase 1, it does **not**
replace the existing signage player or automatically control what is
playing on every screen.

## 2. Problem statement

The current process relies on email and manual handoffs. This makes it
difficult to: - See the current status of a media request. - Keep the
latest media file and approval decision linked together. - Ensure
changed media is reviewed again. - Communicate screen and timing
preferences consistently. - Track what the Server Room Manager has
received and scheduled. - Maintain a reliable history of decisions and
changes.

## 3. Goals and success criteria

### Goals

1.  Provide one place to submit and track campus screen-media requests.
2.  Enforce a review workflow owned by Corporate Communication.
3.  Preserve every uploaded media version and associate approval with
    the exact version reviewed.
4.  Let conveners request one or more screens and preferred display
    windows.
5.  Give the Server Room Manager an approved-media handoff and a way to
    record scheduling progress.
6.  Enforce role- and committee-aware access on the server, not only in
    the UI.
7.  Maintain an audit trail for important workflow actions.

### Initial success indicators

-   A convener can submit a request without email-based handoffs.
-   A reviewer can approve, reject, or request changes with a recorded
    decision.
-   A changed file cannot remain approved under an earlier version's
    approval.
-   The manager can identify and download only the currently approved
    version.
-   Users can see request status and decision history.
-   Unauthorized users cannot read or change requests outside their
    permitted scope.

## 4. Scope

### Phase 1 --- required

-   Authentication through VOSS vauth using OAuth Authorization Code
    with PKCE.
-   Local Vshow user records and role/committee authorization.
-   Committee convener submission flow.
-   Upload and version history for media files.
-   Selection of one or more requested screens.
-   Preferred display date/time window and notes.
-   Corporate Communication review queue.
-   Approve, reject, and request-changes decisions with comments.
-   Mandatory re-review after any media-file change.
-   Request status and decision history.
-   Server Room Manager queue containing currently approved versions.
-   Manager download/access to approved media and manual recording of
    scheduling progress.
-   Basic admin management of users, roles, committees, memberships, and
    screens.
-   Audit events for important actions.

### Phase 1 --- explicitly out of scope

-   Replacing the existing digital-signage player or scheduling
    software.
-   Automatic publishing to signage players.
-   Automatic detection of what is currently playing.
-   A synchronized, real-time timeline across every screen.
-   Automatic conflict resolution or automatic allocation of requested
    times.
-   Billing, public self-registration, or public-facing media discovery.
-   Approval decisions based on AI.

### Phase 2 --- possible future scope

-   Consolidated visual timeline across screens.
-   Current/upcoming playback visibility and playback synchronization,
    subject to player/vendor integration.
-   Integration with the campus signage platform if it exposes a
    supported API.
-   Notifications and reporting enhancements.

## 5. Users and permissions

### 5.1 Committee Convener

-   Create submissions for committees they are authorized to represent.
-   Upload a media file and create subsequent versions.
-   Select requested screens and preferred display windows.
-   Submit for review.
-   View their permitted submissions, status, reviewer comments, and
    history.
-   Respond to change requests by uploading a new version.
-   Cannot approve their own submission or mark it as scheduled/playing.

### 5.2 Corporate Communication Reviewer

-   View the review queue and submissions within the reviewer's assigned
    scope.
-   Review the exact media version submitted for review.
-   Approve, reject, or request changes with a comment where required by
    policy.
-   View prior versions and review history.
-   Cannot approve a version that is no longer the current version.

### 5.3 Server Room Manager

-   View submissions whose current media version has been approved.
-   Download the exact approved version.
-   View requested screens and preferred windows as planning
    information.
-   Record a scheduling outcome, actual scheduled window, screen,
    external schedule reference (if available), and notes.
-   Mark a schedule as manually confirmed playing only if the campus
    process allows that confirmation.
-   Cannot change media or grant approval.

### 5.4 Administrator

-   Manage local Vshow users, roles, committee records, memberships,
    screens, and assignments.
-   View audit history.
-   Administrative access does not silently bypass the approval/version
    rules; privileged overrides, if ever introduced, must be explicit
    and audited.

## 6. Core workflow

1.  **Draft:** A convener creates a submission, adds a
    title/description, uploads media, and chooses requested screens and
    preferred display windows.
2.  **Submit:** The convener submits the current version. The submission
    becomes pending review.
3.  **Review:** Corporate Communication reviews the exact version and
    records one of:
    -   **Approved:** that exact version is approved for manager
        handoff.
    -   **Rejected:** the request is declined.
    -   **Changes requested:** the convener must update the media or
        details before resubmitting.
4.  **Revision:** Any media-file replacement creates a new immutable
    media version. The new version is not approved by the old decision
    and must go through review again. Changes to approval-relevant
    content such as the media file, title/description, or requested
    screen/time details should also invalidate the prior approval
    according to the implementation policy.
5.  **Manager handoff:** The manager sees only submissions whose
    *current* version is approved and can access that exact file.
6.  **Scheduling:** The manager decides how to handle overlaps and
    operational constraints in the existing signage system. Requested
    screens/times are preferences, not guaranteed bookings.
7.  **Status update:** The manager records scheduled details.
    "Approved," "Scheduled," and "Playing" are distinct states; Phase 1
    playing status is manual and is not proof from a player integration.
8.  **Audit:** Important actions and decisions are recorded with actor,
    timestamp, and relevant version/reference.

## 7. Functional requirements

  -----------------------------------------------------------------------
  ID                      Requirement             Priority
  ----------------------- ----------------------- -----------------------
  FR-01                   Authenticate users only Must
                          through VOSS vauth; no  
                          Vshow password login.   

  FR-02                   Match the verified      Must
                          vauth email to a local  
                          Vshow user; deny access 
                          if no eligible local    
                          record exists.          

  FR-03                   Enforce role, committee Must
                          membership, and         
                          resource-level          
                          authorization on every  
                          protected server        
                          endpoint.               

  FR-04                   Allow an authorized     Must
                          convener to create,     
                          edit, and submit a      
                          request.                

  FR-05                   Allow a request to      Must
                          specify multiple        
                          requested screens and   
                          preferred display       
                          windows.                

  FR-06                   Store media in object   Must
                          storage and keep        
                          storage keys/metadata   
                          in PostgreSQL; do not   
                          route large file bytes  
                          through serverless      
                          request bodies.         

  FR-07                   Preserve media versions Must
                          rather than overwriting 
                          a file in place.        

  FR-08                   Bind each review        Must
                          decision to the exact   
                          media version reviewed. 

  FR-09                   Support approve,        Must
                          reject, and             
                          request-changes         
                          outcomes with reviewer  
                          identity, timestamp,    
                          and comments.           

  FR-10                   Any new media version   Must
                          must require a new      
                          review before manager   
                          handoff.                

  FR-11                   Show a status/history   Must
                          view to authorized      
                          users.                  

  FR-12                   Expose only the current Must
                          approved version to the 
                          manager download        
                          workflow.               

  FR-13                   Let the manager record  Must
                          scheduling details and  
                          status manually.        

  FR-14                   Maintain an audit trail Must
                          for submissions,        
                          version creation,       
                          review decisions, and   
                          scheduling changes.     

  FR-15                   Let administrators      Must
                          manage users, role      
                          assignments,            
                          committees,             
                          memberships, and        
                          screens.                

  FR-16                   Validate file type,     Must
                          size, metadata, and     
                          upload authorization on 
                          the server.             

  FR-17                   Keep requested display  Must
                          preferences separate    
                          from actual             
                          manager-confirmed       
                          scheduling.             

  FR-18                   Support the Phase 1     Must
                          interface without       
                          requiring a signage     
                          player integration.     
  -----------------------------------------------------------------------

## 8. Status model

Submission workflow status should be kept separate from media-version
review status and scheduling status where possible.

Suggested submission statuses: - `DRAFT` - `PENDING_REVIEW` -
`CHANGES_REQUESTED` - `APPROVED` - `REJECTED` - `CANCELLED`

Suggested review decision values: - `APPROVED` - `REJECTED` -
`CHANGES_REQUESTED`

Suggested scheduling statuses: - `NOT_SCHEDULED` - `SCHEDULED` -
`PLAYING_CONFIRMED` (manual confirmation in Phase 1) - `COMPLETED` -
`CANCELLED`

The system must not infer that an item is scheduled or playing merely
because it is approved. If a new version is created, the previous
version's approval remains in history but does not authorize the new
version.

## 9. Security, privacy, and reliability requirements

-   Validate OAuth issuer, signature, audience/client, expiry, state,
    nonce, and PKCE according to the auth library/provider
    configuration.
-   Never trust a role or committee membership supplied by the browser
    or identity provider; Vshow owns authorization.
-   Keep OAuth client secrets, database URLs, storage credentials, and
    signing secrets server-side.
-   Use short-lived, scoped signed upload/download URLs where supported;
    do not expose permanent object-storage credentials.
-   Enforce upload content-type and size limits; treat client-provided
    filenames and MIME types as untrusted.
-   Prevent unauthorized access to private media objects.
-   Use database transactions for state changes that must be atomic,
    such as creating a new current version and invalidating current
    approval.
-   Log actor and timestamp for privileged actions; do not log access
    tokens or secrets.
-   Apply migrations in a controlled, versioned manner. Never run
    destructive reset operations against a configured remote database.

## 10. Non-functional requirements

-   Responsive interface for common desktop and mobile browsers.
-   Clear empty, loading, error, and permission-denied states.
-   Consistent timestamps stored in UTC and displayed in the user's
    relevant timezone.
-   Database constraints and indexes for common queue/status lookups.
-   Maintainable TypeScript code with schema validation at API
    boundaries.
-   Basic automated tests for permissions, version invalidation, and
    state transitions.

## 11. Key acceptance criteria

1.  An unauthenticated user cannot access protected application data.
2.  A verified vauth identity without a provisioned local user is denied
    access with a clear message.
3.  A convener cannot access or modify another committee's submission
    unless authorized for that committee.
4.  A reviewer decision records the exact version reviewed.
5.  If a new media version is uploaded after approval, the new version
    is pending review and cannot appear in the manager's approved queue.
6.  The manager can download only the currently approved media version.
7.  Requested windows and manager-confirmed schedule windows are stored
    separately.
8.  Marking a request approved does not automatically mark it scheduled
    or playing.
9.  A reviewer can request changes with comments and the convener can
    upload a new version.
10. Important changes appear in an audit history.
11. A scheduling conflict can be handled manually by the manager without
    corrupting the original requested preferences.
12. The application works without direct integration with the signage
    player.

## 12. Open decisions to confirm before implementation

The following remain unresolved and should be settled before production implementation:

- Exact accepted file types and maximum upload size.
- Whether administrators may also be assigned operational roles such as convener, reviewer, or manager.
- Whether actual scheduling needs recurring entries beyond multiple separate schedule entries per screen.
- Which S3-compatible storage provider will be used, including signed upload/download mechanism and object-key policy.
- Whether Vercel Hobby plan terms and limits are suitable for the intended institutional deployment.
- Retention duration and any privacy/legal exceptions for retained media and audit records.
- The stable subject claim provided by vauth and the operational process for provisioning local users.
- Whether a submission's title/description and requested-screen/window changes are edited in place or recorded as immutable submission revisions. Either implementation must invalidate prior approval and preserve audit history.

## 13. Confirmed product decisions

- **One media asset per submission:** each submission represents one logical media asset with multiple immutable versions.
- **Multiple requested windows:** a submission can request multiple preferred display windows, including multiple windows for the same screen.
- **Global reviewer queue:** any authorized Corporate Communication reviewer can review any submission; Phase 1 has no committee-specific reviewer assignment.
- **Manual playing status:** the Server Room Manager can mark a schedule as playing-confirmed manually; the UI must not imply player telemetry.
- **Reapproval on approval-relevant changes:** media replacement and changes to title, description, requested screens, or requested windows require review again.
- **Retain history:** retain old media versions and review/audit history for auditability. Retention duration and exceptional deletion rules remain to be defined.

## 14. Proposed architecture boundary

-   **Web application:** existing React Router framework-mode
    application using React, TypeScript, Vite, and Tailwind CSS.
-   **Authentication:** VOSS vauth via OAuth/OIDC; Better Auth handles
    the application session/integration.
-   **Application data:** Neon PostgreSQL accessed through Drizzle ORM.
-   **Media binary storage:** S3-compatible object storage; PostgreSQL
    stores object keys and metadata only.
-   **Hosting:** Vercel serverless/runtime, subject to verifying plan
    limits and terms.
-   **Signage execution:** existing campus signage software remains
    responsible for actual playback in Phase 1.


## 15. Phase 1 implementation notes (recorded after approval)

- Accepted media: JPEG, PNG, WebP and MP4, 100 MiB per file by default (configurable); size, declared type and the actual file signature are validated server-side. Media is stored in Neon Object Storage (a private bucket) and reached with short-lived signed URLs; it is not scanned for malware.
- Resolved from §12: administrators do **not** implicitly hold operational roles; the storage provider is Neon Object Storage; approval-relevant history uses an immutable `submission_revision` snapshot (see the schema document, §12).
- Rejected submissions are terminal; a resubmission is a new linked submission with its own version 1 and no inherited approval.
- The Server Room Manager arranges overlapping requested windows into a playback loop in the existing signage software, outside Vshow.
- **Implemented since:** the manager queue (current approved revision only), download of the approved version, a simple "mark done" / "undo" that records one `SCHEDULED` entry per requested screen, and admin management of user roles and committee memberships.
- **Not yet implemented (open against §4 and §7):** admin management of committees and screens (part of FR-15), an admin audit-history view, manager entry of an actual window, different screen or external reference (FR-13, FR-17), manual `PLAYING_CONFIRMED` and `COMPLETED` statuses, withdrawal of a pending submission, and audit events for role and membership changes. The README's "Implementation status" table tracks each item.
