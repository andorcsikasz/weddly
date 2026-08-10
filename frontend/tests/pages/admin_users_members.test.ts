import type { AdminCoupleView } from "@shared/types";
import { describe, expect, test } from "bun:test";
import { resolveAdminWorkspaceMembers } from "@/pages/AdminUsersPage";

describe("AdminUsersPage workspace member resolution", () => {
  test("keeps partner email when /api/admin/users intentionally omits the account", () => {
    const couple = {
      partners: [
        {
          id: 147,
          full_name: "Kylee & Marci",
          email: "owner@example.test",
        },
      ],
    } as AdminCoupleView;

    const resolved = resolveAdminWorkspaceMembers(couple, new Map());

    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.partner.email).toBe("owner@example.test");
    expect(resolved[0]?.user).toBeNull();
  });

  test("does not resurrect purged identities", () => {
    const couple = {
      partners: [
        {
          id: 148,
          full_name: "Purged user",
          email: "deleted-148@purged.local",
        },
      ],
    } as AdminCoupleView;

    expect(resolveAdminWorkspaceMembers(couple, new Map())).toEqual([]);
  });
});
