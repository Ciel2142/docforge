_SCHEMA_PREFIX = "#/components/schemas/"
_FROM_KINDS = {"endpoint", "schema"}


def ref_to_schema_name(ref: str) -> str | None:
    if not isinstance(ref, str) or not ref.startswith(_SCHEMA_PREFIX):
        return None
    name = ref[len(_SCHEMA_PREFIX):]
    return name or None


def ref_link(ref: str, *, from_kind: str) -> tuple[str, str]:
    if from_kind not in _FROM_KINDS:
        raise ValueError(f"from_kind must be one of {_FROM_KINDS}, got {from_kind!r}")
    name = ref_to_schema_name(ref)
    if name is None:
        return ref, ref
    if from_kind == "endpoint":
        return name, f"../schemas/{name}.md"
    return name, f"{name}.md"
