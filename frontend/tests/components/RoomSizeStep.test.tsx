// The seating empty state asks for the room before the first table exists.
// Locks the metres → millimetres parse (comma decimals, clamping to the
// editor's bounds, empty = keep the current room) and that the step renders
// both fields prefilled from the current room.

import { describe, expect, it, mock } from "bun:test";
import { MAX_ROOM_MM, MIN_ROOM_MM } from "@shared/seating";
import { fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import { RoomSizeStep, parseRoomSize, roomDraftFromMm } from "@/pages/seating/RoomSizeStep";

describe("parseRoomSize", () => {
  it("converts metres to whole millimetres, accepting a comma decimal", () => {
    expect(parseRoomSize({ w: "18,5", h: "10" })).toEqual({ w: 18_500, h: 10_000 });
  });
  it("clamps to the editor's room bounds", () => {
    expect(parseRoomSize({ w: "1", h: "500" })).toEqual({ w: MIN_ROOM_MM, h: MAX_ROOM_MM });
  });
  it("returns null for an empty or non-numeric field", () => {
    expect(parseRoomSize({ w: "", h: "9" })).toBeNull();
    expect(parseRoomSize({ w: "12", h: "abc" })).toBeNull();
  });
  it("round-trips the draft built from millimetres", () => {
    expect(parseRoomSize(roomDraftFromMm(12_000, 9_000))).toEqual({ w: 12_000, h: 9_000 });
  });
});

describe("RoomSizeStep", () => {
  it("renders both dimensions and reports edits", () => {
    const onChange = mock(() => {});
    render(
      <I18nProvider>
        <RoomSizeStep draft={roomDraftFromMm(12_000, 9_000)} onChange={onChange} />
      </I18nProvider>,
    );
    expect(screen.getByText("How big is the room?")).toBeTruthy();
    const width = screen.getByLabelText("Room width in metres") as HTMLInputElement;
    const length = screen.getByLabelText("Room height in metres") as HTMLInputElement;
    expect(width.value).toBe("12");
    expect(length.value).toBe("9");
    fireEvent.change(width, { target: { value: "20" } });
    expect(onChange).toHaveBeenCalledWith({ w: "20", h: "9" });
  });
});
