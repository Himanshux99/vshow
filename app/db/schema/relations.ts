import { relations } from "drizzle-orm";
import { appRole, appUser, userRole } from "./identity.ts";
import { committee, committeeMembership, screen } from "./campus.ts";
import { mediaVersion, screenRequest, submission, submissionRevision, uploadReservation } from "./submissions.ts";
import { auditEvent, reviewDecision, scheduleEntry } from "./workflow.ts";

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
  currentRevision: one(submissionRevision, {
    fields: [submission.currentRevisionId],
    references: [submissionRevision.id],
    relationName: "currentRevision",
  }),
  resubmissionOf: one(submission, {
    fields: [submission.resubmissionOfId],
    references: [submission.id],
    relationName: "resubmissions",
  }),
  resubmissions: many(submission, { relationName: "resubmissions" }),
  revisions: many(submissionRevision, { relationName: "revisions" }),
  uploadReservations: many(uploadReservation),
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
  revision: one(submissionRevision, { fields: [reviewDecision.revisionId], references: [submissionRevision.id] }),
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

export const submissionRevisionRelations = relations(submissionRevision, ({ one, many }) => ({
  submission: one(submission, {
    fields: [submissionRevision.submissionId],
    references: [submission.id],
    relationName: "revisions",
  }),
  mediaVersion: one(mediaVersion, { fields: [submissionRevision.mediaVersionId], references: [mediaVersion.id] }),
  createdBy: one(appUser, { fields: [submissionRevision.createdByUserId], references: [appUser.id] }),
  reviewDecisions: many(reviewDecision),
}));

export const uploadReservationRelations = relations(uploadReservation, ({ one }) => ({
  submission: one(submission, { fields: [uploadReservation.submissionId], references: [submission.id] }),
  reservedBy: one(appUser, { fields: [uploadReservation.reservedByUserId], references: [appUser.id] }),
}));
