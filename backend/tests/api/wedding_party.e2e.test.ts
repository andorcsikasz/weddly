// Wedding party: helpers and special roles (best man, bridesmaids, konferanszié,
// photographer). Couple-scoped CRUD. Covers the validation contract, the
// status_at stamp, the partial-PATCH merge, and cross-couple isolation.

import "../setup";

import { describe, expect, test } from "bun:test";
import { bootstrapCouple, req } from "../helpers";

interface Member {
  id: number;
  couple_id: number;
  guest_id: number | null;
  name: string;
  role: string;
  role_label: string | null;
  ceremony: string | null;
  status: string;
  status_at: number | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
}

async function create(token: string, body: Record<string, unknown>) {
  return req<{ member: Member }>("POST", "/api/wedding-party", body, { token });
}

describe("wedding party: create and validation", () => {
  test("a best man recorded for both ceremonies starts as not asked, with no status stamp", async () => {
    const { token } = await bootstrapCouple("wp-create@weddly.test");
    const r = await create(token, {
      name: "Péter",
      role: "best_man",
      ceremony: "both",
    });
    expect(r.status).toBe(201);
    expect(r.data.member.role).toBe("best_man");
    expect(r.data.member.ceremony).toBe("both");
    expect(r.data.member.status).toBe("not_asked");
    expect(r.data.member.status_at).toBeNull();
    expect(r.data.member.role_label).toBeNull();
  });

  test("a row born already 'said yes' records when that became true", async () => {
    const { token } = await bootstrapCouple("wp-born-yes@weddly.test");
    const r = await create(token, {
      name: "Fred bácsi",
      role: "photographer",
      status: "said_yes",
    });
    expect(r.status).toBe(201);
    expect(r.data.member.status).toBe("said_yes");
    expect(typeof r.data.member.status_at).toBe("number");
  });

  test("'other' needs a role label and keeps it; other roles drop a stray one", async () => {
    const { token } = await bootstrapCouple("wp-label@weddly.test");
    const missing = await create(token, { name: "Anna", role: "other" });
    expect(missing.status).toBe(400);

    const ok = await create(token, {
      name: "Anna",
      role: "other",
      role_label: "  olvasó a templomban  ",
    });
    expect(ok.status).toBe(201);
    expect(ok.data.member.role_label).toBe("olvasó a templomban");

    const stray = await create(token, {
      name: "Bence",
      role: "usher",
      role_label: "ignored",
    });
    expect(stray.status).toBe(201);
    expect(stray.data.member.role_label).toBeNull();
  });

  test("unknown role, status, ceremony, blank name and a bad email are all refused", async () => {
    const { token } = await bootstrapCouple("wp-invalid@weddly.test");
    expect((await create(token, { name: "A", role: "wizard" })).status).toBe(400);
    expect((await create(token, { name: "A", role: "usher", status: "maybe-ish" })).status).toBe(
      400,
    );
    expect((await create(token, { name: "A", role: "usher", ceremony: "beach" })).status).toBe(400);
    expect((await create(token, { name: "   ", role: "usher" })).status).toBe(400);
    expect((await create(token, { name: "A", role: "usher", email: "not-an-email" })).status).toBe(
      400,
    );
  });

  test("every ceremony option round-trips, and an empty value means not decided", async () => {
    const { token } = await bootstrapCouple("wp-ceremony@weddly.test");
    for (const c of ["civil", "church", "both"]) {
      const r = await create(token, { name: c, role: "best_man", ceremony: c });
      expect(r.data.member.ceremony).toBe(c);
    }
    const none = await create(token, { name: "None", role: "best_man", ceremony: "" });
    expect(none.status).toBe(201);
    expect(none.data.member.ceremony).toBeNull();
  });
});

