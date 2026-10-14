// Synthetic, deterministic development fixtures. Nothing here is real: every identity uses the
// reserved ".invalid" TLD, every code starts with SEED, and object keys live under "seed/".
// Row objects use database column names so the runner can insert them generically.
import { createHash } from "node:crypto";

export const SEED_EMAIL_DOMAIN = "seed.vshow.invalid";
export const SEED_REF_PREFIX = "SEED-";

/** Deterministic UUID (v5-style) so re-runs target exactly the same rows. */
export function seedId(name: string): string {
  const h = createHash("sha1").update(`vshow-seed:${name}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/** Fixed timeline: day offsets from 2025-09-01 09:00 UTC. */
const at = (day: number, hour = 9) => new Date(Date.UTC(2025, 8, 1 + day, hour)).toISOString();

type Row = Record<string, string | number | boolean | null>;

export const ROLES: Record<string, { name: string; description: string }> = {
  CONVENER: { name: "Committee Convener", description: "Submits media on behalf of a committee" },
  REVIEWER: { name: "Corporate Communication Reviewer", description: "Reviews all submissions" },
  SERVER_ROOM_MANAGER: { name: "Server Room Manager", description: "Schedules approved media" },
  ADMIN: { name: "Administrator", description: "Manages users, roles and committees" },
};

// key -> [display name, role codes]
const USERS: Record<string, [string, string[]]> = {
  admin: ["Admin", ["ADMIN"]],
  reviewer: ["Reviewer", ["REVIEWER"]],
  manager: ["Server Room Manager", ["SERVER_ROOM_MANAGER"]],
  convener_media: ["Convener (Media Club)", ["CONVENER"]],
  convener_robotics: ["Convener (Robotics Club)", ["CONVENER"]],
  convener_lapsed: ["Convener (lapsed Media Club membership)", ["CONVENER"]], // inactive membership
  member_media: ["Member without CONVENER role (Media Club)", []], // membership but no role
  inactive_convener: ["Deactivated Convener (Robotics Club)", ["CONVENER"]], // is_active = false
};
const INACTIVE_USERS = new Set(["inactive_convener"]);

const COMMITTEES = {
  media: ["SEED-MEDIA", "Media Club"],
  robotics: ["SEED-ROBOTICS", "Robotics Club"],
} as const;

// user key -> [committee key, membership type, active]
const MEMBERSHIPS: Array<[string, keyof typeof COMMITTEES, "CONVENER" | "MEMBER", boolean]> = [
  ["convener_media", "media", "CONVENER", true],
  ["convener_robotics", "robotics", "CONVENER", true],
  ["convener_lapsed", "media", "CONVENER", false],
  ["member_media", "media", "MEMBER", true],
  ["inactive_convener", "robotics", "CONVENER", true],
];

const SCREENS = {
  lobby: ["SEED-LOBBY", "Main Lobby Display", "Ground floor lobby", true],
  canteen: ["SEED-CANTEEN", "Canteen Display", "Canteen entrance", true],
  library: ["SEED-LIBRARY", "Library Display (out of service)", "Library reading hall", false],
} as const;

interface VersionSpec {
  n: number;
  day: number;
  type: string;
  size: number;
  note?: string;
}
interface RequestSpec {
  screen: keyof typeof SCREENS;
  slot: number;
  start?: number;
  end?: number;
  note?: string;
}
interface ReviewSpec {
  version: number;
  decision: "APPROVED" | "REJECTED" | "CHANGES_REQUESTED";
  day: number;
  comment?: string;
}
interface ScheduleSpec {
  version: number;
  screen: keyof typeof SCREENS;
  status: string;
  day: number;
  start?: number;
  end?: number;
  note?: string;
}
interface SubmissionSpec {
  n: number;
  committee: keyof typeof COMMITTEES;
  creator: string;
  title: string;
  description: string;
  status: string;
  createdDay: number;
  submittedDay?: number;
  currentVersion: number;
  versions: VersionSpec[];
  requests: RequestSpec[];
  reviews: ReviewSpec[];
  schedules: ScheduleSpec[];
}

const SUBMISSIONS: SubmissionSpec[] = [
  {
    // Committee media submission still being prepared.
    n: 1,
    committee: "media",
    creator: "convener_media",
    title: "Welcome Week Poster (draft)",
    description: "Synthetic: draft not yet submitted.",
    status: "DRAFT",
    createdDay: 1,
    currentVersion: 1,
    versions: [{ n: 1, day: 1, type: "image/png", size: 480_000 }],
    requests: [{ screen: "lobby", slot: 1, start: 10, end: 17 }],
    reviews: [],
    schedules: [],
  },
  {
    // Pending review.
    n: 2,
    committee: "media",
    creator: "convener_media",
    title: "Cultural Fest Teaser",
    description: "Synthetic: waiting in the reviewer queue.",
    status: "PENDING_REVIEW",
    createdDay: 2,
    submittedDay: 3,
    currentVersion: 1,
    versions: [{ n: 1, day: 2, type: "video/mp4", size: 18_500_000 }],
    requests: [
      { screen: "lobby", slot: 1, start: 12, end: 19 },
      { screen: "canteen", slot: 1, start: 12, end: 19 },
    ],
    reviews: [],
    schedules: [],
  },
  {
    // Approved media awaiting manager handoff (no schedule entry yet).
    n: 3,
    committee: "media",
    creator: "convener_media",
    title: "Blood Donation Drive Banner",
    description: "Synthetic: approved, not yet scheduled by the manager.",
    status: "APPROVED",
    createdDay: 2,
    submittedDay: 3,
    currentVersion: 1,
    versions: [{ n: 1, day: 2, type: "image/jpeg", size: 920_000 }],
    requests: [{ screen: "canteen", slot: 1, start: 14, end: 21 }],
    reviews: [{ version: 1, decision: "APPROVED", day: 4 }],
    schedules: [],
  },
  {
    // Rejected with reviewer feedback.
    n: 4,
    committee: "robotics",
    creator: "convener_robotics",
    title: "Sponsor Promo Video",
    description: "Synthetic: rejected by the reviewer.",
    status: "REJECTED",
    createdDay: 3,
    submittedDay: 4,
    currentVersion: 1,
    versions: [{ n: 1, day: 3, type: "video/mp4", size: 42_000_000 }],
    requests: [{ screen: "lobby", slot: 1 }],
    reviews: [
      {
        version: 1,
        decision: "REJECTED",
        day: 5,
        comment: "Synthetic feedback: third-party branding is not permitted on campus screens.",
      },
    ],
    schedules: [],
  },
  {
    // Changes requested, convener uploaded v2 and resubmitted.
    n: 5,
    committee: "robotics",
    creator: "convener_robotics",
    title: "Robo Expo Announcement",
    description: "Synthetic: revised after feedback, back in review.",
    status: "PENDING_REVIEW",
    createdDay: 3,
    submittedDay: 8,
    currentVersion: 2,
    versions: [
      { n: 1, day: 3, type: "video/mp4", size: 25_000_000 },
      { n: 2, day: 7, type: "video/mp4", size: 24_100_000, note: "Shortened intro and fixed date." },
    ],
    requests: [{ screen: "lobby", slot: 1, start: 15, end: 18 }],
    reviews: [
      {
        version: 1,
        decision: "CHANGES_REQUESTED",
        day: 5,
        comment: "Synthetic feedback: event date on slide 2 is wrong.",
      },
    ],
    schedules: [],
  },
  {
    // Approved v1, then replaced by v2: prior approval must NOT make it manager-eligible.
    n: 6,
    committee: "media",
    creator: "convener_media",
    title: "Alumni Meet Reel",
    description: "Synthetic: replaced after approval; needs reapproval.",
    status: "PENDING_REVIEW",
    createdDay: 2,
    submittedDay: 9,
    currentVersion: 2,
    versions: [
      { n: 1, day: 2, type: "video/mp4", size: 30_000_000 },
      { n: 2, day: 8, type: "video/mp4", size: 31_200_000, note: "Added sponsor credits." },
    ],
    requests: [{ screen: "canteen", slot: 1, start: 16, end: 23 }],
    reviews: [{ version: 1, decision: "APPROVED", day: 4 }],
    schedules: [
      {
        version: 1,
        screen: "canteen",
        status: "CANCELLED",
        day: 8,
        start: 16,
        end: 23,
        note: "Synthetic: cancelled because a new version replaced the approved one.",
      },
    ],
  },
  {
    // Approved and scheduled; actual windows differ from requested ones.
    n: 7,
    committee: "robotics",
    creator: "convener_robotics",
    title: "Hackathon Countdown",
    description: "Synthetic: approved and scheduled by the manager.",
    status: "APPROVED",
    createdDay: 4,
    submittedDay: 5,
    currentVersion: 1,
    versions: [{ n: 1, day: 4, type: "video/mp4", size: 12_000_000 }],
    requests: [
      { screen: "lobby", slot: 1, start: 20, end: 27 },
      { screen: "lobby", slot: 2, start: 30, end: 37, note: "Second window on the same screen." },
      { screen: "canteen", slot: 1, start: 20, end: 27 },
    ],
    reviews: [{ version: 1, decision: "APPROVED", day: 6 }],
    schedules: [
      {
        version: 1,
        screen: "lobby",
        status: "SCHEDULED",
        day: 7,
        start: 21,
        end: 26,
        note: "Synthetic: shifted one day later than requested.",
      },
      {
        version: 1,
        screen: "canteen",
        status: "PLAYING_CONFIRMED",
        day: 7,
        start: 20,
        end: 27,
        note: "Synthetic: manually confirmed playing.",
      },
    ],
  },
];

export interface Fixtures {
  users: Row[];
  userRoles: Row[];
  committees: Row[];
  memberships: Row[];
  screens: Row[];
  submissions: Row[];
  mediaVersions: Row[];
  screenRequests: Row[];
  reviewDecisions: Row[];
  scheduleEntries: Row[];
  auditEvents: Row[];
  /** submission id -> current version id (set after versions exist, to satisfy the composite FK). */
  currentVersions: Array<{ submissionId: string; versionId: string }>;
}

const ref = (n: number) => `${SEED_REF_PREFIX}${String(n).padStart(4, "0")}`;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export function buildFixtures(): Fixtures {
  const f: Fixtures = {
    users: [],
    userRoles: [],
    committees: [],
    memberships: [],
    screens: [],
    submissions: [],
    mediaVersions: [],
    screenRequests: [],
    reviewDecisions: [],
    scheduleEntries: [],
    auditEvents: [],
    currentVersions: [],
  };
  const admin = seedId("user:admin");
  const meta = { synthetic: true };
  const audit = (
    key: string,
    actor: string,
    action: string,
    type: string,
    entity: string,
    sub: string | null,
    day: number,
  ) =>
    f.auditEvents.push({
      id: seedId(`audit:${key}`),
      actor_user_id: actor,
      action,
      entity_type: type,
      entity_id: entity,
      submission_id: sub,
      metadata: JSON.stringify(meta),
      ip_hash: null,
      created_at: at(day, 12),
    });

  for (const [key, [name, roles]] of Object.entries(USERS)) {
    const id = seedId(`user:${key}`);
    f.users.push({
      id,
      email: `${key}@${SEED_EMAIL_DOMAIN}`,
      display_name: `[SEED] ${name}`,
      vauth_subject: `seed-${key}`,
      is_active: !INACTIVE_USERS.has(key),
      email_verified: true, // synthetic users; they never pass through real sign-in
      created_at: at(0),
      updated_at: at(0),
    });
    for (const role_code of roles) {
      f.userRoles.push({
        user_id: id,
        role_code,
        assigned_by_user_id: key === "admin" ? null : admin,
        created_at: at(0),
      });
    }
  }
  for (const [key, [code, name]] of Object.entries(COMMITTEES)) {
    f.committees.push({
      id: seedId(`committee:${key}`),
      name: `[SEED] ${name}`,
      code,
      description: "Synthetic committee.",
      is_active: true,
      created_at: at(0),
      updated_at: at(0),
    });
  }
  for (const [user, committee, type, active] of MEMBERSHIPS) {
    f.memberships.push({
      id: seedId(`membership:${user}:${committee}`),
      committee_id: seedId(`committee:${committee}`),
      user_id: seedId(`user:${user}`),
      membership_type: type,
      is_active: active,
      assigned_by_user_id: admin,
      created_at: at(0),
    });
  }
  for (const [key, [code, name, location, active]] of Object.entries(SCREENS)) {
    f.screens.push({
      id: seedId(`screen:${key}`),
      name: `[SEED] ${name}`,
      code,
      location_description: location,
      is_active: active,
      external_player_ref: null,
      created_at: at(0),
      updated_at: at(0),
    });
  }

  const reviewer = seedId("user:reviewer");
  const manager = seedId("user:manager");
  for (const s of SUBMISSIONS) {
    const sid = seedId(`submission:${s.n}`);
    const creator = seedId(`user:${s.creator}`);
    const vid = (n: number) => seedId(`version:${s.n}:${n}`);
    const lastDay = Math.max(
      s.createdDay,
      ...s.versions.map((v) => v.day),
      ...s.reviews.map((r) => r.day),
      ...s.schedules.map((x) => x.day),
    );
    f.submissions.push({
      id: sid,
      reference_code: ref(s.n),
      committee_id: seedId(`committee:${s.committee}`),
      created_by_user_id: creator,
      title: `[SEED] ${s.title}`,
      description: s.description,
      workflow_status: s.status,
      current_version_id: null, // set after versions are inserted
      submitted_at: s.submittedDay === undefined ? null : at(s.submittedDay),
      closed_at: null,
      created_at: at(s.createdDay),
      updated_at: at(lastDay),
    });
    f.currentVersions.push({ submissionId: sid, versionId: vid(s.currentVersion) });
    audit(`sub:${s.n}:created`, creator, "SUBMISSION_CREATED", "SUBMISSION", sid, sid, s.createdDay);
    if (s.submittedDay !== undefined)
      audit(`sub:${s.n}:submitted`, creator, "SUBMISSION_SUBMITTED", "SUBMISSION", sid, sid, s.submittedDay);

    for (const v of s.versions) {
      const key = `seed/${ref(s.n)}/v${v.n}/media.${v.type.startsWith("video") ? "mp4" : "bin"}`;
      f.mediaVersions.push({
        id: vid(v.n),
        submission_id: sid,
        version_number: v.n,
        object_key: key,
        original_filename: `synthetic-${ref(s.n).toLowerCase()}-v${v.n}`,
        content_type: v.type,
        size_bytes: v.size,
        checksum_sha256: sha(key),
        uploaded_by_user_id: creator,
        uploaded_at: at(v.day),
        change_note: v.note ?? null,
      });
      audit(`sub:${s.n}:v${v.n}`, creator, "MEDIA_VERSION_UPLOADED", "MEDIA_VERSION", vid(v.n), sid, v.day);
    }
    for (const r of s.requests) {
      f.screenRequests.push({
        id: seedId(`request:${s.n}:${r.screen}:${r.slot}`),
        submission_id: sid,
        screen_id: seedId(`screen:${r.screen}`),
        slot_number: r.slot,
        preferred_start_at: r.start === undefined ? null : at(r.start),
        preferred_end_at: r.end === undefined ? null : at(r.end),
        request_note: r.note ?? null,
        created_at: at(s.createdDay),
        updated_at: at(s.createdDay),
      });
    }
    for (const r of s.reviews) {
      const id = seedId(`review:${s.n}:${r.version}:${r.decision}`);
      f.reviewDecisions.push({
        id,
        submission_id: sid,
        media_version_id: vid(r.version),
        reviewer_user_id: reviewer,
        decision: r.decision,
        comment: r.comment ?? null,
        created_at: at(r.day),
      });
      audit(
        `sub:${s.n}:review:${r.version}`,
        reviewer,
        r.decision === "APPROVED"
          ? "REVIEW_APPROVED"
          : r.decision === "REJECTED"
            ? "REVIEW_REJECTED"
            : "CHANGES_REQUESTED",
        "REVIEW_DECISION",
        id,
        sid,
        r.day,
      );
    }
    for (const x of s.schedules) {
      const id = seedId(`schedule:${s.n}:${x.screen}`);
      f.scheduleEntries.push({
        id,
        submission_id: sid,
        media_version_id: vid(x.version),
        screen_id: seedId(`screen:${x.screen}`),
        status: x.status,
        actual_start_at: x.start === undefined ? null : at(x.start),
        actual_end_at: x.end === undefined ? null : at(x.end),
        external_schedule_ref: null,
        manager_note: x.note ?? null,
        created_by_user_id: manager,
        updated_by_user_id: manager,
        created_at: at(x.day),
        updated_at: at(x.day),
      });
      audit(`sub:${s.n}:schedule:${x.screen}`, manager, "SCHEDULE_CREATED", "SCHEDULE_ENTRY", id, sid, x.day);
    }
  }
  return f;
}
