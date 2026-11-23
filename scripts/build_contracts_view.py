#!/usr/bin/env python3
"""Flatten contracts.jsonld and vendors.jsonld into one display file for the Contracts tab.

Usage:
    python3 scripts/build_contracts_view.py [OUT_FILE]

Reads contracts/data/source/contracts.jsonld, contracts/data/source/vendors.jsonld and contracts/data/erp-department-codes.json.
Writes contracts/data/contracts-display.json (default) and
contracts/data/qa/unmatched-contract-departments.json.

Nothing is invented: each row is one contract, with its vendor's name and the
department its four-digit code maps to. Placeholder contracts are left out and
counted in the file's `excluded` section.
"""
import collections
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "contracts" / "data"
SRC = DATA / "source"


def prop(contract, name):
    for p in contract.get("additionalProperty", []):
        if p.get("propertyID") == name:
            return p.get("value")
    return None


def slug(name, vendor_id):
    """A page name for a vendor: its name in lower case, then its id, so two vendors never share one."""
    words = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:60].strip("-")
    return f"{words}-{vendor_id}" if words else f"vendor-{vendor_id}"


def main(out_file):
    contracts = json.load(open(SRC / "contracts.jsonld"))["@graph"]
    vendors = {v["@id"]: v["name"] for v in json.load(open(SRC / "vendors.jsonld"))["@graph"]}
    cross = json.load(open(DATA / "erp-department-codes.json"))
    prefixes, rules = cross["prefixes"], cross["exclude"]

    rows, excluded, unmatched, groups = [], [], collections.Counter(), {}
    for c in contracts:
        k = c["contract"][0]
        value = k["value"]["value"]
        name = k["title"]
        if value <= rules["maxValue"] or any(s.lower() in name.lower() for s in rules["nameContains"]):
            excluded.append({"id": k["contractId"], "name": name, "value": value})
            continue
        erp = c["tender"]["procuringEntity"]["@id"].rsplit(":", 1)[-1]
        rule = prefixes.get(erp[:2])
        if rule is None:
            unmatched[erp] += 1
            continue
        vendor_id = c["party"][0]["@id"]
        if vendor_id not in vendors:
            raise SystemExit(f"contract {k['contractId']} names vendor {vendor_id}, which is not in vendors.jsonld")
        dept = rule.get("budgetCode") or rule["group"]
        if "group" in rule:
            groups[rule["group"]] = rule["name"]
        rows.append({
            "id": k["contractId"],
            "name": name,
            "vendorId": vendor_id.rsplit(":", 1)[-1],
            "vendor": vendors[vendor_id],
            "dept": dept,
            "erp": erp,
            "type": prop(k, "Type"),
            "method": prop(k, "Contract Method"),
            "status": k["status"],
            "value": value,
            "year": int(prop(k, "Year")),
            "start": k.get("periodStart"),
            "end": k.get("periodEnd"),
            "project": prop(k, "Project"),
        })

    rows.sort(key=lambda r: (-r["value"], r["id"]))
    used = {r["vendorId"] for r in rows}
    vendor_pages = {vid: {"name": name, "slug": slug(name, vid)} for vid, name in ((k.rsplit(":", 1)[-1], n) for k, n in vendors.items()) if vid in used}
    result = {
        "note": "One row per contract. 'dept' is a budget code, or the id of a group with no organization page (see 'groups'). Built by build_contracts_view.py; edit the inputs, not this file.",
        "groups": groups,
        "vendors": vendor_pages,
        "excluded": {"rule": rules["note"], "count": len(excluded), "contracts": excluded},
        "lastChanged": max((c.get("dateModified") or "" for c in contracts), default=""),
        "contracts": rows,
    }
    pathlib.Path(out_file).parent.mkdir(parents=True, exist_ok=True)
    json.dump(result, open(out_file, "w"), separators=(",", ":"))
    (DATA / "qa").mkdir(exist_ok=True)
    json.dump({"unmatched": dict(unmatched)}, open(DATA / "qa" / "unmatched-contract-departments.json", "w"), indent=2)
    total = sum(r["value"] for r in rows)
    assert len({v["slug"] for v in vendor_pages.values()}) == len(vendor_pages), "vendor page names collide"
    print(f"{len(rows)} contracts, ${total:,.0f}; {len(vendor_pages)} vendors; {len(excluded)} excluded; {sum(unmatched.values())} unmatched ({len(unmatched)} codes)")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else DATA / "contracts-display.json")