describe("wedding party: status and partial updates", () => {
  test("changing status stamps status_at; an unchanged status keeps the old stamp", async () => {
    const { token } = await bootstrapCouple("wp-status@weddly.test");
    const made = await create(token, { name: "Dóra", role: "bridesmaid" });
    const id = made.data.member.id;

    const asked = await req<{ member: Member }>(
      "PATCH",
      `/api/wedding-party/${id}`,
      { status: "asked" },
      { token },
    );
    expect(asked.data.member.status).toBe("asked");
    const firstStamp = asked.data.member.status_at;
    expect(typeof firstStamp).toBe("number");

    // Editing a note without touching the status must not move the date.
    const noted = await req<{ member: Member }>(
      "PATCH",
      `/api/wedding-party/${id}`,
      { notes: "ruha Budapestről" },
      { token },
    );
    expect(noted.data.member.status_at).toBe(firstStamp);
    expect(noted.data.member.notes).toBe("ruha Budapestről");
  });

  test("a PATCH that names only one field leaves the rest alone", async () => {
    const { token } = await bootstrapCouple("wp-partial@weddly.test");
    const made = await create(token, {
      name: "Gergő",
      role: "groomsman",
      ceremony: "church",
      phone: "+36 30 000 0000",
      status: "maybe",
    });
    const id = made.data.member.id;
    const renamed = await req<{ member: Member }>(
      "PATCH",
      `/api/wedding-party/${id}`,
      { name: "Gergely" },
      { token },
    );
    expect(renamed.status).toBe(200);
    expect(renamed.data.member.name).toBe("Gergely");
    expect(renamed.data.member.ceremony).toBe("church");
    expect(renamed.data.member.phone).toBe("+36 30 000 0000");
    expect(renamed.data.member.status).toBe("maybe");
  });

  test("null clears an optional field; moving off 'other' without a label is refused", async () => {
    const { token } = await bootstrapCouple("wp-clear@weddly.test");
    const made = await create(token, {
      name: "Lili",
      role: "other",
      role_label: "tolmács",
      ceremony: "both",
    });
    const id = made.data.member.id;

    const cleared = await req<{ member: Member }>(
      "PATCH",
      `/api/wedding-party/${id}`,
      { ceremony: null },
      { token },
    );
    expect(cleared.data.member.ceremony).toBeNull();

    const blankLabel = await req<{ error: string }>(
      "PATCH",
      `/api/wedding-party/${id}`,
      { role_label: null },
      { token },
    );
    expect(blankLabel.status).toBe(400);
  });
});

describe("wedding party: list, delete and isolation", () => {
  test("the list keeps insertion order and carries every row", async () => {
    const { token } = await bootstrapCouple("wp-list@weddly.test");
    await create(token, { name: "First", role: "best_man" });
    await create(token, { name: "Second", role: "mc" });
    const list = await req<{ members: Member[] }>("GET", "/api/wedding-party", undefined, {
      token,
    });
    expect(list.data.members.map((m) => m.name)).toEqual(["First", "Second"]);
  });

  test("delete removes the row; a second delete is a 404", async () => {
    const { token } = await bootstrapCouple("wp-delete@weddly.test");
    const made = await create(token, { name: "Tamás", role: "usher" });
    const id = made.data.member.id;
    const first = await req("DELETE", `/api/wedding-party/${id}`, undefined, { token });
    expect(first.status).toBe(200);
    const again = await req("DELETE", `/api/wedding-party/${id}`, undefined, { token });
    expect(again.status).toBe(404);
  });

  test("another couple cannot read, edit or delete a member", async () => {
    const owner = await bootstrapCouple("wp-owner@weddly.test");
    const other = await bootstrapCouple("wp-intruder@weddly.test");
    const made = await create(owner.token, { name: "Secret", role: "best_man" });
    const id = made.data.member.id;

    const patched = await req(
      "PATCH",
      `/api/wedding-party/${id}`,
      { status: "said_yes" },
      { token: other.token },
    );
    expect(patched.status).toBe(404);

    const deleted = await req("DELETE", `/api/wedding-party/${id}`, undefined, {
      token: other.token,
    });
    expect(deleted.status).toBe(404);

    const theirList = await req<{ members: Member[] }>("GET", "/api/wedding-party", undefined, {
      token: other.token,
    });
    expect(theirList.data.members.length).toBe(0);
  });

  test("the endpoints require a signed-in couple", async () => {
    const r = await req("GET", "/api/wedding-party");
    expect(r.status).toBe(401);
  });
});

async function makeGuest(
  token: string,
  body: { full_name: string; email?: string; phone?: string },
): Promise<number> {
  const r = await req<{ guest: { id: number } }>("POST", "/api/guests", body, { token });
  expect(r.status).toBe(201);
  return r.data.guest.id;
}

