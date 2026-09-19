// server/models/customDomainSchema.js
// The custom-domain sub-schema, shared by CustomWebsite and Portfolio so a
// "connect your own domain" site can be either a Custom Builder site or a
// regular template portfolio. lib/domainService.js and domainController.js
// only ever touch `site.customDomain` + `site.save()`, so they work on
// either model unchanged.

import mongoose from "mongoose";

// DNS record snapshot: what the user must create + the result of the last check.
export const DomainRecordSchema = new mongoose.Schema({
  type:     { type: String },            // TXT | A | CNAME
  host:     { type: String },            // relative to the zone: "@", "www", "_foliofyx.shop"
  name:     { type: String },            // fully qualified name
  value:    { type: String },
  purpose:  { type: String },
  required: { type: Boolean, default: true },
  ok:       { type: Boolean, default: null },
  found:    { type: [String], default: undefined },
  problem:  { type: String },
}, { _id: false });

// Old statuses (pending | verified) still load; new flow uses the rest.
export const DOMAIN_STATUSES = ["pending", "verified", "pending_dns", "verifying", "live", "dns_missing", "failed"];

export const CustomDomainSchema = {
  name:              { type: String, lowercase: true, trim: true }, // e.g. "mystudio.com"
  status:            { type: String, enum: DOMAIN_STATUSES, default: undefined },
  verificationToken: { type: String },
  connectedAt:       { type: Date },
  verifiedAt:        { type: Date },   // DNS first seen correct
  liveAt:            { type: Date },
  lastCheckedAt:     { type: Date },
  nextCheckAt:       { type: Date },
  dnsMissingSince:   { type: Date },
  checkCount:        { type: Number, default: undefined },
  lastError:         { type: String },
  warnings:          { type: [String], default: undefined },
  records:           { type: [DomainRecordSchema], default: undefined },
  renderStatus:      { type: String }, // Render verificationStatus
  renderDomainId:    { type: String },
};
