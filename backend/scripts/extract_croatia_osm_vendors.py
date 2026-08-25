#!/usr/bin/env python3
"""Extract contact-complete Croatian wedding-adjacent businesses from OSM.

This is a research input, not a direct directory import.  The follow-up web
research step verifies the business website and obtains a representative
image before a row is accepted into the curated directory.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import osmium


CATEGORY_RULES: tuple[tuple[str, frozenset[str], str], ...] = (
    (
        "tourism",
        frozenset(
            {
                "hotel",
                "guest_house",
                "hostel",
                "apartment",
                "resort",
                "motel",
                "chalet",
                "camp_site",
            }
        ),
        "accommodation",
    ),
    (
        "amenity",
        frozenset({"events_venue", "conference_centre"}),
        "venue",
    ),
    ("shop", frozenset({"florist"}), "florist"),
    ("shop", frozenset({"hairdresser", "beauty"}), "hair_makeup"),
    ("shop", frozenset({"jewelry"}), "wedding_jewelry"),
    ("craft", frozenset({"photographer"}), "photography"),
    ("craft", frozenset({"caterer"}), "catering"),
)


def first(tags: osmium.osm.TagList, *keys: str) -> str | None:
    for key in keys:
        value = tags.get(key)
        if value and value.strip():
            return value.strip()
    return None


def category_for(tags: osmium.osm.TagList) -> str | None:
    for key, accepted, category in CATEGORY_RULES:
        if tags.get(key) in accepted:
            return category
    return None


def address_for(tags: osmium.osm.TagList) -> str | None:
    full = first(tags, "addr:full")
    if full:
        return full
    street = first(tags, "addr:street", "addr:place")
    number = first(tags, "addr:housenumber")
    city = first(tags, "addr:city", "addr:town", "addr:village")
    postcode = first(tags, "addr:postcode")
    if not street or not city:
        return None
    first_line = f"{street} {number}" if number else street
    city_line = " ".join(part for part in (postcode, city) if part)
    return f"{first_line}, {city_line}, Croatia"


class PlaceHandler(osmium.SimpleHandler):
    def __init__(self) -> None:
        super().__init__()
        self.places: list[tuple[float, float, str]] = []

    def node(self, obj: osmium.osm.Node) -> None:
        if obj.tags.get("place") not in {"city", "town", "village", "hamlet"}:
            return
        name = first(obj.tags, "name")
        if name and obj.location.valid():
            self.places.append((obj.location.lat, obj.location.lon, name))


class VendorHandler(osmium.SimpleHandler):
    def __init__(
        self,
        allow_incomplete: bool = False,
        places: list[tuple[float, float, str]] | None = None,
    ) -> None:
        super().__init__()
        self.allow_incomplete = allow_incomplete
        self.places = places or []
        self.rows: list[dict[str, object]] = []
        self.seen: set[tuple[str, str]] = set()

    def _coordinates(self, obj: object, osm_type: str) -> tuple[float, float] | None:
        if osm_type == "node" and obj.location.valid():
            return (obj.location.lat, obj.location.lon)
        if osm_type == "way":
            points = [
                (node.location.lat, node.location.lon)
                for node in obj.nodes
                if node.location.valid()
            ]
            if points:
                return (
                    sum(point[0] for point in points) / len(points),
                    sum(point[1] for point in points) / len(points),
                )
        return None

    def _nearest_city(self, coordinates: tuple[float, float] | None) -> str | None:
        if not coordinates:
            return None
        lat, lon = coordinates
        closest: tuple[float, str] | None = None
        lon_scale = math.cos(math.radians(lat))
        for place_lat, place_lon, name in self.places:
            distance_sq = (place_lat - lat) ** 2 + ((place_lon - lon) * lon_scale) ** 2
            if closest is None or distance_sq < closest[0]:
                closest = (distance_sq, name)
        # Roughly 35 km.  Beyond this, a guessed locality is not useful.
        return closest[1] if closest and closest[0] <= 0.1 else None

    def _visit(self, obj: object, osm_type: str) -> None:
        tags = obj.tags
        category = category_for(tags)
        if not category:
            return
        name = first(tags, "name")
        website = first(tags, "contact:website", "website")
        email = first(tags, "contact:email", "email")
        phone = first(tags, "contact:phone", "phone", "mobile")
        coordinates = self._coordinates(obj, osm_type)
        city = first(tags, "addr:city", "addr:town", "addr:village") or self._nearest_city(
            coordinates
        )
        address = address_for(tags)
        if not address and city:
            street = first(tags, "addr:street", "addr:place")
            number = first(tags, "addr:housenumber")
            postcode = first(tags, "addr:postcode")
            if street:
                address = (
                    f"{street}{f' {number}' if number else ''}, "
                    f"{' '.join(part for part in (postcode, city) if part)}, Croatia"
                )
            elif self.allow_incomplete:
                address = f"{name}, {city}, Croatia"
        required = (name, website) if self.allow_incomplete else (
            name,
            website,
            email,
            phone,
            address,
        )
        if not all(required):
            return
        dedupe = (name.casefold(), website.casefold())
        if dedupe in self.seen:
            return
        self.seen.add(dedupe)
        self.rows.append(
            {
                "osm_type": osm_type,
                "osm_id": obj.id,
                "name": name,
                "category": category,
                "city": city,
                "address": address,
                "website": website,
                "contact_email": email,
                "contact_phone": phone,
                "image_hint": first(tags, "image", "wikimedia_commons"),
                "source_url": f"https://www.openstreetmap.org/{osm_type}/{obj.id}",
                "lat": coordinates[0] if coordinates else None,
                "lng": coordinates[1] if coordinates else None,
            }
        )

    def node(self, obj: osmium.osm.Node) -> None:
        self._visit(obj, "node")

    def way(self, obj: osmium.osm.Way) -> None:
        self._visit(obj, "way")

    def relation(self, obj: osmium.osm.Relation) -> None:
        self._visit(obj, "relation")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("pbf", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument(
        "--allow-incomplete",
        action="store_true",
        help="Keep name+website rows so a later crawl can fill contact fields.",
    )
    args = parser.parse_args()
    place_handler = PlaceHandler()
    place_handler.apply_file(str(args.pbf), locations=True)
    handler = VendorHandler(
        allow_incomplete=args.allow_incomplete,
        places=place_handler.places,
    )
    handler.apply_file(str(args.pbf), locations=True)
    args.output.write_text(
        json.dumps(handler.rows, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    counts: dict[str, int] = {}
    for row in handler.rows:
        category = str(row["category"])
        counts[category] = counts.get(category, 0) + 1
    print(json.dumps({"total": len(handler.rows), "categories": counts}, indent=2))


if __name__ == "__main__":
    main()
