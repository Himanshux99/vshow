import { relations } from "drizzle-orm";
import { appRole, appUser, userRole } from "./identity";
import { committee, committeeMembership, screen } from "./campus";
import { mediaVersion, screenRequest, submission } from "./submissions";
import { auditEvent, reviewDecision, scheduleEntry } from "./workflow";

// Navigation helpers only. Integrity is enforced by SQL constraints in the migrations.

export const appUserRelations = relations(appUser, ({ many }) => ({
  roles: many(userRole, { relationName: "userRoles" }),
  memberships: many(committeeMembership),
  submissions: many(submission),
}));

export const appRoleRelations = relations(appRole, ({ many }) => ({ users: many(userRole) }));

export const userRoleRelations = relations(userRole, ({ one }) => ({
  user: one(appUser, { fields: [userRole.userId], references: [appUser.id], relationName: "userRoles" }),
  role: one(appRole, { fields: [userRole.roleId], references: [appRole.id] }),
}));

export const committeeRelations = relations(committee, ({ many }) => ({
  memberships: many(committeeMembership),
  submissions: many(submission),
}));

export const committeeMembershipRelations = relations(committeeMembership, ({ one }) => ({
  committee: one(committee, { fields: [committeeMembership.committeeId], references: [committee.id] }),
  user: one(appUser, { fields: [committeeMembership.userId], references: [appUser.id] }),
}));

export const screenRelations = relations(screen, ({ many }) => ({
  requests: many(screenRequest),
  scheduleEntries: many(scheduleEntry),
}));

export const submissionRelations = relations(submission, ({ one, many }) => ({
  committee: one(committee, { fields: [submission.committeeId], references: [committee.id] }),
  createdBy: one(appUser, { fields: [submission.createdByUserId], references: [appUser.id] }),
  currentVersion: one(mediaVersion, {
    fields: [submission.currentVersionId],
    references: [mediaVersion.id],
    relationName: "currentVersion",
  }),
  versions: many(mediaVersion, { relationName: "versions" }),
  screenRequests: many(screenRequest),
  reviewDecisions: many(reviewDecision),
  scheduleEntries: many(scheduleEntry),
  auditEvents: many(auditEvent),
}));

export const mediaVersionRelations = relations(mediaVersion, ({ one }) => ({
  submission: one(submission, {
    fields: [mediaVersion.submissionId],
    references: [submission.id],
    relationName: "versions",
  }),
  uploadedBy: one(appUser, { fields: [mediaVersion.uploadedByUserId], references: [appUser.id] }),
}));

export const screenRequestRelations = relations(screenRequest, ({ one }) => ({
  submission: one(submission, { fields: [screenRequest.submissionId], references: [submission.id] }),
  screen: one(screen, { fields: [screenRequest.screenId], references: [screen.id] }),
}));

export const reviewDecisionRelations = relations(reviewDecision, ({ one }) => ({
  submission: one(submission, { fields: [reviewDecision.submissionId], references: [submission.id] }),
  mediaVersion: one(mediaVersion, { fields: [reviewDecision.mediaVersionId], references: [mediaVersion.id] }),
  reviewer: one(appUser, { fields: [reviewDecision.reviewerUserId], references: [appUser.id] }),
}));

export const scheduleEntryRelations = relations(scheduleEntry, ({ one }) => ({
  submission: one(submission, { fields: [scheduleEntry.submissionId], references: [submission.id] }),
  mediaVersion: one(mediaVersion, { fields: [scheduleEntry.mediaVersionId], references: [mediaVersion.id] }),
  screen: one(screen, { fields: [scheduleEntry.screenId], references: [screen.id] }),
}));

export const auditEventRelations = relations(auditEvent, ({ one }) => ({
  actor: one(appUser, { fields: [auditEvent.actorUserId], references: [appUser.id] }),
  submission: one(submission, { fields: [auditEvent.submissionId], references: [submission.id] }),
}));
