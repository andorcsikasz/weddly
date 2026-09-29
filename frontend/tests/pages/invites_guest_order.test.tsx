// `/app/invites` — the guest rows hold their position.
//
// The reported bug: tapping "Online" on a guest sank their row to the bottom of
// the list. The rows were sorted actionable-first (nobody invited, then awaiting
// a reply, then answered), and marking somebody invited moves them from the
// first bucket to the second — so the list reshuffled under the finger that
// was working down it, and the next tap landed on a different person.
//
// The default order is therefore NOT a sort: it is the order the guest list
// arrives in, which the server keeps stable. Pinned here along with the two
// things that could quietly undo it — an order picker that does not actually
// reorder, and a remembered order that a bad stored value turns into a surprise
// re-sort. The other half of the change (glyphs instead of status words, the
// filter panel) is exercised here too, because an icon-only status that a test
// cannot find by name is an icon nobody can find by eye.

import type { Couple, Guest } from "@shared/types";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import GuestInvitesPage from "@/pages/GuestInvitesPage";
import { ConfirmDialogProvider } from "@/components/ui/ConfirmDialogProvider";
import { ToastProvider } from "@/components/ui/ToastProvider";
import { I18nProvider } from "@/lib/i18n";

const realFetch = globalThis.fetch;
const realLocalStorage = window.localStorage;
const SORT_KEY = "weddly.invites.sort";

function makeGuest(over: Partial<Guest> = {}): Guest {
  return {
    id: 1,
    couple_id: 1,
    household_id: null,
    full_name: "Jane Smith",
    email: "jane@example.com",
    phone: null,
    group_tag: "his_family",
    invite_code: "AB1234",
    kind: "adult",
    is_supplier: false,
    is_plus_one: false,
    plus_one_of: null,
    partner_role: null,
    certainty: "definite",
    rsvp_status: "pending",
    meal_choice: null,
    dietary: null,
    plus_one_name: null,
    plus_one_meal: null,
    accommodation_needed: false,
    song_request: null,
    notes: null,
    rsvp_responded_at: null,
    invited_at: null,
    invited_online_at: null,
    invited_physical_at: null,
    invitation_delivered_at: null,
    invitation_opened_at: null,
    accommodation_id: null,
    accommodation_room_id: null,
    transfer_id: null,
    created_at: 0,
    updated_at: 0,
    ...over,
  };
}

/** Server order — `created_at ASC`, which is what the page is expected to keep.
 *  Deliberately NOT alphabetical and NOT the pipeline order, so a page that
 *  re-sorts for either reason cannot accidentally agree with the fixture. */
let guests: Guest[];

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function installFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/guest-messages/envelope-tip")) {
      return json({ auto: null, override: null, effective: null, enabled: false });
    }
    if (url.includes("/api/guest-messages")) return json({ messages: [] });
    if (url.includes("/api/couples/current")) {
      return json({ couple: { id: 1, currency: "HUF" } as Partial<Couple> });
    }
    // PATCH /api/guests/:id — apply the channel stamp to the stored row, the
    // way the server does, and hand back the guest.
    if (init?.method === "PATCH" && url.includes("/api/guests/")) {
      const id = Number(url.split("/api/guests/")[1]);
      const body = JSON.parse(String(init.body ?? "{}")) as {
        invited_online?: boolean;
        invited_physical?: boolean;
      };
      guests = guests.map((g) =>
        g.id === id
          ? {
              ...g,
              invited_online_at: body.invited_online ? 1 : g.invited_online_at,
              invited_physical_at: body.invited_physical ? 1 : g.invited_physical_at,
            }
          : g,
      );
      const guest = guests.find((g) => g.id === id);
      return guest ? json({ guest }) : new Response("{}", { status: 404 });
    }
    if (url.includes("/api/guests")) return json({ guests });
    return json({});
  }) as typeof fetch;
}

async function flush(times = 5) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

/** The guest names in the order they are painted, which is the only order the
 *  couple actually experiences. */
/** `noUncheckedIndexedAccess` is on, and a `!` here would hide a real "the
 *  row under test is missing" — which in this suite is the actual failure. */
function rowAt(index: number): HTMLElement {
  const row = screen.getAllByTestId("gi-guest-row")[index];
  if (!row) throw new Error(`expected a guest row at index ${index}`);
  return row;
}

function renderedNames(): string[] {
  const list = screen.getByTestId("gi-guest-list");
  return within(list)
    .getAllByTestId("gi-guest-row")
    .map((row) => within(row).getByTestId("gi-guest-name").textContent ?? "");
}

function renderPage() {
  return render(
    <MemoryRouter>
      <I18nProvider>
        <ToastProvider>
          <ConfirmDialogProvider>
            <GuestInvitesPage />
          </ConfirmDialogProvider>
        </ToastProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  // Zoe is not invited at all; Ada has been invited both ways and said yes;
  // Mira has only ever been invited in person. Server order is deliberately
  // unrelated to all three of those, and to the alphabet.
  guests = [
    makeGuest({ id: 1, full_name: "Zoe Adams" }),
    makeGuest({
      id: 2,
      full_name: "Ada Bell",
      rsvp_status: "yes",
      invited_online_at: 10,
      invited_physical_at: 11,
    }),
    makeGuest({ id: 3, full_name: "Mira Cole", invited_physical_at: 20 }),
  ];
  installFetch();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  Object.defineProperty(window, "localStorage", { value: realLocalStorage, configurable: true });
});

