from typing import Any

from .iter import Endpoint, Schema
from .refs import ref_link


def jsonpointer_encode(s: str) -> str:
    return s.replace("~", "~0").replace("/", "~1")


def _type_str(schema: dict[str, Any]) -> str:
    t = schema.get("type")
    fmt = schema.get("format")
    if t and fmt:
        return f"{t} ({fmt})"
    return t or "any"


def _schema_summary(schema: dict[str, Any], *, from_kind: str) -> str:
    """Render a one-line summary of a schema (for request/response content lines)."""
    if "$ref" in schema:
        label, href = ref_link(schema["$ref"], from_kind=from_kind)
        return f"[{label}]({href})"
    if schema.get("type") == "array":
        items = schema.get("items") or {}
        return f"array of {_schema_summary(items, from_kind=from_kind)}"
    return f"`{_type_str(schema)}`"


def _render_parameters(params: list[dict[str, Any]]) -> list[str]:
    if not params:
        return []
    lines = [
        "## Parameters",
        "",
        "| Name | In | Type | Required | Description |",
        "|------|----|----|----------|-------------|",
    ]
    for p in params:
        name = p.get("name", "")
        loc = p.get("in", "")
        schema = p.get("schema") or {}
        type_s = _type_str(schema)
        required = "yes" if p.get("required") else "no"
        desc = (p.get("description") or "").replace("|", "\\|").replace("\n", " ")
        lines.append(f"| {name} | {loc} | {type_s} | {required} | {desc} |")
    lines.append("")
    return lines


def _render_request_body(body: dict[str, Any] | None) -> list[str]:
    if not body:
        return []
    lines = ["## Request Body", ""]
    required_marker = " (required)" if body.get("required") else ""
    desc = body.get("description")
    if desc:
        lines.append(desc.strip())
        lines.append("")
    for ctype, media in (body.get("content") or {}).items():
        schema = media.get("schema") or {}
        summary = _schema_summary(schema, from_kind="endpoint")
        lines.append(f"`{ctype}`: {summary}{required_marker}")
    lines.append("")
    return lines


def _render_responses(responses: dict[str, Any]) -> list[str]:
    if not responses:
        return []
    lines = ["## Responses", ""]
    for code, resp in responses.items():
        if not isinstance(resp, dict):
            continue
        desc = (resp.get("description") or "").strip()
        lines.append(f"### {code} {desc}".rstrip())
        lines.append("")
        for ctype, media in (resp.get("content") or {}).items():
            schema = media.get("schema") or {}
            summary = _schema_summary(schema, from_kind="endpoint")
            lines.append(f"`{ctype}`: {summary}")
        lines.append("")
    return lines


def render_endpoint(ep: Endpoint, *, spec_filename: str) -> str:
    pointer = f"#/paths/{jsonpointer_encode(ep.path)}/{ep.method}"
    out: list[str] = [
        f"# {ep.method.upper()} {ep.path}",
        "",
        f"Source: {spec_filename}{pointer}",
        "",
    ]
    if ep.tags:
        out.append(f"**Tags:** {', '.join(ep.tags)}")
        out.append("")
    if ep.description:
        out.append(ep.description.strip())
        out.append("")
    elif ep.summary:
        out.append(ep.summary.strip())
        out.append("")

    out.extend(_render_parameters(list(ep.operation.get("parameters") or [])))
    out.extend(_render_request_body(ep.operation.get("requestBody")))
    out.extend(_render_responses(ep.operation.get("responses") or {}))

    while out and out[-1] == "":
        out.pop()
    return "\n".join(out) + "\n"


import json as _json


def _property_type(schema: dict[str, Any]) -> str:
    if "$ref" in schema:
        label, href = ref_link(schema["$ref"], from_kind="schema")
        return f"[{label}]({href})"
    if schema.get("type") == "array":
        items = schema.get("items") or {}
        return f"array of {_property_type(items)}"
    return _type_str(schema)


def render_schema(schema: Schema, *, spec_filename: str) -> str:
    body = schema.body
    out: list[str] = [
        f"# {schema.name}",
        "",
        f"Source: {spec_filename}#/components/schemas/{schema.name}",
        "",
    ]
    desc = (body.get("description") or "").strip()
    if desc:
        out.append(desc)
        out.append("")

    properties = body.get("properties") if body.get("type") == "object" else None
    if properties:
        required = set(body.get("required") or [])
        out.extend([
            "## Properties",
            "",
            "| Name | Type | Required | Description |",
            "|------|------|----------|-------------|",
        ])
        for prop_name, prop in properties.items():
            type_s = _property_type(prop or {})
            req = "yes" if prop_name in required else "no"
            pdesc = ((prop or {}).get("description") or "").replace("|", "\\|").replace("\n", " ")
            out.append(f"| {prop_name} | {type_s} | {req} | {pdesc} |")
        out.append("")
    else:
        out.append("## Definition")
        out.append("")
        out.append("```json")
        out.append(_json.dumps(body, indent=2, ensure_ascii=False))
        out.append("```")
        out.append("")

    while out and out[-1] == "":
        out.pop()
    return "\n".join(out) + "\n"