describe("wedding party: linked to a guest (one-way sync)", () => {
  test("picking a guest copies name, email and phone, and ignores the body's copies", async () => {
    const { token } = await bootstrapCouple("wp-link-create@weddly.test");
    const guestId = await makeGuest(token, {
      full_name: "Bianka Zawiasa",
      email: "bianka@example.com",
      phone: "+36301234567",
    });
    const r = await create(token, {
      guest_id: guestId,
      name: "something typed",
      role: "bridesmaid",
      email: "other@example.com",
    });
    expect(r.status).toBe(201);
    expect(r.data.member.guest_id).toBe(guestId);
    expect(r.data.member.name).toBe("Bianka Zawiasa");
    expect(r.data.member.email).toBe("bianka@example.com");
    expect(r.data.member.phone).toBe("+36301234567");
  });

  test("a guest correction shows on the member with no write to the party row", async () => {
    const { token } = await bootstrapCouple("wp-link-live@weddly.test");
    const guestId = await makeGuest(token, { full_name: "Anna Kiss", email: "old@example.com" });
    const made = await create(token, { guest_id: guestId, role: "usher" });
    const id = made.data.member.id;

    const fix = await req(
      "PATCH",
      `/api/guests/${guestId}`,
      {
        full_name: "Anna Kiss-Nagy",
        email: "new@example.com",
      },
      { token },
    );
    expect(fix.status).toBe(200);

    const list = await req<{ members: Member[] }>("GET", "/api/wedding-party", undefined, {
      token,
    });
    const member = list.data.members.find((m) => m.id === id);
    expect(member?.name).toBe("Anna Kiss-Nagy");
    expect(member?.email).toBe("new@example.com");
  });

  test("while linked, a PATCH cannot fork name or email away from the guest", async () => {
    const { token } = await bootstrapCouple("wp-link-patch@weddly.test");
    const guestId = await makeGuest(token, { full_name: "Lili Tóth", email: "lili@example.com" });
    const made = await create(token, { guest_id: guestId, role: "reader" });
    const id = made.data.member.id;

    const r = await req<{ member: Member }>(
      "PATCH",
      `/api/wedding-party/${id}`,
      { name: "Wrong", email: "wrong@example.com", status: "said_yes" },
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.member.name).toBe("Lili Tóth");
    expect(r.data.member.email).toBe("lili@example.com");
    expect(r.data.member.status).toBe("said_yes");
  });

  test("null unlinks: the member keeps the last copied values and becomes editable again", async () => {
    const { token } = await bootstrapCouple("wp-link-unlink@weddly.test");
    const guestId = await makeGuest(token, { full_name: "Dani Varga", email: "dani@example.com" });
    const made = await create(token, { guest_id: guestId, role: "groomsman" });
    const id = made.data.member.id;

    const unlinked = await req<{ member: Member }>(
      "PATCH",
      `/api/wedding-party/${id}`,
      { guest_id: null },
      { token },
    );
    expect(unlinked.status).toBe(200);
    expect(unlinked.data.member.guest_id).toBeNull();
    expect(unlinked.data.member.name).toBe("Dani Varga");

    const edited = await req<{ member: Member }>(
      "PATCH",
      `/api/wedding-party/${id}`,
      { name: "Dani V." },
      { token },
    );
    expect(edited.data.member.name).toBe("Dani V.");
  });

  test("deleting the guest unlinks the member and keeps its last values", async () => {
    const { token } = await bootstrapCouple("wp-link-delete@weddly.test");
    const guestId = await makeGuest(token, { full_name: "Gergő Szabó", phone: "+36209999999" });
    const made = await create(token, { guest_id: guestId, role: "musician" });
    const id = made.data.member.id;

    const del = await req("DELETE", `/api/guests/${guestId}`, undefined, { token });
    expect(del.status).toBe(200);

    const list = await req<{ members: Member[] }>("GET", "/api/wedding-party", undefined, {
      token,
    });
    const member = list.data.members.find((m) => m.id === id);
    expect(member?.guest_id).toBeNull();
    expect(member?.name).toBe("Gergő Szabó");
    expect(member?.phone).toBe("+36209999999");
  });

  test("another couple's guest id is refused, never copied", async () => {
    const mine = await bootstrapCouple("wp-link-mine@weddly.test");
    const theirs = await bootstrapCouple("wp-link-theirs@weddly.test");
    const foreignGuest = await makeGuest(theirs.token, {
      full_name: "Titkos Vendég",
      email: "secret@example.com",
    });
    const r = await create(mine.token, { guest_id: foreignGuest, role: "reader" });
    expect(r.status).toBe(400);
  });
});

describe("wedding party: the status cycle", () => {
  test("every status in the ask lifecycle can be set and read back", async () => {
    const { token } = await bootstrapCouple("wp-cycle@weddly.test");
    const made = await create(token, { name: "Zsófi", role: "flower_girl" });
    const id = made.data.member.id;
    for (const status of ["asked", "maybe", "declined", "said_yes", "not_asked"]) {
      const r = await req<{ member: Member }>(
        "PATCH",
        `/api/wedding-party/${id}`,
        { status },
        { token },
      );
      expect(r.status).toBe(200);
      expect(r.data.member.status).toBe(status);
    }
  });
});
