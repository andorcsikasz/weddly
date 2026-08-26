#!/usr/bin/env python3
"""Extract European wedding-vendor research candidates from OSM PBF files.

This deliberately emits research input, not product rows. A first-party site
crawl must still prove wedding relevance, obtain direct contact details and
verify imagery before the candidate can enter the curated directory.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from urllib.parse import urlparse

import osmium


COUNTRY_NAMES = {
    "CZ": "Czechia",
    "DE": "Germany",
    "FR": "France",
    "IT": "Italy",
}

CATEGORY_RULES: tuple[tuple[str, frozenset[str], str], ...] = (
    ("amenity", frozenset({"events_venue", "conference_centre"}), "venue"),
    (
        "tourism",
        frozenset({"hotel", "guest_house", "hostel", "resort", "motel", "chalet"}),
        "accommodation",
    ),
    ("shop", frozenset({"florist"}), "florist"),
    ("shop", frozenset({"hairdresser", "beauty"}), "hair_makeup"),
    ("shop", frozenset({"jewelry"}), "wedding_jewelry"),
    ("shop", frozenset({"wedding"}), "bridal_boutique"),
    ("craft", frozenset({"photographer"}), "photography"),
    ("craft", frozenset({"caterer"}), "catering"),
    ("office", frozenset({"event_management"}), "wedding_planner"),
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
    if first(tags, "wedding", "wedding:venue", "service:wedding"):
        return "venue"
    return None


def normalise_website(value: str | None) -> str | None:
    if not value:
        return None
    candidate = value.replace(";", " ").replace(",", " ").split()[0]
    if not candidate:
        return None
    if not candidate.lower().startswith(("http://", "https://")):
        candidate = f"https://{candidate}"
    try:
        parsed = urlparse(candidate)
        return candidate if parsed.hostname else None
    except ValueError:
        return None


def address_for(tags: osmium.osm.TagList, country_name: str) -> str | None:
    full = first(tags, "addr:full")
    if full:
        return full if country_name.casefold() in full.casefold() else f"{full}, {country_name}"
    street = first(tags, "addr:street", "addr:place")
    number = first(tags, "addr:housenumber")
    city = first(tags, "addr:city", "addr:town", "addr:village", "addr:suburb")
    postcode = first(tags, "addr:postcode")
    if not street or not city:
        return None
    first_line = f"{street} {number}" if number else street
    city_line = " ".join(part for part in (postcode, city) if part)
    return f"{first_line}, {city_line}, {country_name}"


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
    def __init__(self, country: str, places: list[tuple[float, float, str]]) -> None:
        super().__init__()
        self.country = country
        self.country_name = COUNTRY_NAMES[country]
        self.places = places
        self.place_grid: dict[tuple[int, int], list[tuple[float, float, str]]] = {}
        for place in places:
            key = (math.floor(place[0] * 4), math.floor(place[1] * 4))
            self.place_grid.setdefault(key, []).append(place)
        self.rows: list[dict[str, object]] = []
        self.seen: set[tuple[str, str]] = set()

    def _coordinates(self, obj: object, osm_type: str) -> tuple[float, float] | None:
        if osm_type == "node" and obj.location.valid():
            return (obj.location.lat, obj.location.lon)
        return None

    def _nearest_city(self, coordinates: tuple[float, float] | None) -> str | None:
        if not coordinates:
            return None
        lat, lon = coordinates
        closest: tuple[float, str] | None = None
        lon_scale = math.cos(math.radians(lat))
        grid_lat, grid_lon = math.floor(lat * 4), math.floor(lon * 4)
        for lat_offset in range(-2, 3):
            for lon_offset in range(-2, 3):
                for place_lat, place_lon, name in self.place_grid.get(
                    (grid_lat + lat_offset, grid_lon + lon_offset), []
                ):
                    distance_sq = (place_lat - lat) ** 2 + (
                        (place_lon - lon) * lon_scale
                    ) ** 2
                    if closest is None or distance_sq < closest[0]:
                        closest = (distance_sq, name)
        return closest[1] if closest and closest[0] <= 0.1 else None

    def _visit(self, obj: object, osm_type: str) -> None:
        tags = obj.tags
        category = category_for(tags)
        if not category:
            return
        name = first(tags, "name")
        website = normalise_website(first(tags, "contact:website", "website", "url"))
        if not name or not website:
            return
        hostname = (urlparse(website).hostname or "").removeprefix("www.").casefold()
        dedupe = (name.casefold(), hostname)
        if not hostname or dedupe in self.seen:
            return
        self.seen.add(dedupe)
        coordinates = self._coordinates(obj, osm_type)
        city = first(tags, "addr:city", "addr:town", "addr:village", "addr:suburb")
        city = city or self._nearest_city(coordinates)
        self.rows.append(
            {
                "osm_type": osm_type,
                "osm_id": obj.id,
                "name": name,
                "category": category,
                "city": f"{city}, {self.country}" if city else None,
                "address": address_for(tags, self.country_name),
                "website": website,
                "contact_email": first(tags, "contact:email", "email"),
                "contact_phone": first(tags, "contact:phone", "phone", "mobile"),
                "image_hint": first(tags, "image", "wikimedia_commons"),
                "source_url": f"https://www.openstreetmap.org/{osm_type}/{obj.id}",
                "country": self.country,
                "lat": coordinates[0] if coordinates else None,
                "lng": coordinates[1] if coordinates else None,
                "osm_description": first(tags, "description", "description:en"),
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
    parser.add_argument("country", choices=sorted(COUNTRY_NAMES))
    parser.add_argument("output", type=Path)
    parser.add_argument("pbfs", nargs="+", type=Path)
    args = parser.parse_args()

    all_rows: list[dict[str, object]] = []
    seen_hosts: set[tuple[str, str]] = set()
    for pbf in args.pbfs:
        places = PlaceHandler()
        # Node coordinates are embedded in the PBF. Avoid a full node-location
        # index here: country extracts can otherwise consume many gigabytes
        # merely to compute centroids for the comparatively few way records.
        places.apply_file(str(pbf))
        vendors = VendorHandler(args.country, places.places)
        vendors.apply_file(str(pbf))
        for row in vendors.rows:
            key = (str(row["name"]).casefold(), urlparse(str(row["website"])).hostname or "")
            if key in seen_hosts:
                continue
            seen_hosts.add(key)
            all_rows.append(row)

    args.output.write_text(
        json.dumps(all_rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    counts: dict[str, int] = {}
    for row in all_rows:
        category = str(row["category"])
        counts[category] = counts.get(category, 0) + 1
    print(json.dumps({"country": args.country, "total": len(all_rows), "categories": counts}))


if __name__ == "__main__":
    main()
