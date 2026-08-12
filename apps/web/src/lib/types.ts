import type { queries } from "@ragbag/contracts";
import type { QueryResultType } from "@rocicorp/zero";

// Row shapes as the UI receives them from Zero (query result types, including
// the related content/tags), derived from the shared query definitions so a
// contracts change breaks the build here instead of at runtime.

export type Timeline = QueryResultType<typeof queries.timeline>;
export type TimelineItem = Timeline[number];
export type ItemDetail = QueryResultType<typeof queries.item>;
export type TagRow = QueryResultType<typeof queries.tags>[number];
