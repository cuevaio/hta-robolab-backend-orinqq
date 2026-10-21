/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agent from "../agent.js";
import type * as analytics from "../analytics.js";
import type * as assignments from "../assignments.js";
import type * as auth from "../auth.js";
import type * as classrooms from "../classrooms.js";
import type * as demo from "../demo.js";
import type * as evaluations from "../evaluations.js";
import type * as explore from "../explore.js";
import type * as http from "../http.js";
import type * as impact from "../impact.js";
import type * as lab from "../lab.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_agentPlay from "../lib/agentPlay.js";
import type * as lib_attempts from "../lib/attempts.js";
import type * as lib_classwork from "../lib/classwork.js";
import type * as lib_codes from "../lib/codes.js";
import type * as lib_demoData from "../lib/demoData.js";
import type * as lib_env from "../lib/env.js";
import type * as lib_impact from "../lib/impact.js";
import type * as lib_items from "../lib/items.js";
import type * as lib_liveCleanup from "../lib/liveCleanup.js";
import type * as lib_liveValidators from "../lib/liveValidators.js";
import type * as lib_mailPolicy from "../lib/mailPolicy.js";
import type * as lib_mailer from "../lib/mailer.js";
import type * as lib_plays from "../lib/plays.js";
import type * as lib_rules from "../lib/rules.js";
import type * as lib_teacherMemory from "../lib/teacherMemory.js";
import type * as liveRoomCleanup from "../liveRoomCleanup.js";
import type * as liveRooms from "../liveRooms.js";
import type * as mail from "../mail.js";
import type * as passwordReset from "../passwordReset.js";
import type * as robot from "../robot.js";
import type * as student from "../student.js";
import type * as teacherHome from "../teacherHome.js";
import type * as teacherMemory from "../teacherMemory.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agent: typeof agent;
  analytics: typeof analytics;
  assignments: typeof assignments;
  auth: typeof auth;
  classrooms: typeof classrooms;
  demo: typeof demo;
  evaluations: typeof evaluations;
  explore: typeof explore;
  http: typeof http;
  impact: typeof impact;
  lab: typeof lab;
  "lib/access": typeof lib_access;
  "lib/agentPlay": typeof lib_agentPlay;
  "lib/attempts": typeof lib_attempts;
  "lib/classwork": typeof lib_classwork;
  "lib/codes": typeof lib_codes;
  "lib/demoData": typeof lib_demoData;
  "lib/env": typeof lib_env;
  "lib/impact": typeof lib_impact;
  "lib/items": typeof lib_items;
  "lib/liveCleanup": typeof lib_liveCleanup;
  "lib/liveValidators": typeof lib_liveValidators;
  "lib/mailPolicy": typeof lib_mailPolicy;
  "lib/mailer": typeof lib_mailer;
  "lib/plays": typeof lib_plays;
  "lib/rules": typeof lib_rules;
  "lib/teacherMemory": typeof lib_teacherMemory;
  liveRoomCleanup: typeof liveRoomCleanup;
  liveRooms: typeof liveRooms;
  mail: typeof mail;
  passwordReset: typeof passwordReset;
  robot: typeof robot;
  student: typeof student;
  teacherHome: typeof teacherHome;
  teacherMemory: typeof teacherMemory;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