describe("/app/invites — row order", () => {
  it("keeps a guest exactly where they were when a channel is toggled", async () => {
    renderPage();
    await flush();
    expect(renderedNames()).toEqual(["Zoe Adams", "Ada Bell", "Mira Cole"]);

    // Zoe is the first row and the only guest not invited at all, so marking
    // her "online" moves her out of the `not_invited` bucket and into
    // `awaiting` — exactly the transition that used to sink her row.
    const zoeRow = rowAt(0);
    const onlineChip = within(zoeRow).getByRole("button", { name: /Zoe Adams: Online/ });
    await act(async () => {
      fireEvent.click(onlineChip);
    });
    await flush();

    expect(guests[0]?.invited_online_at).not.toBeNull();
    expect(renderedNames()).toEqual(["Zoe Adams", "Ada Bell", "Mira Cole"]);
  });

  it("moves the same guest to the bottom once 'needs attention' is the chosen order", async () => {
    renderPage();
    await flush();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Order/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: /Needs attention first/ }));
    });
    // Under this order Ada (answered) is last and Zoe + Mira (unanswered)
    // lead, so the rows genuinely differ from the server order.
    expect(renderedNames()).toEqual(["Zoe Adams", "Mira Cole", "Ada Bell"]);

    const zoeRow = rowAt(0);
    await act(async () => {
      fireEvent.click(within(zoeRow).getByRole("button", { name: /Zoe Adams: Online/ }));
    });
    await flush();

    // This order buckets by pipeline, and inviting Zoe moves her from the
    // `not_invited` bucket into `awaiting` — so she falls from the head of the
    // list to behind the only other guest still awaiting, and the row the
    // couple was working through is no longer where they left it. The same
    // action is a no-op for the list in the test above, which is the point.
    expect(renderedNames()).toEqual(["Mira Cole", "Zoe Adams", "Ada Bell"]);
  });

  it("remembers the chosen order, and never re-sorts on an unreadable stored value", async () => {
    const first = renderPage();
    await flush();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Order/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: /By name/ }));
    });
    expect(window.localStorage.getItem(SORT_KEY)).toBe("name");
    expect(renderedNames()).toEqual(["Ada Bell", "Mira Cole", "Zoe Adams"]);
    first.unmount();

    // A stale build, a hand-edited key, or a value from a future option must
    // all fall back to the order that holds still — never to a surprise sort.
    window.localStorage.setItem(SORT_KEY, "whatever-this-used-to-be");
    const second = renderPage();
    await flush();
    expect(renderedNames()).toEqual(["Zoe Adams", "Ada Bell", "Mira Cole"]);
    second.unmount();
  });
});

describe("/app/invites — filtering", () => {
  it("narrows the list to one reply state and clears again", async () => {
    renderPage();
    await flush();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: /^Coming/ }));
    });
    expect(renderedNames()).toEqual(["Ada Bell"]);

    // The chip drops into the active-filter row as a removable pill, so what
    // is currently applied is readable without opening the panel again.
    const summary = screen.getByTestId("gi-active-filters");
    expect(within(summary).getByRole("button", { name: /Coming/ })).toBeDefined();

    await act(async () => {
      fireEvent.click(within(summary).getByRole("button", { name: /Clear filters/ }));
    });
    expect(renderedNames()).toEqual(["Zoe Adams", "Ada Bell", "Mira Cole"]);
  });

  it("filters by how many channels a guest has been reached through", async () => {
    renderPage();
    await flush();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    });
    // "One channel" is the actionable case — invited on paper but never
    // emailed, or the reverse — and it can only be a chip if it is its own
    // state rather than a subtraction of the other two.
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: /^One channel/ }));
    });
    expect(renderedNames()).toEqual(["Mira Cole"]);

    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: /^Not invited/ }));
    });
    expect(renderedNames()).toEqual(["Zoe Adams", "Mira Cole"]);
  });

  it("finds the guests a broadcast cannot reach", async () => {
    guests = [
      makeGuest({ id: 1, full_name: "Zoe Adams" }),
      makeGuest({ id: 2, full_name: "No Address", email: null }),
    ];
    renderPage();
    await flush();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: /^No email/ }));
    });
    expect(renderedNames()).toEqual(["No Address"]);
  });
});

describe("/app/invites — the reply is a glyph", () => {
  it("keeps the word as the accessible name, so nothing is carried by shape alone", async () => {
    guests = [
      makeGuest({ id: 1, full_name: "Zoe Adams" }),
      makeGuest({ id: 2, full_name: "Ada Bell", rsvp_status: "yes" }),
      makeGuest({ id: 3, full_name: "Cyd Dee", rsvp_status: "no" }),
      makeGuest({ id: 4, full_name: "Eli Fay", rsvp_status: "maybe" }),
    ];
    renderPage();
    await flush();

    // The badge no longer PRINTS the word — that was the whole point, it was
    // the widest thing on the row — but the word is still what the element is
    // named, which is what a screen reader speaks and what a tooltip shows.
    const badge = screen.getByRole("img", { name: "Pending" });
    expect(badge.closest("span")?.getAttribute("title")).toBe("Pending");
    for (const name of ["Coming", "Declined", "Maybe"]) {
      expect(screen.getAllByRole("img", { name }).length).toBe(1);
    }

    // And the key under the list teaches the four shapes on first use, so an
    // un-introduced glyph is never the only way to read the list.
    const legend = screen.getByTestId("gi-rsvp-legend");
    for (const name of ["Pending", "Coming", "Declined", "Maybe"]) {
      expect(within(legend).getByText(name)).toBeDefined();
    }
  });
});
